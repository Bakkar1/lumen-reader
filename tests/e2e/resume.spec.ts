import type { BrowserContext, Locator, Page } from '@playwright/test';
import { test, expect, getServiceWorker, highlightText, playerOf } from './fixtures';

const button = (scope: Locator, name: string) => scope.getByRole('button', { name, exact: true });
const offerOf = (page: Page) => page.locator('lumen-reader .offer');
const statusOf = (player: Locator) => player.locator('p.status');

async function openPage(page: Page, url: string) {
  await page.goto(url);
  const player = playerOf(page);
  await expect(player).toBeVisible();
  return player;
}

async function expand(player: Locator) {
  await player.click({ position: { x: 24, y: 3 } });
  await expect(player).toHaveAttribute('data-expanded', 'true');
}

const storedPositions = async (context: BrowserContext) => {
  const sw = await getServiceWorker(context);
  return sw.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    return Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith('lumen:pos:')));
  });
};

/** Reads to sentence `index` (0-based) with the player's skip button, then pauses. */
async function readToAndPause(player: Locator, index: number) {
  await expand(player);
  await button(player, 'Play').click();
  await expect(player).toHaveAttribute('data-status', 'playing');
  for (let i = 0; i < index; i++) await button(player, 'Next sentence').click();
  await expect(statusOf(player)).toHaveAttribute('data-index', String(index));
  await button(player, 'Pause').click();
  await expect(player).toHaveAttribute('data-status', 'paused');
}

test('a page left part-way offers to resume, and resuming starts at the stored sentence', async ({
  context,
  baseURL,
}) => {
  const page = await context.newPage();
  let player = await openPage(page, '/long-article.html');
  // No position yet: no offer.
  await page.waitForTimeout(500);
  await expect(offerOf(page)).toHaveCount(0);

  await readToAndPause(player, 3);
  const key = `lumen:pos:${baseURL}/long-article.html`;
  await expect.poll(() => storedPositions(context)).toMatchObject({ [key]: { sentenceIndex: 3, finished: false } });
  const { snippet } = (await storedPositions(context))[key] as { snippet: string };

  // Reopened through a tracking link and a fragment: the same page key.
  player = await openPage(page, '/long-article.html?utm_source=newsletter#section-2');
  const offer = offerOf(page);
  await expect(offer).toBeVisible();
  await expect(offer).toHaveAttribute('data-kind', 'resume');
  await expect(offer).toContainText('Sentence 4 of');

  await button(offer, 'Resume').click();
  await expect(offer).toHaveCount(0);
  await expect(player).toHaveAttribute('data-status', 'playing');
  await expand(player);
  await expect(statusOf(player)).toHaveAttribute('data-index', '3');
  // The highlight is on the stored sentence itself.
  await expect.poll(async () => (await highlightText(page, 'lumen-sentence')).startsWith(snippet)).toBe(true);
});

test('"Start over" on the offer reads from the first sentence', async ({ context }) => {
  const page = await context.newPage();
  let player = await openPage(page, '/long-article.html');
  await readToAndPause(player, 2);

  player = await openPage(page, '/long-article.html');
  await button(offerOf(page), 'Start over').click();
  await expect(player).toHaveAttribute('data-status', 'playing');
  await expand(player);
  await expect(statusOf(player)).toHaveAttribute('data-index', '0');
});

test('a page that was read to the end is not offered', async ({ context, baseURL }) => {
  const page = await context.newPage();
  let player = await openPage(page, '/demo.html');
  await expand(player);
  await button(player, 'Play').click();
  await expect(statusOf(player)).toContainText('of 6');
  for (let i = 0; i < 6; i++) await button(player, 'Next sentence').click();
  await expect(player).toHaveAttribute('data-status', 'stopped');
  await expect.poll(() => storedPositions(context)).toMatchObject({
    [`lumen:pos:${baseURL}/demo.html`]: { sentenceIndex: 5, finished: true },
  });

  player = await openPage(page, '/demo.html');
  await page.waitForTimeout(1000);
  await expect(offerOf(page)).toHaveCount(0);
});

test('expired positions are pruned when the worker starts, and a daily alarm is registered', async ({ context }) => {
  const DAY = 24 * 60 * 60 * 1000;
  let sw = await getServiceWorker(context);
  await expect.poll(() => sw.evaluate(() => chrome.alarms.getAll())).toEqual([
    expect.objectContaining({ name: 'lumen-prune-positions', periodInMinutes: 24 * 60 }),
  ]);
  await sw.evaluate(
    ({ old, fresh }) =>
      chrome.storage.local.set({
        'lumen:pos:https://example.com/old': { sentenceIndex: 2, charOffset: 9, snippet: 'x', finished: false, updatedAt: old },
        'lumen:pos:https://example.com/new': { sentenceIndex: 2, charOffset: 9, snippet: 'x', finished: false, updatedAt: fresh },
      }),
    { old: Date.now() - 31 * DAY, fresh: Date.now() - DAY },
  );

  // Stop the worker; opening the popup wakes a fresh one, which prunes at start-up.
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('ServiceWorker.enable');
  const stopped = new Promise<void>((resolve) => {
    cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
      if (versions.some((v) => v.runningStatus === 'stopped')) resolve();
    });
  });
  await cdp.send('ServiceWorker.stopAllWorkers');
  await stopped;
  await page.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html`);
  sw = await getServiceWorker(context);
  await expect.poll(() => storedPositions(context)).toEqual({
    'lumen:pos:https://example.com/new': expect.objectContaining({ sentenceIndex: 2 }),
  });
});

test('when the stored sentence is gone, no resume points at other text and reading can start from the beginning', async ({
  context,
  baseURL,
}) => {
  // A position saved before the article was edited: its sentence no longer exists.
  const sw = await getServiceWorker(context);
  await sw.evaluate(
    (key) =>
      chrome.storage.local.set({
        [key]: {
          sentenceIndex: 3,
          charOffset: 180,
          snippet: 'This sentence was removed when the article was edited.',
          finished: false,
          updatedAt: Date.now() - 60_000,
        },
      }),
    `lumen:pos:${baseURL}/demo.html`,
  );

  const page = await context.newPage();
  const player = await openPage(page, '/demo.html');
  const offer = offerOf(page);
  await expect(offer).toHaveAttribute('data-kind', 'changed');
  await expect(button(offer, 'Resume')).toHaveCount(0);

  await button(offer, 'Start from the beginning').click();
  await expect(player).toHaveAttribute('data-status', 'playing');
  await expand(player);
  await expect(statusOf(player)).toHaveAttribute('data-index', '0');
  await expect
    .poll(() => highlightText(page, 'lumen-sentence'))
    .toBe('The lighthouse keeper climbed the stairs at dusk.');
});
