import type { Frame } from '@playwright/test';
import { test, expect, playerOf } from './fixtures';

const frameHighlight = (frame: Frame) =>
  frame.evaluate(() => {
    const h = CSS.highlights.get('lumen-sentence');
    return h ? [...h].map((r) => r.toString()).join('|') : '';
  });

test('reads the content of a cross-origin iframe, not only the outer header', async ({ context }) => {
  const page = await context.newPage();
  await page.goto('/iframe-course.html');
  const lesson = page.frameLocator('#lesson');
  await expect(lesson.locator('h1')).toBeVisible();
  const frame = page.frames().find((f) => f.url().includes('localhost:4317/news-article.html'))!;

  // The outer page alone is too short for a player; the iframe's text makes it show.
  const player = playerOf(page);
  await expect(player).toBeVisible();
  await player.getByRole('button', { name: 'Play', exact: true }).click();

  await expect.poll(() => frameHighlight(frame)).toBe('Harbour town relights its lighthouse after forty years');
  await expect(player.getByRole('status')).toContainText(/sentence 1 of \d+/);
});
