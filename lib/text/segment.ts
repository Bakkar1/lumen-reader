/** Offsets are into the full extracted text. */
export interface WordSpan {
  start: number;
  end: number;
}

export interface SentenceSpan {
  start: number;
  end: number;
  words: WordSpan[];
}

/** Abbreviations that are practically never the end of a sentence. */
const NEVER_FINAL = new Set([
  'mr.', 'mrs.', 'ms.', 'mx.', 'dr.', 'prof.', 'st.', 'mt.', 'ft.', 'vs.', 'e.g.', 'i.e.', 'cf.',
  'fig.', 'approx.', 'dept.', 'rev.', 'gen.', 'col.', 'capt.', 'lt.', 'sgt.', 'gov.', 'sen.', 'rep.',
]);

/**
 * Splits text into sentences and words with Intl.Segmenter in the page's
 * language (design §5), plus a post-pass for false breaks after titles,
 * initials and abbreviations. "\n" (a block boundary) always ends a sentence.
 *
 * `window` limits segmentation to part of the text (a selection); offsets stay absolute.
 */
export function segment(text: string, lang: string, window = { start: 0, end: text.length }): SentenceSpan[] {
  const sentenceSeg = new Intl.Segmenter(safeLocale(lang), { granularity: 'sentence' });
  const wordSeg = new Intl.Segmenter(safeLocale(lang), { granularity: 'word' });
  const out: SentenceSpan[] = [];

  let blockStart = window.start;
  while (blockStart < window.end) {
    const nl = text.indexOf('\n', blockStart);
    const blockEnd = nl === -1 || nl > window.end ? window.end : nl;
    const block = text.slice(blockStart, blockEnd);

    let pending: { start: number; end: number } | null = null;
    for (const s of sentenceSeg.segment(block)) {
      const span = trim(text, blockStart + s.index, blockStart + s.index + s.segment.length);
      if (!span) continue;
      if (pending && continuesSentence(text.slice(pending.start, pending.end), text.slice(span.start, span.end))) {
        pending.end = span.end;
        continue;
      }
      if (pending) out.push(withWords(text, pending, wordSeg));
      pending = span;
    }
    if (pending) out.push(withWords(text, pending, wordSeg));
    blockStart = blockEnd + 1;
  }
  // Nothing to speak in punctuation-only "sentences" such as a lone "•".
  return out.filter((s) => s.words.length > 0);
}

/** Whether `next` is really the continuation of `prev` (a false break). */
function continuesSentence(prev: string, next: string): boolean {
  const last = prev.split(/\s+/).at(-1)?.replace(/^[("'“‘[]+/, '') ?? '';
  if (NEVER_FINAL.has(last.toLowerCase())) return true;
  // A single initial ("J.") is followed by more of the name.
  if (/^\p{Lu}\.$/u.test(last)) return true;
  // After an abbreviation or ellipsis, a lowercase word or a number continues the sentence.
  if (/(\.|…)$/.test(last) && /^[\p{Ll}\p{N}]/u.test(next)) return true;
  return false;
}

function withWords(text: string, span: { start: number; end: number }, wordSeg: Intl.Segmenter): SentenceSpan {
  const words: WordSpan[] = [];
  for (const w of wordSeg.segment(text.slice(span.start, span.end))) {
    if (w.isWordLike) words.push({ start: span.start + w.index, end: span.start + w.index + w.segment.length });
  }
  return { start: span.start, end: span.end, words };
}

function trim(text: string, start: number, end: number): { start: number; end: number } | null {
  while (start < end && /\s/.test(text[start]!)) start++;
  while (end > start && /\s/.test(text[end - 1]!)) end--;
  return start < end ? { start, end } : null;
}

function safeLocale(lang: string): string | undefined {
  try {
    return Intl.getCanonicalLocales(lang)[0];
  } catch {
    return undefined;
  }
}
