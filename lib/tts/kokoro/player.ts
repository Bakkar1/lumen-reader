import type { TtsEvent } from '../engine';
import { FIRST_CHUNK_CHARS, MAX_CHUNK_CHARS, splitChunks, wordTimings, type Chunk, type WordTiming } from './chunks';
import type { SynthesisRequest, SynthesisResult } from './protocol';

export interface PlayerUtterance {
  id: number;
  text: string;
  voice: string;
  speed: number;
}

export interface Synthesis {
  audio: Float32Array;
  sampleRate: number;
}

export interface Synthesizer {
  synthesize(request: Omit<SynthesisRequest, 'id'>): Promise<Synthesis>;
}

/** The parts of AudioContext the player uses, so tests can drive the clock. */
export interface AudioOut {
  readonly currentTime: number;
  suspend(): Promise<void>;
  resume(): Promise<void>;
  /**
   * Plays the samples from `offset` seconds in, at `at` (context time); returns
   * the whole duration and a function that silences them.
   */
  play(synthesis: Synthesis, at: number, offset?: number): { duration: number; stop: () => void };
}

interface Queued extends PlayerUtterance {
  chunks: Chunk[];
  /** Chunks synthesised and scheduled so far. */
  scheduled: number;
  /** Every chunk is scheduled, and so is the end. */
  complete: boolean;
  started: boolean;
}

/** A chunk's audio on the clock, kept so that resume can replay it from an earlier point. */
interface Segment {
  u: Queued;
  synthesis: Synthesis;
  words: WordTiming[];
  /** Audio clock time of the start of the audio. */
  at: number;
  duration: number;
  stop: () => void;
}

interface Cue {
  /** Audio clock time. */
  at: number;
  fire: () => void;
  /** The segment whose word this cue reports. */
  seg?: Segment;
}

