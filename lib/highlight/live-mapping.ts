import type { Extraction } from '../text/extract';
import { HeuristicContentLocator } from '../text/locator';
import { OffsetMap } from '../text/offset-map';
import { walkText } from '../text/walker';

/**
 * Resolves sentence and word offsets (in the original extraction) to live
 * DOM ranges, and keeps doing so when the page changes (design §6).
 *
 * When a mutation touches mapped text, the root is re-walked and every
 * sentence is realigned by finding its text again, in order. A sentence that
 * can no longer be found maps to nothing, so no highlight is drawn on the
 * wrong text while speech carries on.
 */
export class LiveMapping {
  private map: OffsetMap;
  private root: Element;
  /** Per sentence: how far it moved in the current text, or null if it is gone. */
  private shift: (number | null)[];
  private observer: MutationObserver | null = null;

  constructor(readonly extraction: Extraction) {
    this.map = extraction.map;
    this.root = extraction.root;
    this.shift = extraction.sentences.map(() => 0);
  }

  /** Starts watching the page; `onRemap` is called after the mapping changed. */
  observe(onRemap: () => void): void {
    const doc = this.root.ownerDocument;
    const View = doc.defaultView?.MutationObserver ?? MutationObserver;
    this.observer = new View((records) => {
      if (this.isInvalidated(records)) {
        this.remap();
        onRemap();
      }
    });
    this.observer.observe(doc.body ?? doc.documentElement, { childList: true, subtree: true, characterData: true });
  }

  disconnect(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  sentenceRange(index: number): Range | null {
    const s = this.extraction.sentences[index];
    return s ? this.rangeFor(index, s.start, s.end) : null;
  }

  /** Range for [start, end) of the original text, within sentence `index`. */
  rangeFor(index: number, start: number, end: number): Range | null {
    const d = this.shift[index];
    return d === null || d === undefined ? null : this.map.rangeFor(start + d, end + d);
  }

  /** The sentence index at a DOM point, or -1 if the point is outside the mapped text. */
  sentenceIndexAt(node: Node, offset: number): number {
    // Text that was skipped (or lies outside the root) is not "the text being read".
    if (node.nodeType === Node.TEXT_NODE ? !this.map.has(node) : !this.root.contains(node)) return -1;
    const at = this.map.offsetAt(node, offset);
    return this.extraction.sentences.findIndex((s, i) => {
      const d = this.shift[i];
      return d !== null && d !== undefined && at >= s.start + d && at < s.end + d;
    });
  }

  private isInvalidated(records: MutationRecord[]): boolean {
    for (const r of records) {
      if (r.type === 'characterData' && this.map.has(r.target)) return true;
    }
    // Removed or replaced content: some mapped node has left the page.
    if (records.some((r) => r.removedNodes.length)) {
      for (const node of this.map.nodes()) if (!node.isConnected) return true;
    }
    return false;
  }

  private remap(): void {
    const ex = this.extraction;
    const doc = this.root.ownerDocument;
    if (!this.root.isConnected) {
      this.root = ex.source === 'page' ? new HeuristicContentLocator().locate(doc) : (doc.body ?? doc.documentElement);
    }
    const { text, segments } = walkText(this.root, { skipBoilerplate: ex.source === 'page' });
    this.map = new OffsetMap(segments);
    let cursor = 0;
    this.shift = ex.sentences.map((s) => {
      const found = text.indexOf(ex.text.slice(s.start, s.end), cursor);
      if (found === -1) return null;
      cursor = found + (s.end - s.start);
      return found - s.start;
    });
  }
}
