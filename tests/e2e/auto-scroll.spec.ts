import type { Page } from '@playwright/test';
import { test, expect, openPopup, tabIdOf } from './fixtures';

const sentenceHighlight = (page: Page) =>
  page.evaluate(() => {
    const h = CSS.highlights.get('lumen-sentence');
    return h ? [...h].map((r) => r.toString()).join('|') : '';
  });

/** Where the current sentence sits in the viewport, as a fraction of its height. */
const sentencePosition = (page: Page) =>
  page.evaluate(() => {
    const r = [...(CSS.highlights.get('lumen-sentence') ?? [])][0] as Range | undefined;
    if (!r) return null;
    const rect = r.getBoundingClientRect();
    return (rect.top + rect.height / 2) / innerHeight;
  });

test('the page scrolls to follow reading, and stops following after the user scrolls', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto('/long-article.html');
  const popup = await openPopup(context, extensionId, await tabIdOf(serviceWorker, page));
  await popup.getByRole('button', { name: '3×' }).click();
  await popup.getByRole('button', { name: 'Play' }).click();
  await page.bringToFront();

  // Reading below the fold: the page scrolls smoothly to keep the sentence in view.
  await expect.poll(() => sentenceHighlight(page), { timeout: 15_000, intervals: [50] }).toContain('cliff top');
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(500);
  await expect.poll(() => sentencePosition(page)).toBeGreaterThan(0.1);
  await expect.poll(() => sentencePosition(page)).toBeLessThan(0.9);

  // The user scrolls by hand: auto-scroll stops following.
  await page.mouse.move(300, 300);
  await page.mouse.wheel(0, -200);
  await page.waitForTimeout(600);
  const userY = await page.evaluate(() => scrollY);
  await expect.poll(() => sentenceHighlight(page), { timeout: 15_000, intervals: [50] }).toContain('ferry');
  expect(await page.evaluate(() => scrollY)).toBe(userY);
});
