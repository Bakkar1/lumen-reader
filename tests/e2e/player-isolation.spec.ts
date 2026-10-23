import type { Page } from '@playwright/test';
import { test, expect, playerOf } from './fixtures';

/** Every element of the player: box relative to the player, plus the styles that show. */
const playerSignature = (page: Page) =>
  page.evaluate(() => {
    const player = document.querySelector('lumen-reader')!.shadowRoot!.querySelector('.player')!;
    const p = player.getBoundingClientRect();
    const rows = [player, ...player.querySelectorAll('*')].map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const cls = typeof el.className === 'string' ? el.className : '';
      return [
        el.tagName,
        cls,
        Math.round(r.left - p.left),
        Math.round(r.top - p.top),
        Math.round(r.width),
        Math.round(r.height),
        cs.display,
        cs.color,
        cs.backgroundColor,
        cs.fontSize,
        cs.fontFamily,
        cs.letterSpacing,
        cs.transform,
      ].join(' | ');
    });
    return { box: [p.left, p.top, p.width, p.height].map(Math.round), rows };
  });

/** Collapsed and expanded signatures of the player on a page. */
async function capture(page: Page, url: string) {
  await page.goto(url);
  const player = playerOf(page);
  await expect(player).toBeVisible();
  await page.waitForTimeout(300);
  const collapsed = await playerSignature(page);

  await player.hover();
  await expect(player).toHaveAttribute('data-expanded', 'true');
  // The voice list (browser default + two fake voices) arrives from the background;
  // wait for it and for the width transition.
  await expect(player.locator('select option')).toHaveCount(3);
  await page.waitForTimeout(400);
  const expanded = await playerSignature(page);
  return { collapsed, expanded };
}

test('the player renders identically on a page with hostile global CSS', async ({ context }) => {
  const page = await context.newPage();
  const plain = await capture(page, '/demo.html');
  const hostile = await capture(page, '/hostile-css.html');

  expect(plain.collapsed.rows.length).toBeGreaterThan(3);
  expect(plain.expanded.rows.length).toBeGreaterThan(plain.collapsed.rows.length);
  expect(hostile.collapsed).toEqual(plain.collapsed);
  expect(hostile.expanded).toEqual(plain.expanded);

  // And it works the same: play starts reading.
  const player = playerOf(page);
  await player.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(player.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await expect(player.getByRole('status')).toContainText('Reading · sentence 1 of 6');
});

test('the player adds no styles to the page', async ({ context }) => {
  const page = await context.newPage();
  // Before the content script runs (document_idle), record every element's computed style.
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const w = window as unknown as { __styles: string[] };
      w.__styles = [...document.querySelectorAll('*')].map((el) => {
        const cs = getComputedStyle(el);
        return `${el.tagName} ${cs.cssText || [...cs].map((k) => `${k}:${cs.getPropertyValue(k)}`).join(';')}`;
      });
    });
  });
  await page.goto('/news-article.html');
  const player = playerOf(page);
  await expect(player).toBeVisible();
  await player.hover();
  await expect(player).toHaveAttribute('data-expanded', 'true');

  const result = await page.evaluate(() => {
    const before = (window as unknown as { __styles: string[] }).__styles;
    const after = [...document.querySelectorAll('*')]
      .filter((el) => !el.closest('[data-lumen-reader]'))
      .map((el) => {
        const cs = getComputedStyle(el);
        return `${el.tagName} ${cs.cssText || [...cs].map((k) => `${k}:${cs.getPropertyValue(k)}`).join(';')}`;
      });
    return {
      before,
      after,
      styleNodes: document.querySelectorAll('style, link[rel=stylesheet]').length,
      adopted: document.adoptedStyleSheets.length,
    };
  });
  expect(result.after).toEqual(result.before);
  // Only the fixture's own <style>; nothing adopted until highlighting starts.
  expect(result.styleNodes).toBe(1);
  expect(result.adopted).toBe(0);
});
