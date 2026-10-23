import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClickToJump } from '@/lib/navigation/click-to-jump';
import { LiveMapping } from '@/lib/highlight/live-mapping';
import { extractPage } from '@/lib/text/extract';
import { setBody } from './helpers/fixtures';

const PAGE = `
  <nav class="menu"><p id="nav">Home and other places you can go from here today.</p></nav>
  <article>
    <h1 id="h">The Lighthouse</h1>
    <p id="p1">The keeper climbed the stairs at dusk. He lit the lamp.</p>
    <p id="p2">Ships passed in the night. One of them <a id="link" href="#elsewhere">signalled back</a> twice.</p>
    <p id="p3">Morning came slowly over the grey water.</p>
  </article>
  <lumen-reader data-lumen-reader><span id="ours">Play</span></lumen-reader>
`;

describe('ClickToJump', () => {
  let jumps: number[];
  let playing: boolean;
  /** Where the next click "lands" in the text (stands in for caretPositionFromPoint). */
  let point: { node: Node; offset: number } | null;
  let mapping: LiveMapping;
  let ctj: ClickToJump;

  const textOf = (id: string) => document.getElementById(id)!.firstChild!;
  const sentenceOf = (needle: string) =>
    mapping.extraction.sentences.findIndex((s) => mapping.extraction.text.slice(s.start, s.end).includes(needle));

  /** A press and release at (x, y) → (x2, y2), then the click, all on `target`. */
  function click(target: Element, at: { node: Node; offset: number } | null, opts: { dx?: number; button?: number } = {}) {
    point = at;
    const button = opts.button ?? 0;
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true, clientX: 10, clientY: 10, button }));
    const x = 10 + (opts.dx ?? 0);
    target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true, clientX: x, clientY: 10, button }));
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: 10, button });
    target.dispatchEvent(event);
    return event;
  }

  beforeEach(() => {
    setBody(PAGE);
    jumps = [];
    playing = true;
    point = null;
    mapping = new LiveMapping(extractPage(document));
    ctj = new ClickToJump(document, {
      isActive: () => playing,
      sentenceAt: (node, offset) => mapping.sentenceIndexAt(node, offset),
      onJump: (index) => jumps.push(index),
      pointAt: () => point,
    });
    ctj.attach();
  });

  afterEach(() => {
    ctj.detach();
    document.getSelection()?.removeAllRanges();
  });

  it("jumps to the start of the clicked word's sentence while playing", () => {
    // "night" in "Ships passed in the night."
    const event = click(document.getElementById('p2')!, { node: textOf('p2'), offset: 22 });
    expect(jumps).toEqual([sentenceOf('Ships passed')]);
    // The page's own click is not blocked.
    expect(event.defaultPrevented).toBe(false);
  });

  it('a click in a later sentence of the same paragraph jumps to that sentence', () => {
    click(document.getElementById('p1')!, { node: textOf('p1'), offset: 43 }); // "lit"
    expect(jumps).toEqual([sentenceOf('He lit the lamp')]);
  });

  it('listens in the capture phase, so a page handler that stops propagation does not block it', () => {
    document.getElementById('p3')!.addEventListener('click', (e) => e.stopPropagation());
    click(document.getElementById('p3')!, { node: textOf('p3'), offset: 3 });
    expect(jumps).toEqual([sentenceOf('Morning came')]);
  });

  it('does nothing while paused or stopped', () => {
    playing = false;
    click(document.getElementById('p3')!, { node: textOf('p3'), offset: 3 });
    expect(jumps).toEqual([]);
  });

  it('ignores clicks on links and leaves them to navigate', () => {
    const link = document.getElementById('link')!;
    const event = click(link, { node: link.firstChild!, offset: 2 });
    expect(jumps).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it('ignores a drag (the pointer moved between press and release)', () => {
    click(document.getElementById('p3')!, { node: textOf('p3'), offset: 3 }, { dx: 40 });
    expect(jumps).toEqual([]);
  });

  it('ignores the click that ends a selection', () => {
    const range = document.createRange();
    range.setStart(textOf('p3'), 0);
    range.setEnd(textOf('p3'), 7);
    document.getSelection()!.addRange(range);
    click(document.getElementById('p3')!, { node: textOf('p3'), offset: 3 });
    expect(jumps).toEqual([]);
    expect(document.getSelection()!.toString()).toBe('Morning');
  });

  it('ignores clicks that are not the primary button', () => {
    click(document.getElementById('p3')!, { node: textOf('p3'), offset: 3 }, { button: 2 });
    expect(jumps).toEqual([]);
  });

  it("ignores clicks on Lumen Reader's own UI", () => {
    const ours = document.getElementById('ours')!;
    click(ours, { node: ours.firstChild!, offset: 1 });
    expect(jumps).toEqual([]);
  });

  it('ignores clicks on text that is not being read', () => {
    click(document.getElementById('nav')!, { node: textOf('nav'), offset: 3 });
    expect(jumps).toEqual([]);
  });

  it('ignores clicks where no text position can be found', () => {
    click(document.getElementById('p3')!, null);
    expect(jumps).toEqual([]);
  });

  it('stops listening after detach', () => {
    ctj.detach();
    click(document.getElementById('p3')!, { node: textOf('p3'), offset: 3 });
    expect(jumps).toEqual([]);
  });
});