const TICK_MS = 20;
/** Closing punctuation of a phrase: resume backs up to the word after the last one. */
const ENDS_PHRASE = /[,;:.!?…—–]["'”’)\]]*$/u;
/**
 * How much scheduled audio may be waiting before synthesis pauses: enough to
 * ride out a slow sentence, little enough that a stop wastes no real work.
 */
const LOOKAHEAD_S = 15;

/**
 * Plays Kokoro speech in the offscreen document with chrome.tts-like
 * semantics: utterances queue, `stop` interrupts the current one and cancels
 * the rest. Chunks are synthesised just ahead of playback and scheduled back
 * to back on one audio clock; events fire from that clock, so pausing
 * (suspending it) holds them too. Resuming backs up to the start of the
 * phrase it paused in, replaying audio that is already synthesised.
 */
export class KokoroPlayer {
  private out: AudioOut | null = null;
  private queue: Queued[] = [];
  /** Audio that is playing or scheduled. */
  private segments: Segment[] = [];
  private cues: Cue[] = [];
  private tick: ReturnType<typeof setInterval> | null = null;
  /** End of the last scheduled chunk on the audio clock. */
  private playhead = 0;
  /** Bumped on stop so in-flight synthesis is dropped. */
  private generation = 0;
  private pumping = false;
  /** Paused, possibly before the audio output exists; a new output starts suspended. */
  private paused = false;

  constructor(
    private synth: Synthesizer,
    private emit: (id: number, event: TtsEvent) => void,
    private createOut: () => AudioOut = webAudioOut,
  ) {}

  speak(u: PlayerUtterance, enqueue: boolean): void {
    if (!enqueue) this.stop();
    // Behind other speech there is time to synthesise ahead; from silence, a short first chunk is heard sooner.
    const firstMax = this.queue.length === 0 ? FIRST_CHUNK_CHARS : MAX_CHUNK_CHARS;
    const chunks = splitChunks(u.text, MAX_CHUNK_CHARS, firstMax);
    this.queue.push({ ...u, chunks, scheduled: 0, complete: false, started: false });
    void this.pump();
  }

  stop(): void {
    const [first, ...rest] = this.reset();
    if (first) this.emit(first.id, first.started ? { type: 'interrupted' } : { type: 'cancelled' });
    for (const u of rest) this.emit(u.id, { type: 'cancelled' });
  }

  pause(): void {
    this.paused = true;
    void this.out?.suspend();
  }

  /** Returns whether there was speech to continue. */
  resume(): boolean {
    if (this.paused) this.rewind();
    this.paused = false;
    void this.out?.resume();
    return this.queue.length > 0;
  }

  isSpeaking(): boolean {
    return this.queue.length > 0;
  }

  /** Silences everything and empties the queue; returns what was queued. */
  private reset(): Queued[] {
    this.generation++;
    for (const s of this.segments) s.stop();
    this.segments = [];
    this.cues = [];
    this.stopTicking();
    // A paused player that is stopped plays the next utterance.
    this.paused = false;
    void this.out?.resume();
    this.playhead = 0;
    const queued = this.queue;
    this.queue = [];
    return queued;
  }

  /** Synthesises and schedules queued chunks in order. Only one pump runs at a time. */
  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    const generation = this.generation;
    try {
      for (;;) {
        const u = this.queue.find((q) => !q.complete);
        if (!u || generation !== this.generation) break;
        if (u.chunks.length === 0) {
          // Nothing speakable (only whitespace): start and end it in place.
          this.scheduleStart(u, this.nextStart());
          this.cue(this.nextStart(), () => this.finish(u));
          u.complete = true;
          continue;
        }
        await this.waitForRoom(generation);
        if (generation !== this.generation) break;
        const chunk = u.chunks[u.scheduled]!;
        let synthesis: Synthesis;
        try {
          synthesis = await this.synth.synthesize({ text: chunk.text, voice: u.voice, speed: u.speed });
        } catch (err) {
          if (generation === this.generation) this.fail(u, err instanceof Error ? err.message : String(err));
          break;
        }
        if (generation !== this.generation) break;
        this.schedule(u, chunk, synthesis);
      }
    } finally {
      this.pumping = false;
    }
    // A stop during synthesis may have been followed by new utterances.
    if (generation !== this.generation && this.queue.length > 0) void this.pump();
  }

  private async waitForRoom(generation: number): Promise<void> {
    while (generation === this.generation && this.out && this.playhead - this.out.currentTime > LOOKAHEAD_S) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  private audio(): AudioOut {
    if (!this.out) {
      this.out = this.createOut();
      if (this.paused) void this.out.suspend();
    }
    return this.out;
  }

  private nextStart(): number {
    return Math.max(this.audio().currentTime, this.playhead);
  }

  private schedule(u: Queued, chunk: Chunk, synthesis: Synthesis): void {
    const at = this.nextStart();
    const { duration, stop } = this.audio().play(synthesis, at);
    const seg: Segment = { u, synthesis, words: wordTimings(chunk, duration), at, duration, stop };
    const now = this.audio().currentTime;
    this.segments = this.segments.filter((s) => s.at + s.duration > now);
    this.segments.push(seg);
    this.playhead = at + duration;
    if (u.scheduled === 0) this.scheduleStart(u, at);
    this.cueWords(seg);
    u.scheduled++;
    if (u.scheduled === u.chunks.length) {
      this.cue(this.playhead, () => this.finish(u));
      u.complete = true;
    }
  }

  /** Cues the segment's words from `first` on, none before `notBefore` seconds into its audio. */
  private cueWords(seg: Segment, first = 0, notBefore = 0): void {
    for (const w of seg.words.slice(first)) {
      const fire = () => this.emit(seg.u.id, { type: 'word', charIndex: w.charIndex, length: w.length });
      this.cue(seg.at + Math.max(w.at, notBefore), fire, seg);
    }
  }

  /**
   * Moves paused playback back to the start of the phrase it paused in: that
   * segment replays from there, and everything after it moves later to match.
   */
  private rewind(): void {
    const now = this.out?.currentTime ?? 0;
    const i = this.segments.findIndex((s) => s.at <= now && now < s.at + s.duration);
    const seg = this.segments[i];
    if (!seg) return;
    const back = phraseStart(seg, now - seg.at);
    const from = seg.at + back.at;
    const shift = now - from;
    if (shift <= 0) return;
    this.cues = this.cues.filter((c) => c.seg !== seg);
    for (const c of this.cues) if (c.at >= from) c.at += shift;
    for (const s of this.segments.slice(i)) {
      s.stop();
      s.at += shift;
      const offset = s === seg ? back.at : 0;
      s.stop = this.audio().play(s.synthesis, s.at + offset, offset).stop;
    }
    this.cueWords(seg, back.word, back.at);
    this.playhead += shift;
  }

  private scheduleStart(u: Queued, at: number): void {
    this.cue(at, () => {
      u.started = true;
      this.emit(u.id, { type: 'start' });
    });
  }

  private finish(u: Queued): void {
    this.queue = this.queue.filter((q) => q !== u);
    this.emit(u.id, { type: 'end', charIndex: u.text.length });
    if (this.queue.length === 0) this.segments = [];
  }

  /** The utterance that failed reports the error; the ones queued behind it are cancelled. */
  private fail(u: Queued, message: string): void {
    for (const q of this.reset()) this.emit(q.id, q === u ? { type: 'error', message } : { type: 'cancelled' });
  }

  private cue(at: number, fire: () => void, seg?: Segment): void {
    this.cues.push({ at, fire, seg });
    this.tick ??= setInterval(() => this.fireDue(), TICK_MS);
  }

  /** Fires due cues in time order (stable for equal times); a cue may reset the player. */
  private fireDue(): void {
    // Suspending the clock takes effect asynchronously; hold cues from the moment of the pause.
    if (this.paused) return;
    const now = this.out?.currentTime ?? 0;
    while (this.cues.length > 0) {
      let next = 0;
      for (let i = 1; i < this.cues.length; i++) if (this.cues[i]!.at < this.cues[next]!.at) next = i;
      const cue = this.cues[next]!;
      if (cue.at > now) return;
      this.cues.splice(next, 1);
      cue.fire();
    }
    this.stopTicking();
  }

  private stopTicking(): void {
    if (this.tick !== null && this.cues.length === 0) {
      clearInterval(this.tick);
      this.tick = null;
    }
  }
}

/**
 * Where the phrase playing at `pos` (seconds into the segment) starts: at the
 * chunk's first word, or at the word after the last phrase-ending mark. Word
 * times are estimates, so a start inside the chunk moves to the quietest
 * point nearby, which is the pause the voice makes after the punctuation.
 */
function phraseStart(seg: Segment, pos: number): { word: number; at: number } {
  const { words, u } = seg;
  let word = 0;
  for (let i = 1; i < words.length && words[i]!.at <= pos; i++) {
    const prev = words[i - 1]!;
    if (ENDS_PHRASE.test(u.text.slice(prev.charIndex, prev.charIndex + prev.length))) word = i;
  }
  if (word === 0) return { word, at: 0 };
  const estimate = words[word]!.at;
  const from = Math.max(words[word - 1]!.at, estimate - 0.4);
  return { word, at: quietestPoint(seg.synthesis, from, Math.min(estimate + 0.15, pos), estimate) };
}

/** The start (seconds) of the quietest 10 ms within [from, to]; of equally quiet ones, the nearest to `near`. */
function quietestPoint({ audio, sampleRate }: Synthesis, from: number, to: number, near: number): number {
  const frame = Math.max(1, Math.round(sampleRate * 0.01));
  const end = Math.min(audio.length, Math.floor(to * sampleRate));
  let best = near;
  let bestEnergy = Infinity;
  for (let start = Math.max(0, Math.ceil(from * sampleRate)); start + frame <= end; start += frame) {
    let energy = 0;
    for (let i = start; i < start + frame; i++) energy += audio[i]! * audio[i]!;
    const t = start / sampleRate;
    if (energy < bestEnergy || (energy === bestEnergy && Math.abs(t - near) < Math.abs(best - near))) {
      best = t;
      bestEnergy = energy;
    }
  }
  return best;
}

function webAudioOut(): AudioOut {
  const ctx = new AudioContext();
  return {
    get currentTime() {
      return ctx.currentTime;
    },
    suspend: () => ctx.suspend(),
    resume: () => ctx.resume(),
    play({ audio, sampleRate }, at, offset = 0) {
      const buffer = ctx.createBuffer(1, audio.length, sampleRate);
      buffer.copyToChannel(new Float32Array(audio), 0);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(at, offset);
      return { duration: buffer.duration, stop: () => source.stop() };
    },
  };
}

/** Synthesizer over the model worker (lib/tts/kokoro/worker.ts). */
export class WorkerSynthesizer implements Synthesizer {
  private nextId = 0;
  private pending = new Map<number, { resolve: (s: Synthesis) => void; reject: (e: Error) => void }>();

  constructor(private worker: Worker) {
    worker.onmessage = (e: MessageEvent<SynthesisResult>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if ('error' in e.data) p.reject(new Error(e.data.error));
      else p.resolve(e.data);
    };
    worker.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || 'Kokoro worker failed'));
      this.pending.clear();
    };
  }

  synthesize(request: Omit<SynthesisRequest, 'id'>): Promise<Synthesis> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, ...request } satisfies SynthesisRequest);
    });
  }
}
