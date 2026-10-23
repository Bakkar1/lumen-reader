import { describe, expect, it } from 'vitest';
import { walkText } from '@/lib/text/walker';
import { HeuristicContentLocator } from '@/lib/text/locator';
import { LUMEN_HOST_ATTR } from '@/lib/text/dom-rules';
import { loadFixture, setBody, type FixturePage } from './helpers/fixtures';

const pageText = (name: FixturePage) => {
  loadFixture(name);
  return walkText(new HeuristicContentLocator().locate(document), { skipBoilerplate: true }).text;
};

describe('walkText', () => {
  it('skips display:none, visibility:hidden, aria-hidden, scripts and noscript', () => {
    const text = pageText('hidden-content');
    expect(text).not.toMatch(/skipped|script text|Noscript/);
    expect(text).toBe(
      [
        'The first visible paragraph is plain text that anyone can read on the page.',
        'The second visible paragraph has a gap and a word removed.',
        'The third visible paragraph ends the page.',
      ].join('\n'),
    );
  });

  it('news article: headline first, paragraphs in order, no hidden or page furniture', () => {
    const text = pageText('news-article');
    expect(text.startsWith('Harbour town relights its lighthouse after forty years\nBy Ada Whitlock')).toBe(true);
    expect(text).not.toMatch(/Local news|Most read|Copyright|cookies|must never be read|invisible|Decorative/);
    const order = ['Gull Point', 'Dr. Smith', 'gallery rail', 'A beacon for the community', 'Penrose', 'winter solstice'];
    const positions = order.map((s) => text.indexOf(s));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('joins a word split across inline elements', () => {
    expect(pageText('news-article')).toContain('The Lighthouse lens itself');
  });

  it('ends a block at a heading without a full stop', () => {
    expect(pageText('docs')).toMatch(/^Getting started\nIntroduction\nTidewater is a small/);
  });

  it('skips page furniture inside the container (breadcrumb, form controls)', () => {
    const text = pageText('docs');
    expect(text).not.toContain('Guides');
    expect(text).not.toContain('Typed feedback text');
    expect(text).not.toContain('Send');
  });

  it('collapses whitespace and keeps a source map back to the text nodes', () => {
    setBody('<p>  Alpha \n  <b>beta</b>\tgamma  </p><p>delta<br>epsilon</p>');
    const { text, segments } = walkText(document.body, { skipBoilerplate: true });
    expect(text).toBe('Alpha beta gamma\ndelta\nepsilon');
    for (const s of segments) {
      const fromText = text.slice(s.textStart, s.textStart + s.length);
      const fromNode = s.node.data.slice(s.nodeStart, s.nodeStart + s.length);
      expect(fromText.replace(/\s/g, ' ')).toBe(fromNode.replace(/\s/g, ' '));
    }
    // Every non-newline character is mapped exactly once.
    const mapped = segments.reduce((n, s) => n + s.length, 0);
    expect(mapped).toBe(text.replace(/\n/g, '').length);
  });

  it("never reads Lumen Reader's own host", () => {
    setBody(`<p>Page text that is long enough.</p><div ${LUMEN_HOST_ATTR}>Player label</div>`);
    expect(walkText(document.body, { skipBoilerplate: true }).text).toBe('Page text that is long enough.');
  });

  it('keeps boilerplate when asked to (selection reading)', () => {
    setBody('<nav>Menu text</nav><p>Body.</p>');
    expect(walkText(document.body, { skipBoilerplate: false }).text).toBe('Menu text\nBody.');
    expect(walkText(document.body, { skipBoilerplate: true }).text).toBe('Body.');
  });

  it('does not change the DOM', () => {
    loadFixture('news-article');
    const before = document.documentElement.outerHTML;
    walkText(document.body, { skipBoilerplate: true });
    expect(document.documentElement.outerHTML).toBe(before);
  });
});
