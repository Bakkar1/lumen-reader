import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect, getServiceWorker, launchWithExtension, openPopup, playerOf, tabIdOf } from './fixtures';
import { FAKE_VOICE_NO_WORDS } from '../../lib/tts/fake-engine';

const button = (player: Locator, name: string) => player.getByRole('button', { name, exact: true });
const speedOf = (player: Locator) => player.getByRole('button', { name: /^Speed/ });
const themeOf = (page: Page) => page.locator('lumen-reader .root');

async function openPage(page: Page, url = '/demo.html') {
  await page.goto(url);
  const player = playerOf(page);
  await expect(player).toBeVisible();
  return player;
}

async function expand(player: Locator) {
  await player.click({ position: { x: 24, y: 3 } });
  await expect(player).toHaveAttribute('data-expanded', 'true');
}

const syncedSettings = (context: import('@playwright/test').BrowserContext) =>
  getServiceWorker(context).then((sw) => sw.evaluate(() => chrome.storage.sync.get(null)));

test('voice and speed changed in one tab apply in another tab, live', async ({ context }) => {
  const pageA = await context.newPage();
  const playerA = await openPage(pageA);
  // Tab B is idle and has never talked to the background.
  const pageB = await context.newPage();
  const playerB = await openPage(pageB, '/news-article.html');

  await pageA.bringToFront();
  await expand(playerA);
  await speedOf(playerA).click();
  await button(playerA, '1.5×').click();
  await expect(speedOf(playerA)).toHaveText('1.5×');
  await playerA.getByLabel('Voice').selectOption(FAKE_VOICE_NO_WORDS);

  await expect.poll(() => syncedSettings(context)).toMatchObject({
    'lumen:setting:rate': 1.5,
    'lumen:setting:voiceName': FAKE_VOICE_NO_WORDS,
  });

  await pageB.bringToFront();
  await expand(playerB);
  await expect(speedOf(playerB)).toHaveText('1.5×');
  await expect(playerB.getByLabel('Voice')).toHaveValue(FAKE_VOICE_NO_WORDS);
  // ...and the next playback there uses them.
  await button(playerB, 'Play').click();
  await expect(playerB).toHaveAttribute('data-status', 'playing');
  await expect(speedOf(playerB)).toHaveText('1.5×');

  // A change in B while A's player is open (and connected) reaches A without a reload.
  await button(playerB, 'Faster').click();
  await expect(speedOf(playerA)).toHaveText('1.6×');
});

test('the theme set in the popup and the player position apply in every tab, live', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const pageA = await context.newPage();
  await pageA.setViewportSize({ width: 1200, height: 900 });
  const playerA = await openPage(pageA);
  const pageB = await context.newPage();
  await pageB.setViewportSize({ width: 1200, height: 900 });
  const playerB = await openPage(pageB);
  await expect(themeOf(pageA)).toHaveAttribute('data-theme', 'system');

  const popup = await openPopup(context, extensionId, await tabIdOf(serviceWorker, pageA));
  await popup.getByLabel('Theme').selectOption('dark');
  await expect(popup.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(themeOf(pageA)).toHaveAttribute('data-theme', 'dark');
  await expect(themeOf(pageB)).toHaveAttribute('data-theme', 'dark');

  // Drag A's player down 200 px; B's player follows.
  await pageA.bringToFront();
  const before = Math.round((await playerA.boundingBox())!.y);
  const grip = (await button(playerA, 'Move player').boundingBox())!;
  await pageA.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await pageA.mouse.down();
  await pageA.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + 200, { steps: 10 });
  await pageA.mouse.up();
  const movedA = Math.round((await playerA.boundingBox())!.y);
  expect(Math.abs(movedA - (before + 200))).toBeLessThanOrEqual(1);
  await expect.poll(() => syncedSettings(context)).toMatchObject({ 'lumen:setting:playerY': movedA });
  await expect.poll(async () => Math.round((await playerB.boundingBox())!.y)).toBe(movedA);
});

test('settings survive a browser restart', async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'lumen-e2e-'));
  try {
    let context = await launchWithExtension(undefined, { userDataDir });
    let sw = await getServiceWorker(context);
    let page = await context.newPage();
    await openPage(page);
    let popup = await openPopup(context, new URL(sw.url()).host, await tabIdOf(sw, page));
    await popup.getByRole('button', { name: '2×', exact: true }).click();
    await expect(popup.getByLabel('Speed')).toHaveText('2.0×');
    await popup.getByLabel('Voice').selectOption(FAKE_VOICE_NO_WORDS);
    await popup.getByLabel('Theme').selectOption('light');
    await expect
      .poll(() => sw.evaluate(() => chrome.storage.sync.get(null)))
      .toMatchObject({ 'lumen:setting:rate': 2, 'lumen:setting:theme': 'light' });
    await context.close();

    context = await launchWithExtension(undefined, { userDataDir });
    sw = await getServiceWorker(context);
    page = await context.newPage();
    const player = await openPage(page);
    await expect(themeOf(page)).toHaveAttribute('data-theme', 'light');
    await expand(player);
    await expect(speedOf(player)).toHaveText('2.0×');
    await expect(player.getByLabel('Voice')).toHaveValue(FAKE_VOICE_NO_WORDS);

    popup = await openPopup(context, new URL(sw.url()).host, await tabIdOf(sw, page));
    await expect(popup.getByLabel('Speed')).toHaveText('2.0×');
    await expect(popup.getByLabel('Theme')).toHaveValue('light');
    await context.close();
  } finally {
    await rm(userDataDir, { recursive: true, force: true });
  }
});
