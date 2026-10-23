import { describe, expect, it } from 'vitest';
import { HighlightRenderer } from '@/lib/highlight/renderer';
import { ReadingView } from '@/lib/highlight/reading-view';
import { extractPage } from '@/lib/text/extract';
import { loadFixture } from './helpers/fixtures';
import { fakeHighlightApi, playingState } from './helpers/highlight';

/** MutationObserver callbacks run as microtasks; let them (and our re-map) happen. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function readSpa() {
  loadFixture('spa');
  const ex = extractPage(document);
  const hl = fakeHighlightApi();
  const view = new ReadingView(ex, new HighlightRenderer(document, hl.api));
  view.onState(playingState({ total: ex.sentences.length }));
  const indexOf = (needle: string) => ex.sentences.findIndex((s) => ex.text.slice(s.start, s.end).includes(needle));
  const sentenceRange = () => [...hl.registry.get('lumen-sentence')!][0];
  return { ex, view, indexOf, sentenceRange, ...hl };
}

describe('tolerance for DOM changes (SPA fixture)', () => {
  it('a paragraph replaced by an identical copy: highlighting continues on the new nodes', async () => {
    const { ex, view, indexOf, sentenceRange, text } = readSpa();
    const i = indexOf('dining car');
    view.onSentence(i);
    const oldP = document.getElementById('p2')!;
    const copy = oldP.cloneNode(true) as Element;
    oldP.replaceWith(copy);
    await settle();

    expect(text('lumen-sentence')).toBe('In the dining car a waiter polished glasses that nobody would use.');
    expect(copy.contains(sentenceRange()!.startContainer)).toBe(true);
    expect(sentenceRange()!.startContainer.isConnected).toBe(true);
    view.onWord(i, ex.text.indexOf('waiter'));
    expect(text('lumen-word')).toBe('waiter');

    // Later sentences in the copy map too.
    view.onSentence(indexOf('rails sang'));
    expect(text('lumen-sentence')).toBe('He liked the quiet hours best, when the rails sang and the lamps swayed.');
    view.dispose();
  });

  it('the paragraph being read is removed: no highlight on unrelated text, and later text still maps', async () => {
    const { view, indexOf, text } = readSpa();
    const i = indexOf('dining car');
    view.onSentence(i);
    document.getElementById('p2')!.remove();
    await settle();

    expect(text('lumen-sentence')).toBe('');
    expect(text('lumen-word')).toBe('');
    // Speech carries on: events for the removed sentences are harmless.
    expect(() => view.onSentence(indexOf('rails sang'))).not.toThrow();
    expect(text('lumen-sentence')).toBe('');
    view.onSentence(indexOf('single lit platform'));
    expect(text('lumen-sentence')).toBe('Somewhere past midnight the train slowed for a single lit platform in the snow.');
    view.dispose();
  });

  it('edited text in the sentence being read hides that highlight instead of showing wrong text', async () => {
    const { view, indexOf, text } = readSpa();
    view.onSentence(indexOf('night train'));
    const t = document.getElementById('p1')!.firstChild as Text;
    t.data = 'Completely different words now stand here.';
    await settle();
    expect(text('lumen-sentence')).toBe('');
    view.dispose();
  });

  it('after dispose, mutations are no longer observed', async () => {
    const { view, indexOf, text } = readSpa();
    view.onSentence(indexOf('dining car'));
    view.dispose();
    document.getElementById('p2')!.replaceWith(document.getElementById('p2')!.cloneNode(true));
    await settle();
    expect(text('lumen-sentence')).toBe('');
  });
});
