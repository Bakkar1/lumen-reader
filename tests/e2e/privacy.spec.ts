import type { Request } from '@playwright/test';
import { test, expect, playerOf } from './fixtures';

/**
 * Reading-persistence spec, "Local-only data": a full read-and-resume cycle
 * sends nothing from the extension. The fake engine stands in for the voices,
 * so there are no browser voice requests either.
 */
test('a read-and-resume cycle makes no network requests from the extension', async ({
  context,
  serviceWorker,
  baseURL,
}) => {
  const requests: { url: string; fromWorker: boolean }[] = [];
  const record = (r: Request) => requests.push({ url: r.url(), fromWorker: r.serviceWorker() !== null });
  context.on('request', record);

  // Control: a request from the extension's worker is seen, so silence below means silence.
  await serviceWorker.evaluate((url) => fetch(url).then((r) => r.text()), `${baseURL}/health`);
  await expect.poll(() => requests.some((r) => r.fromWorker && r.url.endsWith('/health'))).toBe(true);
  requests.length = 0;

  const page = await context.newPage();
  await page.goto('/long-article.html');
  let player = playerOf(page);
  await player.click({ position: { x: 24, y: 3 } });
  await player.getByRole('button', { name: 'Play', exact: true }).click();
  for (let i = 0; i < 3; i++) await player.getByRole('button', { name: 'Next sentence', exact: true }).click();
  await player.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(player).toHaveAttribute('data-status', 'paused');

  await page.reload();
  player = playerOf(page);
  await page.locator('lumen-reader .offer').getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(player).toHaveAttribute('data-status', 'playing');
  await page.waitForTimeout(1500);
  await player.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(player).toHaveAttribute('data-status', 'paused');

  // The only traffic is the page loading itself from the fixture server.
  expect(requests.filter((r) => r.fromWorker)).toEqual([]);
  expect(requests.map((r) => r.url).filter((u) => !u.startsWith(`${baseURL}/`))).toEqual([]);
  expect(requests.map((r) => new URL(r.url).pathname)).toEqual(['/long-article.html', '/long-article.html']);
});
