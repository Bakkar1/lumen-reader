import { readFileSync } from 'node:fs';
import path from 'node:path';

const FIXTURES = path.resolve(import.meta.dirname, '../../fixtures');

export const FIXTURE_PAGES = ['news-article', 'blog', 'docs', 'spa', 'hidden-content'] as const;
export type FixturePage = (typeof FIXTURE_PAGES)[number];

/** Replaces the test document with a saved fixture page (scripts are not run). */
export function loadFixture(name: FixturePage | 'demo'): Document {
  const html = readFileSync(path.join(FIXTURES, `${name}.html`), 'utf8');
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.documentElement.lang = parsed.documentElement.lang;
  document.head.innerHTML = parsed.head.innerHTML;
  document.body.innerHTML = parsed.body.innerHTML;
  return document;
}

/** Sets the body to an HTML snippet, for small focused cases. */
export function setBody(html: string, lang = 'en'): HTMLElement {
  document.documentElement.lang = lang;
  document.head.innerHTML = '';
  document.body.innerHTML = html;
  return document.body;
}
