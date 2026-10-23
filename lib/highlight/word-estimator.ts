import type { WordSpan } from '../text/segment';

/** About 170 words per minute at 1× for average English words (SPEC.md §6 cadence). */
export const MS_PER_CHAR = 62;
const COMMA_PAUSE_MS = 120;
const STOP_PAUSE_MS = 250;

/**
 * Estimated duration of each word (design §6): proportional to the characters
 * up to the next word, plus a pause for punctuation, divided by the rate.
 */
export function estimateWordDurations(text: string, words: WordSpan[], rate: number): number[] {
  return words.map((w, i) => {
    const until = words[i + 1]?.start ?? w.end;
    const gap = text.slice(w.end, until);
    let ms = Math.max(1, until - w.start) * MS_PER_CHAR;
    if (/[.!?…]/.test(gap)) ms += STOP_PAUSE_MS;
    else if (/[,;:—–]/.test(gap)) ms += COMMA_PAUSE_MS;
    return ms / rate;
  });
}

/** Steps through a sentence's words on the estimated schedule. */
export class WordEstimator {
  private timer: ReturnType<typeof setTimeout> | null = null;

  start(text: string, words: WordSpan[], rate: number, onWord: (index: number) => void): void {
    this.stop();
    if (!words.length) return;
    const durations = estimateWordDurations(text, words, rate);
    const step = (i: number) => {
      onWord(i);
      if (i + 1 < words.length) this.timer = setTimeout(() => step(i + 1), durations[i]);
      else this.timer = null;
    };
    step(0);
  }

  stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
