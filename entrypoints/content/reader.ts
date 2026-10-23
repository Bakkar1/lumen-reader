import type { BackgroundToTab, FrameProbe, SentenceRef, StartMode, TabToBackground } from '@/lib/messages';
import { extractPage, extractSelection, type Extraction } from '@/lib/text/extract';
import { HighlightRenderer } from '@/lib/highlight/renderer';
import { ReadingView } from '@/lib/highlight/reading-view';
import { AutoScroller } from '@/lib/highlight/auto-scroll';
import { ClickToJump } from '@/lib/navigation/click-to-jump';

export interface PageReaderDeps {
  send(message: TabToBackground): void;
  /** Auto-scroll stopped (the user scrolled) or resumed; the player shows "Back to reading". */
  onFollowChange?(following: boolean): void;
}

/**
 * The content script's reading pipeline (design §2): extracts and segments
 * text, sends the background only the sentence list, and turns progress
 * events back into highlights.
 */
export class PageReader {
  private renderer: HighlightRenderer | null = null;
  private view: ReadingView | null = null;
  private scroller: AutoScroller;
  private clicks: ClickToJump;
  private playing = false;

  constructor(private deps: PageReaderDeps) {
    this.scroller = new AutoScroller(window, { onFollowChange: (on) => deps.onFollowChange?.(on) });
    this.clicks = new ClickToJump(document, {
      isActive: () => this.playing,
      sentenceAt: (node, offset) => this.view?.mapping.sentenceIndexAt(node, offset) ?? -1,
      onJump: (index) => deps.send({ type: 'jump', index }),
    });
  }

  get readingView(): ReadingView | null {
    return this.view;
  }

  /** Extracts according to `mode` and starts a session at `startIndex`. Returns false if nothing is readable. */
  start(mode: StartMode, startIndex = 0): boolean {
    const extraction = this.extract(mode);
    if (!extraction?.sentences.length) return false;
    this.startWith(extraction, startIndex);
    return true;
  }

  /** Starts a session on an extraction made earlier (e.g. the one the paragraph icons point into). */
  startWith(extraction: Extraction, startIndex: number): void {
    this.view?.dispose();
    this.renderer ??= new HighlightRenderer(document);
    this.view = new ReadingView(extraction, this.renderer, {
      onSentenceShown: (range) => this.scroller.follow(range),
    });
    // A new reading action turns following back on.
    this.scroller.reset();
    this.deps.send({
      type: 'load',
      sentences: sentenceRefs(extraction),
      lang: extraction.lang,
      startIndex,
      source: extraction.source,
      url: location.href,
    });
  }

  onMessage(message: BackgroundToTab): void {
    const view = this.view;
    switch (message.type) {
      case 'requestStart':
        this.start(message.mode);
        break;
      case 'state':
        // Auto-scroll and click-to-jump are only active while playing.
        this.playing = message.state.status === 'playing';
        if (this.playing) {
          this.scroller.attach();
          this.clicks.attach();
        } else {
          this.scroller.detach();
          this.clicks.detach();
        }
        view?.onState(message.state);
        break;
      case 'sentence':
        view?.onSentence(message.index);
        break;
      case 'word':
        view?.onWord(message.index, message.charIndex);
        break;
      case 'finished':
        view?.onFinished();
        break;
      case 'released':
        // The session moved to another frame of this tab.
        this.view?.dispose();
        this.view = null;
        break;
      case 'backToReading':
        this.backToReading();
        break;
    }
  }

  /** "Back to reading": scroll to the current sentence and follow again. */
  backToReading(): void {
    this.scroller.resume();
  }

  /**
   * How well this frame could serve a start request, so the background can
   * pick the frame to read (the text may live in an iframe).
   */
  probe(): FrameProbe {
    const selection = window.getSelection();
    return {
      selection: !!selection && !selection.isCollapsed && !!extractSelection(selection),
      focused: document.hasFocus(),
      chars: extractPage(document).text.length,
    };
  }

  private extract(mode: StartMode): Extraction | null {
    const selection = window.getSelection();
    const selected = selection && !selection.isCollapsed ? extractSelection(selection) : null;
    if (mode === 'selection') return selected;
    if (mode !== 'page' && selected) return selected;
    return extractPage(document);
  }
}

export function sentenceRefs(extraction: Extraction): SentenceRef[] {
  return extraction.sentences.map((s) => ({ text: extraction.text.slice(s.start, s.end), start: s.start, end: s.end }));
}
