/**
 * Kokoro synthesises one chunk of text at a time and truncates long input
 * (510 phoneme tokens), so an utterance is cut into sentence-sized chunks.
 * Offsets are kept so that events can point back into the utterance text.
 */

export interface Chunk {
  text: string;
  /** Offset of `text` in the utterance. */
  offset: number;
}

/** Comfortably under Kokoro's token limit for English text. */
export const MAX_CHUNK_CHARS = 300;

/**
 * Nothing is heard until the first chunk is fully synthesised, so speech that
 * starts from silence opens with a short one; the rest is synthesised while it plays.
 */
export const FIRST_CHUNK_CHARS = 80;

const SENTENCE = /[^.!?…]*(?:[.!?…]+["'”’)\]]*|$)\s*/g;

export function splitChunks(text: string, maxChars = MAX_CHUNK_CHARS, firstMaxChars = maxChars): Chunk[] {
  const chunks: Chunk[] = [];
  for (const m of text.matchAll(SENTENCE)) {
    if (m[0].length === 0) continue;
    let offset = m.index;
    let rest = m[0];
    let limit = chunks.length === 0 ? firstMaxChars : maxChars;
    while (rest.length > limit) {
      const cut = breakPoint(rest, limit);
      push(chunks, rest.slice(0, cut), offset);
      offset += cut;
      rest = rest.slice(cut);
      limit = maxChars;
    }
    push(chunks, rest, offset);
  }
  return chunks;
}

/** After the last comma-like mark before the limit, else the last space, else the limit itself. */
function breakPoint(text: string, maxChars: number): number {
  const head = text.slice(0, maxChars);
  const punct = Math.max(head.lastIndexOf(', '), head.lastIndexOf('; '), head.lastIndexOf(': '), head.lastIndexOf(' — '));
  if (punct > maxChars / 3) return punct + 2;
  const space = head.lastIndexOf(' ');
  return space > 0 ? space + 1 : maxChars;
}

/** Whitespace-only pieces are dropped; the rest keep their leading offset. */
function push(chunks: Chunk[], text: string, offset: number): void {
  const lead = text.length - text.trimStart().length;
  const trimmed = text.trim();
  if (trimmed) chunks.push({ text: trimmed, offset: offset + lead });
}

export interface WordTiming {
  /** Seconds from the start of the chunk's audio. */
  at: number;
  /** Offset in the utterance. */
  charIndex: number;
  length: number;
}

/**
 * Kokoro gives no word boundaries, so words are placed in the chunk's audio
 * by their position in the text. Re-anchored on every chunk, the estimate
 * drifts at most within a sentence.
 */
export function wordTimings(chunk: Chunk, duration: number): WordTiming[] {
  const total = chunk.text.length;
  return [...chunk.text.matchAll(/\S+/g)].map((w) => ({
    at: total > 0 ? (w.index / total) * duration : 0,
    charIndex: chunk.offset + w.index,
    length: w[0].length,
  }));
}
