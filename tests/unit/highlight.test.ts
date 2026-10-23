import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HighlightRenderer } from '@/lib/highlight/renderer';
import { estimateWordDurations, WordEstimator } from '@/lib/highlight/word-estimator';
import { ReadingView } from '@/lib/highlight/reading-view';
import { extractPage } from '@/lib/text/extract';
import { setBody } from './helpers/fixtures';
import { fakeHighlightApi, playingState as state } from './helpers/highlight';

describe('HighlightRenderer', () => {
  it('registers lumen-sentence and lumen-word and styles them through an adopted sheet', () => {
    setBody('<p>Alpha beta.</p>');
    const { api, registry, text } = fakeHighlightApi();
    const before = document.documentElement.outerHTML;
    const r = new HighlightRenderer(document, api);
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('p')!);
    r.show(range, null);
    expect(text('lumen-sentence')).toBe('Alpha beta.');
    expect(registry.get('lumen-word')!.size).toBe(0);
    expect(document.adoptedStyleSheets).toHaveLength(1);
    new HighlightRenderer(document, api); // a second instance does not add another sheet
    expect(document.adoptedStyleSheets).toHaveLength(1);
    expect(document.documentElement.outerHTML).toBe(before);
  });

  it('clear() removes every Lumen highlight', () => {
    setBody('<p>Alpha.</p>');
    const { api, registry } = fakeHighlightApi();
    const r = new HighlightRenderer(document, api);
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('p')!);
    r.show(range, range);
    r.clear();
    expect(registry.get('lumen-sentence')!.size + registry.get('lumen-word')!.size).toBe(0);
  });
});

describe('estimated word timing', () => {
  const text = 'Hi there, extraordinary friend.';
  const words = [...text.matchAll(/\w+/g)].map((m) => ({ start: m.index, end: m.index + m[0].length }));

  it('gives longer words more time and adds pauses after punctuation', () => {
    const d = estimateWordDurations(text, words, 1);
    expect(d[2]!).toBeGreaterThan(d[0]!); // "extraordinary" vs "Hi"
    expect(d[1]!).toBeGreaterThan(estimateWordDurations('Hi thereX extraordinary friend.', words, 1)[1]!);
  });

  it('scales with the effective rate', () => {
    const at1 = estimateWordDurations(text, words, 1);
    const at2 = estimateWordDurations(text, words, 2);
    at1.forEach((ms, i) => expect(at2[i]).toBeCloseTo(ms / 2));
  });

  it('WordEstimator steps through the words on a schedule and stops when told', () => {
    vi.useFakeTimers();
    const seen: number[] = [];
    const est = new WordEstimator();
    est.start(text, words, 1, (i) => seen.push(i));
    expect(seen).toEqual([0]);
    const d = estimateWordDurations(text, words, 1);
    vi.advanceTimersByTime(d[0]! + 1);
    expect(seen).toEqual([0, 1]);
    vi.advanceTimersByTime(d[1]! + d[2]! + 1);
    expect(seen).toEqual([0, 1, 2, 3]);
    est.stop();
    vi.advanceTimersByTime(10_000);
    expect(seen).toEqual([0, 1, 2, 3]);
    vi.useRealTimers();
  });
});

describe('ReadingView', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    setBody('<p>One two three four.</p><p>Five <em>six</em> seven.</p>');
    const ex = extractPage(document);
    const hl = fakeHighlightApi();
    const view = new ReadingView(ex, new HighlightRenderer(document, hl.api));
    return { ex, view, ...hl };
  }

  it('word events: the word highlight moves, the sentence highlight stays', () => {
    const { ex, view, text } = setup();
    view.onState(state());
    view.onSentence(0);
    expect(text('lumen-sentence')).toBe('One two three four.');
    expect(text('lumen-word')).toBe('One');
    view.onWord(0, ex.text.indexOf('three'));
    expect(text('lumen-word')).toBe('three');
    expect(text('lumen-sentence')).toBe('One two three four.');
    view.onSentence(1);
    view.onWord(1, ex.text.indexOf('six'));
    expect(text('lumen-sentence')).toBe('Five six seven.');
    expect(text('lumen-word')).toBe('six');
  });

  it('no word timing: the estimate advances and re-syncs at the next sentence', () => {
    const { view, text } = setup();
    view.onState(state({ noWordTiming: true }));
    view.onSentence(0);
    expect(text('lumen-word')).toBe('One');
    vi.advanceTimersByTime(600);
    expect(text('lumen-word')).not.toBe('One');
    // The voice reports the next sentence earlier than the estimate expected.
    view.onSentence(1);
    expect(text('lumen-word')).toBe('Five');
    expect(text('lumen-sentence')).toBe('Five six seven.');
  });

  it('a voice that should send word events but stays silent falls back to the estimate', () => {
    const { view, text } = setup();
    view.onState(state());
    view.onSentence(0);
    vi.advanceTimersByTime(2000);
    expect(text('lumen-word')).not.toBe('One');
  });

  it('real word events cancel the estimate', () => {
    const { ex, view, text } = setup();
    view.onState(state({ noWordTiming: true }));
    view.onSentence(0);
    view.onState(state({ noWordTiming: false }));
    view.onSentence(0);
    view.onWord(0, ex.text.indexOf('two'));
    vi.advanceTimersByTime(5000);
    expect(text('lumen-word')).toBe('two');
  });

  it('pause keeps the sentence and drops the word; stop clears everything', () => {
    const { view, text } = setup();
    view.onState(state());
    view.onSentence(0);
    view.onState(state({ status: 'paused' }));
    expect(text('lumen-sentence')).toBe('One two three four.');
    expect(text('lumen-word')).toBe('');
    view.onState(state({ status: 'stopped' }));
    expect(text('lumen-sentence') + text('lumen-word')).toBe('');
  });

  it('finished clears everything', () => {
    const { view, text } = setup();
    view.onState(state());
    view.onSentence(1);
    view.onFinished();
    expect(text('lumen-sentence') + text('lumen-word')).toBe('');
  });
});
