/**
 * The speech engine seam (decision D2, design §3). v1 ships ChromeTtsEngine;
 * a cloud engine can implement the same interface later.
 */

export interface TtsVoice {
  voiceName: string;
  lang: string | null;
  /** Network voice (e.g. Google voices); these often send no word events. */
  remote: boolean;
}

/** Character offsets are relative to the text passed to `speak`. */
export type TtsEvent =
  | { type: 'start' }
  | { type: 'word'; charIndex: number; length: number | null }
  | { type: 'end'; charIndex?: number }
  | { type: 'interrupted' }
  | { type: 'cancelled' }
  | { type: 'error'; message: string };

export interface SpeakOptions {
  voiceName?: string;
  lang?: string;
  /** Engine rate, already clamped to the voice's range. 1 = normal. */
  rate: number;
  /** Queue after the current utterance instead of interrupting it. */
  enqueue?: boolean;
}

export interface VoiceCapabilities {
  /** null = not known until the voice has spoken a sentence. */
  wordEvents: boolean | null;
  minRate: number;
  maxRate: number;
}

export interface TtsEngine {
  getVoices(): Promise<TtsVoice[]>;
  /** Reading is likely to start soon: load whatever the first `speak` would otherwise wait for. */
  prepare(): void;
  speak(text: string, options: SpeakOptions, onEvent: (event: TtsEvent) => void): void;
  /** Holds speech where it is; nothing is lost and no events fire until `resume`. */
  pause(): void;
  /**
   * Continues held speech, possibly backing up to the start of the phrase it
   * paused in; false when nothing was held (or it was lost), so the caller must speak again.
   */
  resume(): Promise<boolean>;
  /** Interrupts the current utterance and cancels all queued ones. */
  stop(): void;
  isSpeaking(): Promise<boolean>;
  capabilities(voiceName: string | undefined): VoiceCapabilities;
}

/** Events after which an utterance will send nothing more. */
export const isFinalEvent = (e: TtsEvent): boolean =>
  e.type === 'end' || e.type === 'interrupted' || e.type === 'cancelled' || e.type === 'error';
