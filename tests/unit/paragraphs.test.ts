import { describe, expect, it } from 'vitest';
import { extractPage } from '@/lib/text/extract';
import { findParagraphs } from '@/lib/text/paragraphs';
import { loadFixture, setBody } from './helpers/fixtures';

const firstWords = (el: Element) => el.textContent!.trim().split(/\s+/).slice(0, 3).join(' ');

describe('findParagraphs', () => {
  it('offers paragraphs and quotes of more than ten words, each at its first sentence', () => {
    setBody(`
      <article>
        <h1>A heading that is long enough to have more than ten words in it</h1>
        <p>Too short to offer.</p>
        <p>The first long paragraph has well over ten words in it, so it qualifies. A second sentence follows.</p>
        <ul><li>A list item that is also long enough, with more than ten words in it.</li></ul>
        <blockquote>A quoted passage that is long enough, with more than ten words in total here.</blockquote>
        <form><p>A paragraph inside a form with more than ten words in it, for sure.</p></form>
        <table><tr><td>A table cell that has more than ten words of text in it as well.</td></tr></table>
        <p>The last paragraph has <em>inline emphasis</em> and more than ten words in it too.</p>
      </article>`);
    const extraction = extractPage(document);
    const targets = findParagraphs(extraction);

    expect(targets.map((t) => firstWords(t.element))).toEqual(['The first long', 'A quoted passage', 'The last paragraph']);
    for (const t of targets) {
      const s = extraction.sentences[t.sentenceIndex]!;
      expect(extraction.text.slice(s.start, s.end)).toMatch(new RegExp(`^${firstWords(t.element)}`));
    }
  });

  it('finds the article paragraphs of the news fixture in reading order', () => {
    loadFixture('news-article');
    const targets = findParagraphs(extractPage(document));
    expect(targets.map((t) => firstWords(t.element))).toEqual([
      'The old lighthouse',
      'The restoration took',
      'Volunteers replaced the',
      'Harbour master J.',
      'The lamp will',
    ]);
    const indices = targets.map((t) => t.sentenceIndex);
    expect([...indices].sort((a, b) => a - b)).toEqual(indices);
  });
});
