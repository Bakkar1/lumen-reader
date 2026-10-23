import { describe, expect, it } from 'vitest';
import { segment } from '@/lib/text/segment';

const sentencesOf = (text: string, lang = 'en') => segment(text, lang).map((s) => text.slice(s.start, s.end));

describe('segment — sentences', () => {
  it('acceptance: abbreviations, decimals and times give exactly two sentences', () => {
    expect(sentencesOf('Dr. Smith paid $3.50 at 5 p.m. on Friday. Then he left.')).toEqual([
      'Dr. Smith paid $3.50 at 5 p.m. on Friday.',
      'Then he left.',
    ]);
  });

  it.each([
    ['initials', 'Harbour master J. R. Penrose spoke first. Then the mayor spoke.'],
    ['titles', 'Mrs. Hale met Prof. Okafor at St. Ives today. They talked.'],
    ['e.g. before a capital', 'Use a full name, e.g. Gull Point Harbour. It works.'],
    ['an ellipsis mid-sentence', 'He waited... and waited some more. Then he left.'],
    ['a URL', 'Read example.com/docs.html for details. Then try it.'],
    ['a decimal', 'The tide rose 3.75 metres overnight. Boats floated free.'],
  ])('%s does not cause a false break', (_, text) => {
    expect(sentencesOf(text)).toHaveLength(2);
  });

  it('always splits at a block boundary, even without punctuation', () => {
    expect(sentencesOf('Introduction\nTidewater is a small tool. It predicts tides.')).toEqual([
      'Introduction',
      'Tidewater is a small tool.',
      'It predicts tides.',
    ]);
  });

  it('trims sentences and skips empty blocks', () => {
    const text = 'One.  Two!\n\nThree?';
    expect(sentencesOf(text)).toEqual(['One.', 'Two!', 'Three?']);
  });

  it('segments only a window of the text, with absolute offsets', () => {
    const text = 'Ignore this. Read this part. And this.';
    const start = text.indexOf('Read');
    const spans = segment(text, 'en', { start, end: text.length });
    expect(spans.map((s) => text.slice(s.start, s.end))).toEqual(['Read this part.', 'And this.']);
  });
});

describe('segment — words', () => {
  const text = 'Dr. Smith paid $3.50 at 5 p.m. on Friday. Then he left.\nThe Lighthouse lens, cleaned.';

  it('word offsets round-trip exactly to the words', () => {
    const spans = segment(text, 'en');
    const words = spans.flatMap((s) => s.words.map((w) => text.slice(w.start, w.end)));
    expect(words).toContain('Smith');
    expect(words).toContain('3.50');
    expect(words).toContain('Lighthouse');
    for (const s of spans) {
      for (const w of s.words) {
        expect(w.start).toBeGreaterThanOrEqual(s.start);
        expect(w.end).toBeLessThanOrEqual(s.end);
        expect(text.slice(w.start, w.end)).toMatch(/^\S+$/);
      }
    }
  });

  it('lists words in order without punctuation-only entries', () => {
    const [first] = segment('Hello, wide world!', 'en');
    expect(first!.words.map((w) => 'Hello, wide world!'.slice(w.start, w.end))).toEqual(['Hello', 'wide', 'world']);
  });
});
