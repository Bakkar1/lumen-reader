import { isBlock } from './dom-rules';
import { HeuristicContentLocator, type ContentLocator } from './locator';
import { OffsetMap } from './offset-map';
import { segment, type SentenceSpan, type WordSpan } from './segment';
import { walkText } from './walker';

export type ExtractionSource = 'page' | 'selection';

/** The readable text of a page or selection, segmented and mapped to the live DOM. */
export class Extraction {
  constructor(
    readonly source: ExtractionSource,
    /** The element that was walked. */
    readonly root: Element,
    readonly lang: string,
    readonly text: string,
    readonly map: OffsetMap,
    readonly sentences: SentenceSpan[],
  ) {}

  /** Index of the sentence containing (or nearest after) a text offset; -1 if none. */
  sentenceIndexAt(offset: number): number {
    const i = this.sentences.findIndex((s) => offset < s.end);
    return i === -1 ? this.sentences.length - 1 : i;
  }

  /** The word containing a text offset, or the next word after it in the same sentence. */
  wordAt(offset: number): WordSpan | null {
    const s = this.sentences[this.sentenceIndexAt(offset)];
    return s?.words.find((w) => offset < w.end) ?? s?.words.at(-1) ?? null;
  }
}

export function pageLang(doc: Document): string {
  return doc.documentElement.lang || doc.defaultView?.navigator.language || 'en';
}

/** Extracts the page's main content (design §5). */
export function extractPage(doc: Document, locator: ContentLocator = new HeuristicContentLocator()): Extraction {
  const root = locator.locate(doc);
  const lang = pageLang(doc);
  const { text, segments } = walkText(root, { skipBoilerplate: true });
  return new Extraction('page', root, lang, text, new OffsetMap(segments), segment(text, lang));
}

/**
 * Extracts only the current selection, with both ends expanded to whole words
 * (SPEC.md D-4). Returns null if nothing readable is selected.
 */
export function extractSelection(selection: Selection | Range): Extraction | null {
  const range = 'rangeCount' in selection ? (selection.rangeCount ? selection.getRangeAt(0) : null) : selection;
  if (!range || range.collapsed) return null;

  const root = blockAncestor(range.commonAncestorContainer);
  if (!root) return null;
  const doc = root.ownerDocument;
  const lang = (root.closest('[lang]') as HTMLElement | null)?.lang || pageLang(doc);
  const { text, segments } = walkText(root, { skipBoilerplate: false });
  const map = new OffsetMap(segments);

  const start = expandToWord(text, map.offsetAt(range.startContainer, range.startOffset), lang, 'start');
  const end = expandToWord(text, map.offsetAt(range.endContainer, range.endOffset), lang, 'end');
  if (end <= start) return null;
  const sentences = segment(text, lang, { start, end });
  return sentences.length ? new Extraction('selection', root, lang, text, map, sentences) : null;
}

function blockAncestor(node: Node): Element | null {
  let el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  while (el && !isBlock(el) && el.parentElement) el = el.parentElement;
  return el;
}

/** Moves an offset that falls inside a word to that word's start or end. */
function expandToWord(text: string, offset: number, lang: string, edge: 'start' | 'end'): number {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const nl = text.indexOf('\n', offset);
  const lineEnd = nl === -1 ? text.length : nl;
  const segmenter = new Intl.Segmenter(lang, { granularity: 'word' });
  for (const w of segmenter.segment(text.slice(lineStart, lineEnd))) {
    const ws = lineStart + w.index;
    const we = ws + w.segment.length;
    if (w.isWordLike && ws < offset && offset < we) return edge === 'start' ? ws : we;
  }
  return offset;
}
