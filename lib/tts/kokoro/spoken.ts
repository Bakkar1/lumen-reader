/**
 * Kokoro reads `docs/x.md` as "docs x md" (its normaliser silences the dot),
 * so paths, filenames and domains are rewritten word by word into the words a
 * listener should hear. Only the text sent to the synthesiser changes; the
 * displayed text and its offsets stay as they are.
 */
export function spokenText(text: string): string {
  return text.replace(/\S+/g, spokenWord);
}

/**
 * A dot followed by a letter, digit, `/` or `./`: inside a path, filename or domain, not a sentence end.
 * Shared with the chunker, so that speaking and chunking agree on which dots are inside a word.
 */
export const INSIDE_WORD_DOT = String.raw`\.(?=[\p{L}\p{N}/]|\.\/)`;

/** Opening quotes and brackets that may come before a word. */
const OPENING = `[("'“‘[]`;

const SPOKEN_DOT = new RegExp(INSIDE_WORD_DOT, 'gu');
const HAS_SPOKEN_DOT = new RegExp(INSIDE_WORD_DOT, 'u');

/** `e.g.`, `i.e.,`, `(U.S.A.)`: single letters each followed by a dot, maybe wrapped in punctuation. */
const ABBREVIATION = new RegExp(String.raw`^${OPENING}*\p{L}(?:\.\p{L})+\.[)"'”’\],;:!?]*$`, 'u');

/** `https://`, `ftp://`: a URL scheme at the start of a word, after any opening quotes or brackets, with something after it to read. */
const URL_SCHEME = new RegExp(String.raw`^(${OPENING}*)\p{L}[\p{L}\p{N}+.-]*:\/\/(?=[\p{L}\p{N}])`, 'u');

/** `/`, `./`, `../` or `~/` at the start of a word, after any opening quotes or brackets. */
const PATH_START = new RegExp(String.raw`^${OPENING}*(?:\/|\.\.?\/|~\/)`, 'u');
const HOME = new RegExp(String.raw`^(${OPENING}*)~\/`, 'u');
const SPACE_AFTER_OPENING = new RegExp(String.raw`^(${OPENING}+) `, 'u');

/** `name@example.com`: something before a single `@`, and a dotted domain after it. */
const EMAIL = /^[^@]*[\p{L}\p{N}_%+-]@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+[^@]*$/u;

function spokenWord(original: string): string {
  if (ABBREVIATION.test(original)) return original;
  const word = original.replace(URL_SCHEME, '$1');
  const decimal = (word.match(/\p{N}\.(?=\p{N})/gu) ?? []).length === 1;
  let hasSpokenDot = false;
  let spoken = word.replace(SPOKEN_DOT, (dot, i: number) => {
    if ((decimal && isDecimalDot(word, i)) || isInEllipsis(word, i)) return dot;
    hasSpokenDot = true;
    return ' dot ';
  });
  const pathLike = isPathLike(word);
  if (pathLike) {
    spoken = spoken.replace(HOME, '$1home/').replace(/\//g, ' slash ');
  }
  if (EMAIL.test(word)) spoken = spoken.replace('@', ' at ');
  if (pathLike || hasSpokenDot) spoken = spoken.replace(/[-_]/g, ' ');
  return spoken
    .replace(/ {2,}/g, ' ')
    .trim()
    .replace(SPACE_AFTER_OPENING, '$1')
    .replace(/ ([)"'”’\],;:!?.]+)$/, '$1');
}

/** A dot between two digits (`3.14`) is left for Kokoro to read as "point", if it is the word's only one (not `1.2.3`). */
function isDecimalDot(word: string, i: number): boolean {
  return /\p{N}/u.test(word[i - 1] ?? '') && /\p{N}/u.test(word[i + 1] ?? '');
}

/** Part of a run of two or more dots (`wait...what`), except `..` directly before `/` (`../lib`). */
function isInEllipsis(word: string, i: number): boolean {
  let start = i;
  while (word[start - 1] === '.') start--;
  let end = i + 1;
  while (word[end] === '.') end++;
  const run = end - start;
  return run >= 2 && !(run === 2 && word[end] === '/');
}

/**
 * Starts with `/`, `./`, `../` or `~/` (after any opening quotes or brackets), contains two or more `/`,
 * or a `/` and a dot. A sentence-ending dot (`km/h.`) does not count: only a dot the dot rule would voice.
 */
function isPathLike(word: string): boolean {
  const slashes = word.split('/').length - 1;
  return (
    PATH_START.test(word) ||
    slashes >= 2 ||
    (slashes === 1 && HAS_SPOKEN_DOT.test(word))
  );
}
