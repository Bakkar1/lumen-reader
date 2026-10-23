import type { SpeakOptions, TtsEngine, TtsEvent, TtsVoice, VoiceCapabilities } from './engine';

export const FAKE_VOICE_WORDS = 'Lumen Test Voice';
export const FAKE_VOICE_NO_WORDS = 'Lumen Test Voice (no word events)';

export interface FakeTtsOptions {
  /** Which fake voice is the default (listed first). Chosen by the E2E build flag. */
  defaultWordEvents?: boolean;
  /** Speaking time per character at rate 1. */
  msPerChar?: number;
}

interface Step {
  /** Delay from the previous step at rate 1. */
  delay: number;
  event: TtsEvent;
}

interface Utterance {
  steps: Step[];
  rate: number;
  onEvent: (event: TtsEvent) => void;
}

/**
 * A deterministic stand-in for chrome.tts used by unit and E2E tests
 * (design §10). Each word lasts (its length + trailing space) × msPerChar / rate.
 */
export class FakeTtsEngine implements TtsEngine {
  private readonly defaultVoice: string;
  private readonly msPerChar: number;
  private queue: Utterance[] = [];
  private current: Utterance | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextAt = 0;
  private pausedRemaining: number | null = null;

  constructor(options: FakeTtsOptions = {}) {
    this.defaultVoice = options.defaultWordEvents === false ? FAKE_VOICE_NO_WORDS : FAKE_VOICE_WORDS;
    this.msPerChar = options.msPerChar ?? 45;
  }

  async getVoices(): Promise<TtsVoice[]> {
    const voices = [FAKE_VOICE_WORDS, FAKE_VOICE_NO_WORDS].map((voiceName) => ({
      voiceName,
      lang: 'en-US',
      remote: voiceName === FAKE_VOICE_NO_WORDS,
    }));
    return voices.sort((a, b) => Number(b.voiceName === this.defaultVoice) - Number(a.voiceName === this.defaultVoice));
  }

  capabilities(voiceName: string | undefined): VoiceCapabilities {
    return { wordEvents: (voiceName ?? this.defaultVoice) !== FAKE_VOICE_NO_WORDS, minRate: 0.1, maxRate: 10 };
  }

  speak(text: string, options: SpeakOptions, onEvent: (event: TtsEvent) => void): void {
    if (!options.enqueue) this.stop();
    const wordEvents = this.capabilities(options.voiceName).wordEvents;
    this.queue.push({ steps: this.plan(text, wordEvents === true), rate: options.rate, onEvent });
    if (!this.current && this.pausedRemaining === null) this.startNext();
  }

  pause(): void {
    if (!this.current || this.pausedRemaining !== null) return;
    this.pausedRemaining = Math.max(0, this.nextAt - Date.now());
    this.clearTimer();
  }

  resume(): void {
    if (this.pausedRemaining === null) return;
    const remaining = this.pausedRemaining;
    this.pausedRemaining = null;
    if (this.current) this.schedule(remaining);
    else this.startNext();
  }

  stop(): void {
    this.clearTimer();
    this.pausedRemaining = null;
    const current = this.current;
    const queued = this.queue;
    this.current = null;
    this.queue = [];
    current?.onEvent({ type: 'interrupted' });
    for (const u of queued) u.onEvent({ type: 'cancelled' });
  }

  async isSpeaking(): Promise<boolean> {
    return this.current !== null || this.queue.length > 0;
  }

  private plan(text: string, wordEvents: boolean): Step[] {
    const words = [...text.matchAll(/\S+/g)];
    const steps: Step[] = [{ delay: 0, event: { type: 'start' } }];
    let last = 0;
    for (const w of words) {
      const charIndex = w.index;
      if (wordEvents) {
        steps.push({ delay: (charIndex - last) * this.msPerChar, event: { type: 'word', charIndex, length: w[0].length } });
        last = charIndex;
      }
    }
    steps.push({ delay: (text.length - last) * this.msPerChar, event: { type: 'end', charIndex: text.length } });
    return steps;
  }

  private startNext(): void {
    this.current = this.queue.shift() ?? null;
    if (this.current) this.runSteps();
  }

  /** Emits every step that is due now, then schedules the next one. */
  private runSteps(): void {
    const u = this.current;
    while (u && this.current === u) {
      const step = u.steps[0];
      if (!step) break;
      if (step.delay > 0) {
        this.schedule(step.delay / u.rate);
        step.delay = 0;
        return;
      }
      u.steps.shift();
      u.onEvent(step.event);
      if (step.event.type === 'end') {
        this.current = null;
        this.startNext();
        return;
      }
    }
  }

  private schedule(ms: number): void {
    this.clearTimer();
    this.nextAt = Date.now() + ms;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.runSteps();
    }, ms);
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
