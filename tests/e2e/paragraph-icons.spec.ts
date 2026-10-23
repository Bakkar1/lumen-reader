import { test, expect, highlightText, pageSnapshot, playerOf } from './fixtures';

const THIRD_PARAGRAPH_FIRST_SENTENCE =
  'Volunteers replaced the rusted gallery rail, rebuilt the clockwork and repainted the tower in its original red and white bands.';

test("clicking the third paragraph's play icon starts at its first sentence, without changing the layout", async ({
  context,
}) => {
  const page = await context.newPage();
  await page.goto('/news-article.html');
  await expect(playerOf(page)).toBeVisible();
  const icon = page.locator('lumen-reader .para-play');
  const before = await pageSnapshot(page);

  // The third paragraph that qualifies (more than ten words, in the article).
  const paragraph = page.locator('article p', { hasText: 'Volunteers replaced' });
  await paragraph.hover();
  await expect(icon).toBeVisible();
  await expect(icon).toHaveAccessibleName('Read from this paragraph');

  // It sits at the left of the paragraph (this fixture's gutter is only 16 px,
  // so it overlaps the margin), centred on the paragraph's first line.
  const p = (await paragraph.boundingBox())!;
  const i = (await icon.boundingBox())!;
  expect(i.x).toBeLessThan(p.x);
  expect(i.y + i.height / 2).toBeGreaterThan(p.y);
  expect(i.y + i.height / 2).toBeLessThan(p.y + 24);
  expect(await pageSnapshot(page)).toEqual(before);

  // Moving from the paragraph to the icon does not hide it.
  await icon.click();
  await expect.poll(() => highlightText(page, 'lumen-sentence')).toBe(THIRD_PARAGRAPH_FIRST_SENTENCE);
  await expect(playerOf(page)).toHaveAttribute('data-status', 'playing');
  await expect(icon).toHaveCount(0);

  expect(await pageSnapshot(page)).toEqual(before);
});

test('headings and short paragraphs get no icon, and it hides after the pointer leaves', async ({ context }) => {
  const page = await context.newPage();
  await page.goto('/news-article.html');
  await expect(playerOf(page)).toBeVisible();
  const icon = page.locator('lumen-reader .para-play');

  await page.getByRole('heading', { name: 'A beacon for the community' }).hover();
  await page.waitForTimeout(400);
  await expect(icon).toHaveCount(0);
  await page.getByText('By Ada Whitlock').hover();
  await page.waitForTimeout(400);
  await expect(icon).toHaveCount(0);

  await page.locator('article p', { hasText: 'Gull Point' }).hover();
  await expect(icon).toBeVisible();
  await page.mouse.move(900, 600);
  await expect(icon).toHaveCount(0);
});
