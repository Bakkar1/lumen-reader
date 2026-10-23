import { test, expect, highlightText, openPopup, pageSnapshot, tabIdOf } from './fixtures';

test('reading a page: extraction → background speech → highlights, from the headline', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto('/news-article.html');
  const popup = await openPopup(context, extensionId, await tabIdOf(serviceWorker, page));
  await popup.getByRole('button', { name: 'Play' }).click();

  await expect.poll(() => highlightText(page, 'lumen-sentence')).toBe('Harbour town relights its lighthouse after forty years');
  await expect(popup.locator('p.status')).toContainText(/sentence 1 of \d+/);
  // Navigation, aside and hidden text are not in the sentence list.
  const total = Number((await popup.locator('p.status').textContent())!.match(/of (\d+)/)![1]);
  expect(total).toBeGreaterThan(8);
  expect(total).toBeLessThan(20);
});

test('the DOM and element boxes are unchanged while highlighting is active', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto('/news-article.html');
  const before = await pageSnapshot(page);

  const popup = await openPopup(context, extensionId, await tabIdOf(serviceWorker, page));
  await popup.getByRole('button', { name: 'Play' }).click();
  await expect.poll(() => highlightText(page, 'lumen-word')).not.toBe('');
  expect(await highlightText(page, 'lumen-sentence')).not.toBe('');

  const during = await pageSnapshot(page);
  expect(during.html).toBe(before.html);
  expect(during.rects).toEqual(before.rects);
});
