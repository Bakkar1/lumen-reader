import { isBlock, isDisplayed, isInsideExcluded, isNeverRead, isBoilerplate, isTextVisible } from './dom-rules';

/**
 * Finds the element holding a page's main readable content (design §5).
 * An interface so another method (e.g. a Readability hybrid) can be swapped in.
 */
export interface ContentLocator {
  locate(doc: Document): Element;
}

/** Readable characters an <article>/<main> needs to be trusted outright. */
const SUBSTANTIAL_CHARS = 200;
/** An outer landmark yields to an inner one that holds at least this share of its text. */
const INNER_SHARE = 0.7;
/** A block needs this many direct characters to count as a paragraph. */
const PARAGRAPH_CHARS = 25;
/** Below this best score there is no detectable article: read the body. */
const MIN_SCORE = 150;

interface BlockText {
  /** Readable characters directly in this block (not in nested blocks). */
  chars: number;
  /** Of which inside links. */
  linkChars: number;
}

/**
 * Our own live-DOM heuristic (SPEC.md §13, option B):
 * 1. exactly one substantial <article>/<main>/[role=main] → use it;
 * 2. otherwise score block containers by paragraph text, penalising link density;
 * 3. fall back to <body>.
 */
export class HeuristicContentLocator implements ContentLocator {
  locate(doc: Document): Element {
    const body = doc.body ?? doc.documentElement;
    const blocks = measureBlocks(body);
    const subtree = sumSubtrees(blocks, body);
    return this.landmark(doc, subtree) ?? this.densest(body, blocks, subtree) ?? body;
  }

  private landmark(doc: Document, subtree: Map<Element, BlockText>): Element | null {
    const total = (el: Element) => subtree.get(el)?.chars ?? 0;
    let candidates = [...doc.querySelectorAll('article, main, [role="main"]')].filter(
      (el) => isDisplayed(el) && !isInsideExcluded(el) && total(el) >= SUBSTANTIAL_CHARS,
    );
    // A <main> that merely wraps one <article> yields to the article.
    candidates = candidates.filter(
      (outer) => !candidates.some((inner) => inner !== outer && outer.contains(inner) && total(inner) >= INNER_SHARE * total(outer)),
    );
    return candidates.length === 1 ? candidates[0]! : null;
  }

  private densest(body: Element, blocks: Map<Element, BlockText>, subtree: Map<Element, BlockText>): Element | null {
    const scores = new Map<Element, number>();
    const add = (el: Element | null, score: number) => {
      if (el && body.contains(el)) scores.set(el, (scores.get(el) ?? 0) + score);
    };
    for (const [block, t] of blocks) {
      if (t.chars < PARAGRAPH_CHARS) continue;
      const score = t.chars - t.linkChars;
      if (score <= 0) continue;
      const parent = block.parentElement;
      add(parent, score);
      add(parent?.parentElement ?? null, score / 2);
    }

    let best: Element | null = null;
    let bestScore = MIN_SCORE;
    for (const [el, raw] of scores) {
      if (isInsideExcluded(el)) continue;
      const { chars, linkChars } = subtree.get(el) ?? { chars: 0, linkChars: 0 };
      const score = raw * (1 - (chars ? linkChars / chars : 0));
      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    }
    return best;
  }
}

/** Direct readable text per block element, skipping hidden and boilerplate content. */
function measureBlocks(root: Element): Map<Element, BlockText> {
  const blocks = new Map<Element, BlockText>();
  const visit = (el: Element, block: Element, inLink: boolean) => {
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const n = (child as Text).data.replace(/\s+/g, ' ').trim().length;
        if (!n || !isTextVisible(el)) continue;
        const t = blocks.get(block) ?? { chars: 0, linkChars: 0 };
        t.chars += n;
        if (inLink) t.linkChars += n;
        blocks.set(block, t);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const c = child as Element;
        if (isNeverRead(c) || isBoilerplate(c) || !isDisplayed(c)) continue;
        visit(c, isBlock(c) ? c : block, inLink || c.tagName === 'A');
      }
    }
  };
  visit(root, root, false);
  return blocks;
}

/** Readable text of every element's subtree, summed up each block's ancestor chain. */
function sumSubtrees(blocks: Map<Element, BlockText>, root: Element): Map<Element, BlockText> {
  const sums = new Map<Element, BlockText>();
  for (const [block, t] of blocks) {
    for (let el: Element | null = block; el; el = el === root ? null : el.parentElement) {
      const s = sums.get(el) ?? { chars: 0, linkChars: 0 };
      s.chars += t.chars;
      s.linkChars += t.linkChars;
      sums.set(el, s);
    }
  }
  return sums;
}
