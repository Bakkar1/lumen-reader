import type { TtsEvent } from '../engine';
import { splitChunks, wordTimings, type Chunk } from './chunks';
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
  /** Plays the samples at `at` (context time); returns the duration and a function that silences them. */
  play(synthesis: Synthesis, at: number): { duration: number; stop: () => void };
}

interface Queued extends PlayerUtterance {
  chunks: Chunk[];
  /** Chunks synthesised and scheduled so far. */
  scheduled: number;
  /** Every chunk is scheduled, and so is the end. */
  complete: boolean;
  started: boolean;
}

interface Cue {
  /** Audio clock time. */
  at: number;
  fire: () => void;
}

const TICK_MS = 20;
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
 * (suspending it) holds them too.
 */
export class KokoroPlayer {
  private out: AudioOut | null = null;
  private queue: Queued[] = [];
  private playing: (() => void)[] = [];
  private cues: Cue[] = [];
  private tick: ReturnType<typeof setInterval> | null = null;
  /** End of the last scheduled chunk on the audio clock. */
  private playhead = 0;
  /** Bumped on stop so in-flight synthesis is dropped. */
  private generation = 0;
  private pumping = false;

  constructor(
    private synth: Synthesizer,
    private emit: (id: number, event: TtsEvent) => void,
    private createOut: () => AudioOut = webAudioOut,
  ) {}

  speak(u: PlayerUtterance, enqueue: boolean): void {
    if (!enqueue) this.stop();
    this.queue.push({ ...u, chunks: splitChunks(u.text), scheduled: 0, complete: false, started: false });
    void this.pump();
  }

  stop(): void {
    const [first, ...rest] = this.reset();
    if (first) this.emit(first.id, first.started ? { type: 'interrupted' } : { type: 'cancelled' });
    for (const u of rest) this.emit(u.id, { type: 'cancelled' });
  }

  pause(): void {
    void this.out?.suspend();
  }

  resume(): void {
    void this.out?.resume();
  }

  isSpeaking(): boolean {
    return this.queue.length > 0;
  }

  /** Silences everything and empties the queue; returns what was queued. */
  private reset(): Queued[] {
    this.generation++;
    for (const stop of this.playing) stop();
    this.playing = [];
    this.cues = [];
    this.stopTicking();
    // A paused player that is stopped plays the next utterance.
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
    return (this.out ??= this.createOut());
  }

  private nextStart(): number {
    return Math.max(this.audio().currentTime, this.playhead);
  }

  private schedule(u: Queued, chunk: Chunk, synthesis: Synthesis): void {
    const at = this.nextStart();
    const { duration, stop } = this.audio().play(synthesis, at);
    this.playing.push(stop);
    this.playhead = at + duration;
    if (u.scheduled === 0) this.scheduleStart(u, at);
    for (const w of wordTimings(chunk, duration)) {
      this.cue(at + w.at, () => this.emit(u.id, { type: 'word', charIndex: w.charIndex, length: w.length }));
    }
    u.scheduled++;
    if (u.scheduled === u.chunks.length) {
      this.cue(this.playhead, () => this.finish(u));
      u.complete = true;
    }
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
    if (this.queue.length === 0) this.playing = [];
  }

  /** The utterance that failed reports the error; the ones queued behind it are cancelled. */
  private fail(u: Queued, message: string): void {
    for (const q of this.reset()) this.emit(q.id, q === u ? { type: 'error', message } : { type: 'cancelled' });
  }

  private cue(at: number, fire: () => void): void {
    this.cues.push({ at, fire });
    this.tick ??= setInterval(() => this.fireDue(), TICK_MS);
  }

  /** Fires due cues in time order (stable for equal times); a cue may reset the player. */
  private fireDue(): void {
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

function webAudioOut(): AudioOut {
  const ctx = new AudioContext();
  return {
    get currentTime() {
      return ctx.currentTime;
    },
    suspend: () => ctx.suspend(),
    resume: () => ctx.resume(),
    play({ audio, sampleRate }, at) {
      const buffer = ctx.createBuffer(1, audio.length, sampleRate);
      buffer.copyToChannel(new Float32Array(audio), 0);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(at);
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
