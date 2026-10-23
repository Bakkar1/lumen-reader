import { describe, expect, it } from 'vitest';
import { HeuristicContentLocator } from '@/lib/text/locator';
import { loadFixture, setBody } from './helpers/fixtures';

const locate = () => new HeuristicContentLocator().locate(document);

describe('HeuristicContentLocator — main content detection', () => {
  it('news article: picks the single <article>', () => {
    loadFixture('news-article');
    expect(locate()).toBe(document.querySelector('article'));
  });

  it('docs page: picks <main>, not the docs navigation', () => {
    loadFixture('docs');
    expect(locate()).toBe(document.querySelector('main'));
  });

  it('blog without semantic tags: picks the post body by text density', () => {
    loadFixture('blog');
    expect(locate()).toBe(document.querySelector('.post-body'));
  });

  it('SPA snapshot: picks the story section, not the app menu', () => {
    loadFixture('spa');
    expect(locate()).toBe(document.querySelector('section.story'));
  });

  it('hidden-content page: picks the content wrapper', () => {
    loadFixture('hidden-content');
    expect(locate()).toBe(document.querySelector('body > div'));
  });

  it('no article structure: falls back to the body', () => {
    setBody('<div>Short note.</div><span>Another bit of text</span><div><a href="#">A link</a></div>');
    expect(locate()).toBe(document.body);
  });

  it('prefers the inner <article> when <main> only wraps it', () => {
    setBody(`<main><div class="share">Share</div><article>${'<p>Plenty of article text goes here, sentence after sentence.</p>'.repeat(5)}</article></main>`);
    expect(locate()).toBe(document.querySelector('article'));
  });

  it('ignores an <article> that holds no substantial text', () => {
    setBody(`<article>Tiny</article><div class="content">${'<p>The real story is told in this long paragraph of plain prose.</p>'.repeat(5)}</div>`);
    expect(locate()).toBe(document.querySelector('.content'));
  });

  it('a link-heavy block loses to a prose block', () => {
    const links = '<div><a href="#">Some very long link text that goes on and on and on</a></div>'.repeat(8);
    const prose = '<div>Plain prose without links, which is what readers actually want to hear read aloud.</div>'.repeat(3);
    setBody(`<div class="links">${links}</div><div class="story">${prose}</div>`);
    expect(locate()).toBe(document.querySelector('.story'));
  });
});
