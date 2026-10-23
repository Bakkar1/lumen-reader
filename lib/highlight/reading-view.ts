import type { PlaybackState } from '../messages';
import type { Extraction } from '../text/extract';
import type { HighlightRenderer } from './renderer';
import { LiveMapping } from './live-mapping';
import { WordEstimator } from './word-estimator';

/** How long a voice that should send word events may stay silent before we estimate. */
const WORD_EVENT_GRACE_MS = 700;

export interface ReadingViewOptions {
  /** Called with the current sentence's range whenever it changes (auto-scroll). */
  onSentenceShown?(range: Range): void;
}

/**
 * Turns the background's progress events into highlights (design §6).
 * With word events it follows them; without, it estimates word timing and
 * re-syncs at every sentence the voice reports.
 */
export class ReadingView {
  readonly mapping: LiveMapping;
  private estimator = new WordEstimator();
  private grace: ReturnType<typeof setTimeout> | null = null;
  private state: PlaybackState | null = null;
  private sentenceIndex = -1;
  /** Word currently highlighted in the current sentence, or -1. */
  private wordIndex = -1;

  constructor(
    extraction: Extraction,
    private renderer: HighlightRenderer,
    private options: ReadingViewOptions = {},
  ) {
    this.mapping = new LiveMapping(extraction);
    this.mapping.observe(() => this.redraw());
  }

  get extraction(): Extraction {
    return this.mapping.extraction;
  }

  get currentSentence(): number {
    return this.sentenceIndex;
  }

  onState(state: PlaybackState): void {
    this.state = state;
    if (state.status === 'playing') {
      // A state can arrive before the sentence event (e.g. after a jump); draw the sentence at once.
      if (state.index !== this.sentenceIndex) this.onSentence(state.index);
      return;
    }
    this.stopTiming();
    if (state.status === 'paused') {
      // Keep the sentence so the reader sees where resume will start (SPEC.md §6).
      this.sentenceIndex = state.index;
      this.wordIndex = -1;
      this.renderer.show(this.mapping.sentenceRange(state.index), null);
    } else {
      this.clear();
    }
  }

  onSentence(index: number): void {
    this.sentenceIndex = index;
    this.stopTiming();
    const sentence = this.extraction.sentences[index];
    const range = this.mapping.sentenceRange(index);
    this.renderer.showSentence(range);
    if (range) this.options.onSentenceShown?.(range);
    if (!sentence) return;
    this.showWord(index, 0);

    if (this.state?.noWordTiming) this.estimate(index);
    else this.grace = setTimeout(() => this.estimate(index), WORD_EVENT_GRACE_MS / this.rate);
  }

  /** `charIndex` is absolute in the extracted text. */
  onWord(index: number, charIndex: number): void {
    this.stopTiming();
    if (index !== this.sentenceIndex) this.onSentenceQuiet(index);
    const words = this.extraction.sentences[index]?.words ?? [];
    let w = words.findIndex((word) => charIndex < word.end);
    if (w === -1) w = words.length - 1;
    this.showWord(index, w);
  }

  onFinished(): void {
    this.clear();
  }

  clear(): void {
    this.stopTiming();
    this.sentenceIndex = -1;
    this.wordIndex = -1;
    this.renderer.clear();
  }

  /** Stops observing the page and removes the highlights. */
  dispose(): void {
    this.mapping.disconnect();
    this.clear();
  }

  /** The page changed under us: draw the same positions on the re-mapped text. */
  private redraw(): void {
    if (this.sentenceIndex < 0) return;
    this.renderer.showSentence(this.mapping.sentenceRange(this.sentenceIndex));
    if (this.wordIndex >= 0) this.showWord(this.sentenceIndex, this.wordIndex);
  }

  private get rate(): number {
    return this.state?.effectiveRate || 1;
  }

  /** Moves the sentence highlight without starting any timing (used by word events). */
  private onSentenceQuiet(index: number): void {
    this.sentenceIndex = index;
    this.renderer.showSentence(this.mapping.sentenceRange(index));
  }

  private estimate(index: number): void {
    const sentence = this.extraction.sentences[index];
    if (!sentence || index !== this.sentenceIndex) return;
    this.estimator.start(this.extraction.text, sentence.words, this.rate, (w) => this.showWord(index, w));
  }

  private showWord(index: number, wordIndex: number): void {
    this.wordIndex = wordIndex;
    const word = this.extraction.sentences[index]?.words[wordIndex];
    this.renderer.showWord(word ? this.mapping.rangeFor(index, word.start, word.end) : null);
  }

  private stopTiming(): void {
    this.estimator.stop();
    if (this.grace !== null) clearTimeout(this.grace);
    this.grace = null;
  }
}
