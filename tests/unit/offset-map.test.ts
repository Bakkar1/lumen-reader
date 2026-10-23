import { describe, expect, it } from 'vitest';
import { extractPage, extractSelection } from '@/lib/text/extract';
import { loadFixture, setBody } from './helpers/fixtures';

function textNodeContaining(s: string): Text {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if ((n as Text).data.includes(s)) return n as Text;
  }
  throw new Error(`no text node with "${s}"`);
}

function select(startNode: Text, startOffset: number, endNode: Text, endOffset: number): Selection {
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  return sel;
}

describe('OffsetMap — offset → Range', () => {
  it('a word split across inline elements covers both text nodes exactly', () => {
    loadFixture('news-article');
    const { text, map } = extractPage(document);
    const start = text.indexOf('Lighthouse lens');
    const range = map.rangeFor(start, start + 'Lighthouse'.length)!;
    expect(range.toString()).toBe('Lighthouse');
    expect((range.startContainer as Text).data).toBe('Light');
    expect((range.endContainer as Text).data).toMatch(/^house lens/);
  });

  it('maps every sentence back to a range with the same text (modulo whitespace)', () => {
    loadFixture('news-article');
    const { text, map, sentences } = extractPage(document);
    for (const s of sentences) {
      const range = map.rangeFor(s.start, s.end)!;
      expect(range.toString().replace(/\s+/g, ' ')).toBe(text.slice(s.start, s.end));
    }
  });

  it('returns null for text whose nodes left the page', () => {
    setBody('<p id="a">First paragraph here.</p><p>Second one.</p>');
    const { map } = extractPage(document);
    document.getElementById('a')!.remove();
    expect(map.rangeFor(0, 5)).toBeNull();
    expect(map.rangeFor(22, 28)).not.toBeNull();
  });
});

describe('OffsetMap — DOM point → offset', () => {
  it('returns the offset of the word at a point (e.g. a click)', () => {
    loadFixture('news-article');
    const ex = extractPage(document);
    const node = textNodeContaining('rusted gallery rail');
    const offset = ex.map.offsetAt(node, node.data.indexOf('gallery') + 3);
    const word = ex.wordAt(offset)!;
    expect(ex.text.slice(word.start, word.end)).toBe('gallery');
    expect(ex.sentenceIndexAt(offset)).toBe(ex.sentences.findIndex((s) => ex.text.slice(s.start, s.end).includes('gallery')));
  });

  it('maps a point in collapsed whitespace or an element to the nearest offset', () => {
    setBody('<p>Alpha    <b>beta</b></p><p>gamma</p>');
    const ex = extractPage(document);
    const alpha = textNodeContaining('Alpha');
    expect(ex.map.offsetAt(alpha, 7)).toBe(6); // inside the collapsed run → after "Alpha "
    const secondP = document.querySelectorAll('p')[1]!;
    expect(ex.map.offsetAt(secondP, 0)).toBe(ex.text.indexOf('gamma'));
  });
});

describe('extractSelection', () => {
  it('a selection spanning paragraphs reads only the selected words', () => {
    loadFixture('news-article');
    const a = textNodeContaining('took three years');
    const b = textNodeContaining('rusted gallery');
    select(a, a.data.indexOf('three years'), b, b.data.indexOf('gallery') + 'gallery'.length);
    const ex = extractSelection(window.getSelection()!)!;
    const read = ex.sentences.map((s) => ex.text.slice(s.start, s.end));
    expect(read[0]).toBe('three years and was paid for almost entirely by local donations.');
    expect(read.at(-1)).toBe('Volunteers replaced the rusted gallery');
    expect(read.join(' ')).not.toContain('restoration');
    expect(read.join(' ')).not.toContain('rail');
  });

  it('a mid-word selection is expanded to whole words at both ends', () => {
    setBody('<p>The jar was empty when the volunteer arrived.</p>');
    const t = textNodeContaining('empty');
    select(t, t.data.indexOf('empty') + 2, t, t.data.indexOf('volunteer') + 4);
    const ex = extractSelection(window.getSelection()!)!;
    expect(ex.sentences.map((s) => ex.text.slice(s.start, s.end))).toEqual(['empty when the volunteer']);
  });

  it('expands across an inline element boundary', () => {
    setBody('<p>We cleaned the <a href="#">Light</a>house lens.</p>');
    const t = textNodeContaining('Light');
    select(t, 2, textNodeContaining('lens'), 3);
    const ex = extractSelection(window.getSelection()!)!;
    expect(ex.text.slice(ex.sentences[0]!.start, ex.sentences.at(-1)!.end)).toBe('Lighthouse');
  });

  it('returns null for an empty selection', () => {
    setBody('<p>Text.</p>');
    window.getSelection()!.removeAllRanges();
    expect(extractSelection(window.getSelection()!)).toBeNull();
  });

  it('leaves the serialized DOM unchanged', () => {
    loadFixture('news-article');
    const before = document.documentElement.outerHTML;
    extractPage(document);
    const t = textNodeContaining('Gull Point');
    select(t, 4, t, 20);
    extractSelection(window.getSelection()!);
    expect(document.documentElement.outerHTML).toBe(before);
  });
});
