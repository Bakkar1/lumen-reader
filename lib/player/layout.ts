import { MS_PER_CHAR } from '../highlight/word-estimator';

/** Gap kept between the player and the top and bottom of the viewport. */
export const EDGE_MARGIN = 8;

/**
 * Keeps the player fully inside the viewport (floating-player "Draggable
 * placement"). A player taller than the viewport is pinned to the top.
 */
export function clampTop(top: number, height: number, viewportHeight: number): number {
  const max = viewportHeight - height - EDGE_MARGIN;
  return Math.max(EDGE_MARGIN, Math.min(top, max));
}

/**
 * Rough listening time left, from the start of the current sentence to the
 * end of the text, on the same cadence the word-timing estimate uses.
 */
export function remainingMs(sentences: { start: number; end: number }[], index: number, rate: number): number {
  const from = sentences[index]?.start;
  const to = sentences.at(-1)?.end;
  if (from === undefined || to === undefined) return 0;
  return ((to - from) * MS_PER_CHAR) / rate;
}

/** "0:42", "12:05", "1:02:03". */
export function formatRemaining(ms: number): string {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
