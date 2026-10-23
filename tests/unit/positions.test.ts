import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PositionStore,
  SNIPPET_CHARS,
  positionRecord,
  resumeOffer,
  urlKey,
  type PositionRecord,
} from '@/lib/storage/positions';
import { MemoryArea } from './helpers/storage';

describe('urlKey', () => {
  it('drops the fragment', () => {
    expect(urlKey('https://example.com/post#comments')).toBe('https://example.com/post');
  });

  it('drops utm_*, fbclid and gclid but keeps other parameters in order', () => {
    expect(
      urlKey('https://example.com/post?id=7&utm_source=x&utm_medium=y&page=2&fbclid=abc&gclid=def&utm_campaign=z#top'),
    ).toBe('https://example.com/post?id=7&page=2');
  });

  it('drops an empty query left behind', () => {
    expect(urlKey('https://example.com/post?utm_source=news')).toBe('https://example.com/post');
  });

  it('gives every variant of the same page one key', () => {
    const keys = new Set(
      [
        'https://example.com/post',
        'https://example.com/post#intro',
        'https://example.com/post?utm_source=a',
        'https://example.com/post?fbclid=1#x',
      ].map(urlKey),
    );
    expect(keys.size).toBe(1);
  });

  it('keeps pages that differ in real parameters apart', () => {
    expect(urlKey('https://example.com/?p=1')).not.toBe(urlKey('https://example.com/?p=2'));
  });

  it('leaves something that is not a URL as it is, minus any fragment', () => {
    expect(urlKey('not a url#x')).toBe('not a url');
  });
});

describe('positionRecord', () => {
  const sentence = { text: 'The keeper climbed the stairs at dusk and lit the lamp before the storm reached the bay.', start: 120, end: 207 };

  it('stores the sentence index and offset, a snippet to verify it, and the time', () => {
    expect(positionRecord({ index: 4, sentence, finished: false }, 1000)).toEqual({
      sentenceIndex: 4,
      charOffset: 120,
      snippet: sentence.text.slice(0, SNIPPET_CHARS),
      finished: false,
      updatedAt: 1000,
    });
  });

  it('carries the finished flag', () => {
    expect(positionRecord({ index: 9, sentence, finished: true }, 5).finished).toBe(true);
  });
});

describe('resumeOffer', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const NOW = 100 * DAY;

  function refs(...texts: string[]) {
    let pos = 0;
    return texts.map((text) => {
      const s = { text, start: pos, end: pos + text.length };
      pos = s.end + 1;
      return s;
    });
  }

  const PAGE = refs('Intro.', 'The keeper climbed the stairs.', 'He lit the lamp.', 'The storm came.', 'He lit the lamp.');
  const saved = (index: number, extra: Partial<PositionRecord> = {}): PositionRecord => ({
    ...positionRecord({ index, sentence: PAGE[index]!, finished: false }, NOW - DAY),
    ...extra,
  });

  it('offers to resume at the stored sentence', () => {
    expect(resumeOffer(saved(3), PAGE, NOW)).toEqual({ kind: 'resume', index: 3, total: 5 });
  });

  it('finds the sentence when text was added before it', () => {
    const edited = refs('A new opening paragraph.', ...PAGE.map((s) => s.text));
    expect(resumeOffer(saved(3), edited, NOW)).toEqual({ kind: 'resume', index: 4, total: 6 });
  });

  it('picks the copy nearest the stored offset when the sentence repeats', () => {
    expect(resumeOffer(saved(4), PAGE, NOW)).toMatchObject({ index: 4 });
    expect(resumeOffer(saved(2), PAGE, NOW)).toMatchObject({ index: 2 });
  });

  it('offers nothing for a finished page', () => {
    expect(resumeOffer(saved(4, { finished: true }), PAGE, NOW)).toBeNull();
  });

  it('offers nothing at the very start or without a stored position', () => {
    expect(resumeOffer(saved(0), PAGE, NOW)).toBeNull();
    expect(resumeOffer(null, PAGE, NOW)).toBeNull();
  });

  it('never points at other text when the stored sentence is gone: it offers to start over', () => {
    const edited = refs('Intro.', 'The keeper climbed the stairs.', 'The storm came.');
    expect(resumeOffer(saved(2), edited, NOW)).toEqual({ kind: 'changed' });
  });

  it('offers nothing once the position is more than 30 days old', () => {
    expect(resumeOffer(saved(3, { updatedAt: NOW - 31 * DAY }), PAGE, NOW)).toBeNull();
    expect(resumeOffer(saved(3, { updatedAt: NOW - 29 * DAY }), PAGE, NOW)).not.toBeNull();
  });
});

describe('PositionStore', () => {
  it('stores positions per page key in local storage and reads them back', async () => {
    const area = new MemoryArea('local');
    const store = new PositionStore(area);
    const record = { sentenceIndex: 3, charOffset: 50, snippet: 'Hello there.', finished: false, updatedAt: 10 };
    await store.save('https://example.com/a', record);
    expect(await store.get('https://example.com/a')).toEqual(record);
    expect(await store.get('https://example.com/b')).toBeNull();
    expect(Object.keys(area.data)).toEqual(['lumen:pos:https://example.com/a']);
  });

  describe('pruning', () => {
    const DAY = 24 * 60 * 60 * 1000;
    beforeEach(() => vi.useFakeTimers({ now: new Date('2026-10-22T09:00:00Z') }));
    afterEach(() => vi.useRealTimers());

    const record = (updatedAt: number, snippet = 'He lit the lamp.') => ({
      sentenceIndex: 2,
      charOffset: 40,
      snippet,
      finished: false,
      updatedAt,
    });

    it('removes an entry last updated 31 days ago, which is then not offered', async () => {
      const area = new MemoryArea('local');
      const store = new PositionStore(area);
      await store.save('old', record(Date.now() - 31 * DAY));
      await store.save('recent', record(Date.now() - 29 * DAY));
      area.data['lumen:setting:theme'] = 'dark';

      expect(await store.prune()).toBe(1);
      expect(Object.keys(area.data).sort()).toEqual(['lumen:pos:recent', 'lumen:setting:theme']);
      expect(await store.get('old')).toBeNull();
      const page = [{ text: 'Intro.', start: 0 }, { text: 'x', start: 7 }, { text: 'He lit the lamp.', start: 40 }];
      expect(resumeOffer(await store.get('old'), page, Date.now())).toBeNull();
      expect(resumeOffer(await store.get('recent'), page, Date.now())).toMatchObject({ kind: 'resume', index: 2 });
    });

    it('keeps an entry until it is more than 30 days old, as the clock moves on', async () => {
      const area = new MemoryArea('local');
      const store = new PositionStore(area);
      await store.save('page', record(Date.now()));

      vi.advanceTimersByTime(30 * DAY);
      expect(await store.prune()).toBe(0);
      vi.advanceTimersByTime(DAY);
      expect(await store.prune()).toBe(1);
      expect(await store.get('page')).toBeNull();
    });

    it('also removes malformed entries', async () => {
      const area = new MemoryArea('local');
      area.data['lumen:pos:junk'] = 'nope';
      expect(await new PositionStore(area).prune()).toBe(1);
      expect(area.data).toEqual({});
    });
  });

  it('ignores a malformed stored entry', async () => {
    const area = new MemoryArea('local');
    area.data['lumen:pos:k'] = { sentenceIndex: 'x' };
    expect(await new PositionStore(area).get('k')).toBeNull();
  });
});
