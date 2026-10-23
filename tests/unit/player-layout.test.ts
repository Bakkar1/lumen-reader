import { describe, expect, it } from 'vitest';
import { EDGE_MARGIN, clampTop, formatRemaining, remainingMs } from '@/lib/player/layout';
import { MS_PER_CHAR } from '@/lib/highlight/word-estimator';

describe('clampTop', () => {
  it('keeps a position that already fits', () => {
    expect(clampTop(200, 100, 800)).toBe(200);
  });

  it('pulls the player back inside the bottom and top edges', () => {
    expect(clampTop(750, 100, 800)).toBe(800 - 100 - EDGE_MARGIN);
    expect(clampTop(-40, 100, 800)).toBe(EDGE_MARGIN);
  });

  it('pins a player taller than the viewport to the top', () => {
    expect(clampTop(300, 900, 600)).toBe(EDGE_MARGIN);
  });
});

describe('remainingMs', () => {
  const sentences = [
    { start: 0, end: 10 },
    { start: 11, end: 31 },
    { start: 32, end: 52 },
  ];

  it('counts the characters from the current sentence to the end, at the effective rate', () => {
    expect(remainingMs(sentences, 1, 1)).toBe((52 - 11) * MS_PER_CHAR);
    expect(remainingMs(sentences, 1, 2)).toBe(((52 - 11) * MS_PER_CHAR) / 2);
  });

  it('is zero past the end and for no text', () => {
    expect(remainingMs(sentences, 3, 1)).toBe(0);
    expect(remainingMs([], 0, 1)).toBe(0);
  });
});

describe('formatRemaining', () => {
  it.each([
    [0, '0:00'],
    [42_400, '0:42'],
    [61_000, '1:01'],
    [725_000, '12:05'],
    [3_723_000, '1:02:03'],
  ])('%d ms → %s', (ms, text) => {
    expect(formatRemaining(ms)).toBe(text);
  });
});
