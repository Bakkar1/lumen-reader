import { describe, expect, it } from 'vitest';
import { FIXTURE_PAGES, loadFixture } from './helpers/fixtures';

describe('saved fixture pages', () => {
  it.each(FIXTURE_PAGES)('%s loads with readable body text', (name) => {
    loadFixture(name);
    expect(document.documentElement.lang).toBe('en');
    expect(document.body.textContent?.trim().length).toBeGreaterThan(100);
  });

  // Task 3.1: the DOM features extraction relies on work in happy-dom.
  it('supports TreeWalker, Range across text nodes and checkVisibility', () => {
    loadFixture('hidden-content');
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text);
    expect(texts.length).toBeGreaterThan(5);

    const range = document.createRange();
    const first = texts.find((t) => t.data.includes('first visible'))!;
    const last = texts.find((t) => t.data.includes('third visible'))!;
    range.setStart(first, 4);
    range.setEnd(last, 9);
    expect(range.toString().startsWith('first visible')).toBe(true);
    expect(range.toString().endsWith('The third')).toBe(true);

    const visible = (sel: string) =>
      document.querySelector(sel)!.checkVisibility({ visibilityProperty: true });
    expect(visible('.gone')).toBe(false);
    expect(visible('.ghost')).toBe(false);
    expect(visible('p')).toBe(true);
  });
});
