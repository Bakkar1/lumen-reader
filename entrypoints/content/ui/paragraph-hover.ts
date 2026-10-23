import type { Extraction } from '@/lib/text/extract';
import type { ParagraphTarget } from '@/lib/text/paragraphs';
import type { ParagraphIconState } from './Player';

/** The icon sits this far left of the paragraph's text (SPEC.md §11). */
const GUTTER_PX = 16;
const ICON_PX = 28;
/** Time to move the pointer from the paragraph to its icon before it hides. */
const HIDE_AFTER_MS = 300;

/**
 * Shows a play icon next to the paragraph under the pointer (floating-player
 * "Paragraph play icons"). Only reads geometry from the page; the icon itself
 * is drawn inside our shadow root, so the page layout never changes.
 */
export class ParagraphHover {
  private byElement = new Map<Element, ParagraphTarget>();
  private extraction: Extraction | null = null;
  private current: ParagraphTarget | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private host: Element,
    private onChange: (icon: ParagraphIconState | null) => void,
  ) {}

  setTargets(extraction: Extraction, targets: ParagraphTarget[]): void {
    this.extraction = extraction;
    this.byElement = new Map(targets.map((t) => [t.element, t]));
    this.hide();
  }

  attach(): void {
    document.addEventListener('pointermove', this.onMove, { capture: true, passive: true });
    window.addEventListener('scroll', this.hide, { capture: true, passive: true });
  }

  /** The extraction the current targets point into. */
  get source(): Extraction | null {
    return this.extraction;
  }

  hide = (): void => {
    clearTimeout(this.hideTimer);
    if (!this.current) return;
    this.current = null;
    this.onChange(null);
  };

  private onMove = (e: PointerEvent): void => {
    const el = e.target instanceof Element ? e.target : null;
    // On our own UI (the icon itself): keep showing it.
    if (el === this.host) {
      clearTimeout(this.hideTimer);
      return;
    }
    const target = el ? this.targetAt(el) : null;
    if (target) {
      clearTimeout(this.hideTimer);
      if (target !== this.current) this.show(target);
    } else if (this.current) {
      clearTimeout(this.hideTimer);
      this.hideTimer = setTimeout(this.hide, HIDE_AFTER_MS);
    }
  };

  private targetAt(el: Element): ParagraphTarget | null {
    for (let e: Element | null = el; e; e = e.parentElement) {
      const t = this.byElement.get(e);
      if (t) return t.element.isConnected ? t : null;
    }
    return null;
  }

  private show(target: ParagraphTarget): void {
    const sentence = this.extraction?.sentences[target.sentenceIndex];
    const word = sentence?.words[0];
    const firstLine = word ? this.extraction!.map.rangeFor(word.start, word.end)?.getBoundingClientRect() : null;
    const box = target.element.getBoundingClientRect();
    const line = firstLine ?? box;
    this.current = target;
    this.onChange({
      target,
      x: Math.max(4, box.left - GUTTER_PX - ICON_PX),
      y: line.top + line.height / 2,
    });
  }
}
