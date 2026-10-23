import { isBlock } from './dom-rules';
import type { Extraction } from './extract';

/** A paragraph that gets a hover play icon, and the sentence reading starts at. */
export interface ParagraphTarget {
  element: Element;
  sentenceIndex: number;
}

/** A paragraph needs more than this many words to get an icon (SPEC.md §11). */
const MIN_WORDS = 10;

/** Blocks that never get an icon, themselves or anywhere inside them. */
const EXCLUDED = 'h1, h2, h3, h4, h5, h6, li, td, th, pre, a, button, form, table, nav, aside, footer';

/**
 * The paragraphs of the main content that get a hover play icon
 * (floating-player "Paragraph play icons"), in reading order.
 */
export function findParagraphs(extraction: Extraction): ParagraphTarget[] {
  const blocks = new Map<Element, { sentenceIndex: number; words: number }>();
  extraction.sentences.forEach((s, i) => {
    const node = extraction.map.rangeFor(s.start, s.start + 1)?.startContainer;
    const block = node && blockOf(node, extraction.root);
    if (!block) return;
    const entry = blocks.get(block);
    if (entry) entry.words += s.words.length;
    else blocks.set(block, { sentenceIndex: i, words: s.words.length });
  });

  const out: ParagraphTarget[] = [];
  for (const [element, { sentenceIndex, words }] of blocks) {
    if (words > MIN_WORDS && !element.closest(EXCLUDED)) out.push({ element, sentenceIndex });
  }
  return out;
}

function blockOf(node: Node, root: Element): Element | null {
  for (let el = node.parentElement; el; el = el.parentElement) {
    if (el === root) return null;
    if (isBlock(el)) return el;
  }
  return null;
}
