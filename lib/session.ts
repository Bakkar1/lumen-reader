import type {
  BackgroundToTab,
  ControlAction,
  PlaybackState,
  PlaybackStatus,
  SentenceRef,
  TabToBackground,
} from './messages';
import { isFinalEvent, type TtsEngine, type TtsEvent, type TtsVoice } from './tts/engine';
import { VOICE_CAPS, effectiveRate, normaliseRate, type VoiceCap } from './tts/caps';
import type { PositionUpdate } from './storage/positions';
import { MS_PER_CHAR } from './highlight/word-estimator';

export type { PositionUpdate };

/**
 * Upper bound for the sentences joined into one utterance. Long enough that
 * most boundaries fall inside an utterance (no gap, no fresh-start onset),
 * short enough that estimated sentence timing re-syncs often.
 */
const MAX_UTTERANCE_CHARS = 300;
/** Closing punctuation; a heading or list item without it would run into the next sentence. */
const ENDS_SENTENCE = /[.!?…:;]["'”’)\]]*$/u;
/** Utterances shorter than this are too noisy to calibrate a voice's speed from. */
const MIN_CALIBRATION_CHARS = 40;

/** Consecutive sentences spoken as one utterance; `offsets` are each sentence's start within `text`. */
interface Utterance {
  first: number;
  last: number;
  text: string;
  offsets: number[];
}

function utteranceFrom(sentences: SentenceRef[], first: number): Utterance {
  let text = sentences[first]!.text;
  const offsets = [0];
  let last = first;
  for (let next = sentences[last + 1]; next; next = sentences[last + 1]) {
    if (!ENDS_SENTENCE.test(text) || text.length + 1 + next.text.length > MAX_UTTERANCE_CHARS) break;
    offsets.push(text.length + 1);
    text += ' ' + next.text;
    last++;
  }
  return { first, last, text, offsets };
}

export interface PlaybackSettings {
  voiceName: string | null;
  rate: number;
}

/** What is written to chrome.storage.session so a restarted worker can recover (design §4). */
export interface SessionSnapshot {
  tabId: number;
  /** The frame whose text is read; absent in snapshots from before frame support. */
  frameId?: number;
  sentences: SentenceRef[];
  lang: string;
  source: 'page' | 'selection';
  index: number;
  status: PlaybackStatus;
  voiceName: string | null;
  voiceUnavailable: boolean;
  url: string;
}

export interface SessionControllerDeps {
  engine: TtsEngine;
  /** To one frame of the tab, or to all of its frames when `frameId` is omitted. */
  send(tabId: number, message: BackgroundToTab, frameId?: number): void;
  /** Called with the latest snapshot on every sentence or status change; null when the session ends. */
  persist?(snapshot: SessionSnapshot | null): void;
  /** Called when the user changes a playback setting, to save it to the synced settings. */
  saveSettings?(patch: Partial<PlaybackSettings>): void;
  /** Called when a page read pauses, stops, is abandoned or finishes, to save its resume position. */
  savePosition?(update: PositionUpdate): void;
  settings: PlaybackSettings;
  caps?: VoiceCap[];
  /** Starting guess for a voice's speaking time per character at rate 1. */
  msPerChar?: number;
}

interface Session {
  tabId: number;
  /** The frame whose text is read; the player itself is in the top frame. */
  frameId: number;
  sentences: SentenceRef[];
  lang: string;
  source: 'page' | 'selection';
  index: number;
  status: PlaybackStatus;
  /** Resolved voice actually used (null = engine default). */
  voiceName: string | null;
  voiceUnavailable: boolean;
  url: string;
}

type LoadMessage = Extract<TabToBackground, { type: 'load' }>;

/**
 * Owns the single active reading session (design §2–§3).
 *
 * Speaks a few sentences per utterance and keeps the next utterance enqueued:
 * every utterance boundary costs a gap and a fresh-start onset (badly so for
 * network voices), so sentences flow together within one. The current
 * sentence is tracked from word events, or for voices without them estimated
 * from the voice's measured speed. Skipping, jumping and rate/voice changes
 * restart from a sentence; pause is "stop and remember the sentence" and
 * resume re-speaks it. That is sentence-level precision, as the spec allows,
 * and it behaves the same for every voice and across a service-worker restart.
 */
export class SessionController {
  private session: Session | null = null;
  private settings: PlaybackSettings;
  /** Bumped whenever playback is restarted or halted, so stale TTS events are ignored. */
  private generation = 0;
  private voices: TtsVoice[] = [];
  /** Voices that finished an utterance without any word event. */
  private learnedNoWords = new Set<string>();
  /** Measured speaking time per character at rate 1, per voice without word events. */
  private learnedMsPerChar = new Map<string, number>();

  constructor(private deps: SessionControllerDeps) {
    this.settings = { ...deps.settings, rate: normaliseRate(deps.settings.rate) };
  }

  // -------------------------------------------------------------------------
  // Commands

  /** Starts reading in a tab's frame, stopping any session in another tab or frame. */
  async load(tabId: number, msg: LoadMessage, frameId = 0): Promise<void> {
    if (this.session && this.session.tabId !== tabId) this.endOtherTab(this.session.tabId);
    else if (this.session && this.session.frameId !== frameId) {
      this.deps.send(tabId, { type: 'released' }, this.session.frameId);
    }
    this.halt();
    const voice = await this.resolveVoice(this.settings.voiceName, msg.lang);
    const startIndex = Math.min(msg.startIndex, Math.max(0, msg.sentences.length - 1));
    this.session = {
      tabId,
      frameId,
      sentences: msg.sentences,
      lang: msg.lang,
      source: msg.source,
      index: startIndex,
      status: 'stopped',
      ...voice,
      url: msg.url,
    };
    if (msg.sentences.length === 0) {
      this.publish();
      return;
    }
    this.playFrom(startIndex);
  }

  /** Returns false when the tab has no session (the caller may then start one). */
  control(tabId: number, action: ControlAction): boolean {
    const s = this.sessionFor(tabId);
    if (!s) return false;
    switch (action) {
      case 'play':
      case 'resume':
        if (s.status !== 'playing') this.playFrom(s.index);
        break;
      case 'pause':
        if (s.status === 'playing') this.pause();
        break;
      case 'toggle':
        if (s.status === 'playing') this.pause();
        else this.playFrom(s.index);
        break;
      case 'stop':
        this.stop();
        break;
      case 'skipBack':
        // Always the previous sentence (SPEC.md D-3); the first one restarts.
        this.skipTo(s, Math.max(0, s.index - 1));
        break;
      case 'skipForward':
        if (s.index + 1 < s.sentences.length) this.skipTo(s, s.index + 1);
        else if (s.status !== 'stopped') {
          // Past the last sentence: end as if the text had finished.
          this.halt();
          this.finish(s);
        }
        break;
    }
    return true;
  }

  /** Click-to-jump: only while playing (SPEC.md §10), and only within the text being read. */
  jump(tabId: number, index: number, frameId = 0): void {
    const s = this.sessionFor(tabId);
    if (s?.status !== 'playing' || s.frameId !== frameId || index >= s.sentences.length) return;
    this.playFrom(index);
  }

  /** The user picked a speed: applied from the current sentence and saved to the synced settings. */
  setRate(rate: number): void {
    this.settings.rate = normaliseRate(rate);
    this.deps.saveSettings?.({ rate: this.settings.rate });
    this.restartIfPlaying();
  }

  /** The user picked a voice: applied from the current sentence and saved to the synced settings. */
  async setVoice(voiceName: string): Promise<void> {
    this.settings.voiceName = voiceName;
    this.deps.saveSettings?.({ voiceName });
    await this.useVoice(voiceName);
  }

  /** Settings loaded from storage or changed elsewhere (another machine): applied, not saved back. */
  applySettings(patch: Partial<PlaybackSettings>): void {
    if (patch.rate !== undefined) this.settings.rate = normaliseRate(patch.rate);
    if (patch.voiceName !== undefined && patch.voiceName !== this.settings.voiceName) {
      this.settings.voiceName = patch.voiceName;
      if (patch.voiceName !== null) {
        void this.useVoice(patch.voiceName);
        return;
      }
    }
    if (patch.rate !== undefined) this.restartIfPlaying();
  }

  /**
   * Restores a session written by a previous service-worker instance (design §4).
   * Its utterance callbacks died with that worker, so whatever was playing is
   * silenced and the session comes back paused at the last stored sentence.
   */
  restore(snapshot: SessionSnapshot): void {
    this.halt();
    this.session = {
      tabId: snapshot.tabId,
      frameId: snapshot.frameId ?? 0,
      sentences: snapshot.sentences,
      lang: snapshot.lang,
      source: snapshot.source,
      index: snapshot.index,
      status: snapshot.status === 'playing' ? 'paused' : snapshot.status,
      voiceName: snapshot.voiceName,
      voiceUnavailable: snapshot.voiceUnavailable,
      url: snapshot.url,
    };
    this.publish();
  }

  /** A frame navigated or lost its content script; ends the session if it was reading there. */
  frameGone(tabId: number, frameId: number): void {
    if (this.session?.tabId === tabId && this.session.frameId === frameId) this.tabGone(tabId);
  }

  /** The tab closed, navigated or lost its content script. */
  tabGone(tabId: number): void {
    if (this.session?.tabId !== tabId) return;
    this.saveAbandoned(this.session);
    this.halt();
    this.session = null;
    this.deps.persist?.(null);
  }

  getState(tabId: number): PlaybackState {
    const s = this.sessionFor(tabId);
    const voiceName = s ? s.voiceName : this.settings.voiceName;
    return {
      status: s?.status ?? 'idle',
      index: s?.index ?? 0,
      total: s?.sentences.length ?? 0,
      rate: this.settings.rate,
      effectiveRate: effectiveRate(this.settings.rate, voiceName, this.caps),
      voiceName,
      voiceUnavailable: s?.voiceUnavailable ?? false,
      noWordTiming: this.noWordTiming(voiceName),
    };
  }

  get activeTabId(): number | null {
    return this.session?.tabId ?? null;
  }

  /** The frame being read in the tab, or null if the tab has no session. */
  readingFrame(tabId: number): number | null {
    return this.sessionFor(tabId)?.frameId ?? null;
  }

  // -------------------------------------------------------------------------
  // Playback

  private get caps(): VoiceCap[] {
    return this.deps.caps ?? VOICE_CAPS;
  }

  private sessionFor(tabId: number): Session | null {
    return this.session?.tabId === tabId ? this.session : null;
  }

  private playFrom(index: number): void {
    const s = this.session;
    if (!s) return;
    const generation = ++this.generation;
    s.index = index;
    s.status = 'playing';
    this.speakUtterance(s, index, generation, false);
    this.publish();
  }

  private speakUtterance(s: Session, first: number, generation: number, enqueue: boolean): void {
    if (!s.sentences[first]) return;
    const u = utteranceFrom(s.sentences, first);
    const rate = effectiveRate(this.settings.rate, s.voiceName, this.caps);
    let sawWord = false;
    let startedAt = 0;
    let current = first;
    let timers: ReturnType<typeof setTimeout>[] = [];
    const clearTimers = () => {
      timers.forEach(clearTimeout);
      timers = [];
    };
    const enter = (index: number) => {
      if (generation !== this.generation || this.session !== s) return;
      current = index;
      if (s.index !== index) {
        s.index = index;
        this.publish();
      }
      this.deps.send(s.tabId, { type: 'sentence', index }, s.frameId);
    };
    const onEvent = (e: TtsEvent) => {
      if (isFinalEvent(e)) clearTimers();
      if (generation !== this.generation || this.session !== s) return;
      switch (e.type) {
        case 'start':
          startedAt = Date.now();
          enter(first);
          // Without word events, move through the joined sentences on the voice's estimated speed.
          if (this.deps.engine.capabilities(s.voiceName ?? undefined).wordEvents !== true) {
            const msPerChar = this.msPerChar(s.voiceName) / rate;
            u.offsets.forEach((offset, j) => {
              if (j > 0) timers.push(setTimeout(() => enter(first + j), offset * msPerChar));
            });
          }
          // Look ahead: queue the next utterance so there is no gap.
          if (u.last + 1 < s.sentences.length) this.speakUtterance(s, u.last + 1, generation, true);
          break;
        case 'word': {
          if (!sawWord) clearTimers();
          sawWord = true;
          const j = u.offsets.findLastIndex((offset) => offset <= e.charIndex);
          if (first + j !== current) enter(first + j);
          const sentence = s.sentences[first + j]!;
          this.deps.send(
            s.tabId,
            { type: 'word', index: first + j, charIndex: sentence.start + e.charIndex - u.offsets[j]!, length: e.length },
            s.frameId,
          );
          break;
        }
        case 'end':
          if (!sawWord && s.voiceName && /\s/.test(u.text.trim())) {
            if (u.text.length >= MIN_CALIBRATION_CHARS) this.calibrate(s.voiceName, (Date.now() - startedAt) * rate / u.text.length);
            if (!this.learnedNoWords.has(s.voiceName)) {
              this.learnedNoWords.add(s.voiceName);
              this.publish();
            }
          }
          if (u.last === s.sentences.length - 1) this.finish(s);
          break;
        case 'error':
          // Leave the session in a consistent, resumable state.
          this.halt();
          s.status = 'paused';
          this.savePosition(s);
          this.publish();
          break;
      }
      if (isFinalEvent(e)) sawWord = false;
    };
    this.deps.engine.speak(u.text, { voiceName: s.voiceName ?? undefined, lang: s.lang, rate, enqueue }, onEvent);
  }

  private msPerChar(voiceName: string | null): number {
    return (voiceName && this.learnedMsPerChar.get(voiceName)) || (this.deps.msPerChar ?? MS_PER_CHAR);
  }

  /** Folds a measured speed into the voice's estimate; averaging damps one odd utterance. */
  private calibrate(voiceName: string, msPerChar: number): void {
    const known = this.learnedMsPerChar.get(voiceName);
    this.learnedMsPerChar.set(voiceName, known ? (known + msPerChar) / 2 : msPerChar);
  }

  /** Playing: continue from `index`. Paused: move there and stay paused. Stopped: nothing to skip. */
  private skipTo(s: Session, index: number): void {
    if (s.status === 'playing') this.playFrom(index);
    else if (s.status === 'paused') {
      s.index = index;
      this.publish();
    }
  }

  private pause(): void {
    const s = this.session;
    if (!s) return;
    this.halt();
    s.status = 'paused';
    this.savePosition(s);
    this.publish();
  }

  private stop(): void {
    const s = this.session;
    if (!s) return;
    this.halt();
    // Save where the user stopped; the session itself starts over next time.
    if (s.status !== 'stopped') this.savePosition(s);
    s.status = 'stopped';
    s.index = 0;
    this.publish();
  }

  private finish(s: Session): void {
    this.generation++;
    this.savePosition(s, true);
    s.status = 'stopped';
    // Like stop: a later play starts over (and re-reads a finished selection).
    s.index = 0;
    this.deps.send(s.tabId, { type: 'finished' }, s.frameId);
    this.publish();
  }

  private restartIfPlaying(): void {
    const s = this.session;
    if (s?.status === 'playing') this.playFrom(s.index);
    else this.publish();
  }

  /** Silences the engine and invalidates every outstanding utterance. */
  private halt(): void {
    this.generation++;
    this.deps.engine.stop();
  }

  private endOtherTab(tabId: number): void {
    if (this.session) this.saveAbandoned(this.session);
    this.halt();
    const stopped: PlaybackState = { ...this.getState(tabId), status: 'stopped', index: 0 };
    this.session = null;
    this.deps.send(tabId, { type: 'state', state: stopped });
  }

  private publish(): void {
    const s = this.session;
    if (!s) return;
    this.deps.send(s.tabId, { type: 'state', state: this.getState(s.tabId) });
    this.deps.persist?.({
      tabId: s.tabId,
      frameId: s.frameId,
      sentences: s.sentences,
      lang: s.lang,
      source: s.source,
      index: s.index,
      status: s.status,
      voiceName: s.voiceName,
      voiceUnavailable: s.voiceUnavailable,
      url: s.url,
    });
  }

  /** Resume positions are per page; reading a selection saves nothing. */
  private savePosition(s: Session, finished = false): void {
    if (s.source !== 'page') return;
    const index = finished ? s.sentences.length - 1 : s.index;
    const sentence = s.sentences[index];
    if (sentence) this.deps.savePosition?.({ url: s.url, index, sentence, finished });
  }

  /** A read left mid-way (tab closed or navigated, or reading moved to another tab). */
  private saveAbandoned(s: Session): void {
    if (s.status === 'playing' || s.status === 'paused') this.savePosition(s);
  }

  // -------------------------------------------------------------------------
  // Voices

  private async useVoice(voiceName: string): Promise<void> {
    const s = this.session;
    if (!s) return;
    const voice = await this.resolveVoice(voiceName, s.lang);
    if (this.session !== s) return;
    Object.assign(s, voice);
    this.restartIfPlaying();
  }

  private noWordTiming(voiceName: string | null): boolean {
    if (!voiceName) return false;
    return this.deps.engine.capabilities(voiceName).wordEvents === false || this.learnedNoWords.has(voiceName);
  }

  /** The saved voice if it exists, otherwise a default for the page language. */
  private async resolveVoice(
    wanted: string | null,
    lang: string,
  ): Promise<{ voiceName: string | null; voiceUnavailable: boolean }> {
    this.voices = await this.deps.engine.getVoices().catch(() => this.voices);
    if (wanted && this.voices.some((v) => v.voiceName === wanted)) {
      return { voiceName: wanted, voiceUnavailable: false };
    }
    const prefix = lang.toLowerCase().split('-')[0] ?? '';
    const fallback =
      this.voices.find((v) => v.lang?.toLowerCase().startsWith(prefix) && !v.remote) ??
      this.voices.find((v) => v.lang?.toLowerCase().startsWith(prefix)) ??
      this.voices[0];
    return { voiceName: fallback?.voiceName ?? null, voiceUnavailable: wanted !== null };
  }
}
