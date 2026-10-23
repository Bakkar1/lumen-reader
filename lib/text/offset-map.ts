import type { TextSegment } from './walker';

/**
 * Maps between offsets in the extracted text and the live DOM (design §5),
 * in both directions, by binary search over the walker's segments.
 * Never modifies the DOM.
 */
export class OffsetMap {
  private byNode = new Map<Text, TextSegment[]>();

  constructor(readonly segments: TextSegment[]) {
    for (const s of segments) {
      const list = this.byNode.get(s.node);
      if (list) list.push(s);
      else this.byNode.set(s.node, [s]);
    }
  }

  /** The text nodes the map points into. */
  nodes(): IterableIterator<Text> {
    return this.byNode.keys();
  }

  has(node: Node): boolean {
    return this.byNode.has(node as Text);
  }

  /** A live Range for text[start, end), or null if empty or its nodes have left the page. */
  rangeFor(start: number, end: number): Range | null {
    if (end <= start || !this.segments.length) return null;
    // First segment that ends after `start` (skips unmapped "\n" boundaries).
    const i = this.firstEndingAfter(start);
    // Last segment that starts before `end`.
    const j = this.lastStartingBefore(end);
    const a = this.segments[i];
    const b = this.segments[j];
    if (!a || !b || i > j || !a.node.isConnected || !b.node.isConnected) return null;
    const range = a.node.ownerDocument.createRange();
    range.setStart(a.node, a.nodeStart + Math.max(0, start - a.textStart));
    range.setEnd(b.node, b.nodeStart + Math.min(b.length, end - b.textStart));
    return range;
  }

  /** The text offset nearest to a DOM point, e.g. from a click or a selection boundary. */
  offsetAt(node: Node, offset: number): number {
    const own = node.nodeType === Node.TEXT_NODE ? this.byNode.get(node as Text) : undefined;
    if (own) {
      for (const s of own) {
        if (offset < s.nodeStart) return s.textStart;
        if (offset <= s.nodeStart + s.length) return s.textStart + (offset - s.nodeStart);
      }
      const last = own.at(-1)!;
      return last.textStart + last.length;
    }
    // Some other point: find the last segment that starts at or before it.
    const doc = node.ownerDocument ?? (node as Document);
    const probe = doc.createRange();
    let lo = 0;
    let hi = this.segments.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const s = this.segments[mid]!;
      let cmp: number;
      try {
        probe.setStart(s.node, s.nodeStart);
        probe.collapse(true);
        cmp = probe.comparePoint(node, offset);
      } catch {
        return 0;
      }
      if (cmp >= 0) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (found === -1) return 0;
    const s = this.segments[found]!;
    const next = this.segments[found + 1];
    // Between two segments (e.g. at the start of the next block): snap forward.
    probe.setStart(s.node, s.nodeStart + s.length);
    probe.collapse(true);
    if (next && probe.comparePoint(node, offset) > 0) return next.textStart;
    return s.textStart + s.length;
  }

  private firstEndingAfter(offset: number): number {
    let lo = 0;
    let hi = this.segments.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const s = this.segments[mid]!;
      if (s.textStart + s.length <= offset) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private lastStartingBefore(offset: number): number {
    let lo = 0;
    let hi = this.segments.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.segments[mid]!.textStart < offset) lo = mid + 1;
      else hi = mid;
    }
    return lo - 1;
  }
}
