import type { Locator, Page } from '@playwright/test';
import { test, expect, highlightText, openPopup, playerOf, tabIdOf } from './fixtures';
import { FAKE_VOICE_NO_WORDS } from '../../lib/tts/fake-engine';

const button = (player: Locator, name: string) => player.getByRole('button', { name, exact: true });

async function openPage(page: Page, url = '/demo.html') {
  await page.goto(url);
  const player = playerOf(page);
  await expect(player).toBeVisible();
  return player;
}

test('the collapsed player appears by itself on a readable page', async ({ context }) => {
  const player = await openPage(await context.newPage());
  await expect(player).toHaveAttribute('data-expanded', 'false');
  await expect(button(player, 'Play')).toBeVisible();
});

test('clicking expands the player, and the collapse control returns it to the compact bar', async ({ context }) => {
  const page = await context.newPage();
  const player = await openPage(page);
  // Click the bar itself (its top padding), not a control.
  await player.click({ position: { x: 24, y: 3 } });
  await expect(player).toHaveAttribute('data-expanded', 'true');
  await expect(button(player, 'Next sentence')).toBeVisible();

  await button(player, 'Collapse player').click();
  await expect(player).toHaveAttribute('data-expanded', 'false');
  await expect(button(player, 'Next sentence')).toHaveCount(0);
});

test('hovering expands after about 250 ms, and leaving collapses about 2 s later', async ({ context }) => {
  const page = await context.newPage();
  const player = await openPage(page);
  await player.hover();
  expect(await player.getAttribute('data-expanded')).toBe('false');
  await expect(player).toHaveAttribute('data-expanded', 'true', { timeout: 1000 });

  await page.mouse.move(100, 100);
  await page.waitForTimeout(1200);
  await expect(player).toHaveAttribute('data-expanded', 'true');
  await expect(player).toHaveAttribute('data-expanded', 'false', { timeout: 2000 });
});

test('pressing play on the collapsed bar starts reading', async ({ context }) => {
  const page = await context.newPage();
  const player = await openPage(page);
  await button(player, 'Play').click();
  await expect(button(player, 'Pause')).toBeVisible();
  await expect(player.getByRole('status')).toContainText('Reading · sentence 1 of 6');
  await expect.poll(() => highlightText(page, 'lumen-sentence')).toBe('The lighthouse keeper climbed the stairs at dusk.');
  // A remaining-time estimate is shown while a session runs.
  await expect(player.getByRole('status')).toContainText(/\d+:\d\d left/);
});

test('the player follows state changes from the popup and background starts within 1 s', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const page = await context.newPage();
  const player = await openPage(page);
  const tabId = await tabIdOf(serviceWorker, page);
  const popup = await openPopup(context, extensionId, tabId);
  const within1s = { timeout: 1000 };

  await popup.getByRole('button', { name: 'Play' }).click();
  await expect(button(player, 'Pause')).toBeVisible(within1s);
  await popup.getByRole('button', { name: 'Pause' }).click();
  await expect(button(player, 'Play')).toBeVisible(within1s);
  await expect(player).toHaveAttribute('data-status', 'paused', within1s);
  await popup.getByRole('button', { name: 'Stop' }).click();
  await expect(player).toHaveAttribute('data-status', 'stopped', within1s);

  // The context menu and the shortcut start reading through the background's
  // requestStart message; the player follows that path too.
  await serviceWorker.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'requestStart', mode: 'page' }), tabId);
  await expect(button(player, 'Pause')).toBeVisible(within1s);
  await expect(player).toHaveAttribute('data-status', 'playing', within1s);
});

test('speed, presets and voice are set from the expanded player', async ({ context, serviceWorker, extensionId }) => {
  const page = await context.newPage();
  const player = await openPage(page);
  await player.hover();
  await expect(player).toHaveAttribute('data-expanded', 'true');
  // No session yet: nothing to skip.
  await expect(button(player, 'Next sentence')).toBeDisabled();

  await button(player, 'Faster').click();
  await expect(player.getByRole('button', { name: /^Speed/ })).toHaveText('1.1×');
  await player.getByRole('button', { name: /^Speed/ }).click();
  await button(player, '2×').click();
  await expect(player.getByRole('button', { name: /^Speed/ })).toHaveText('2.0×');
  await expect(button(player, '2×')).toHaveAttribute('aria-pressed', 'true');

  await button(player, 'Play').click();
  await expect(button(player, 'Next sentence')).toBeEnabled();
  await player.getByLabel('Voice').selectOption(FAKE_VOICE_NO_WORDS);
  await expect(player.getByLabel('Voice')).toHaveValue(FAKE_VOICE_NO_WORDS);
  await expect(player).toHaveAttribute('data-status', 'playing');

  // The background holds the settings: the popup shows the same values.
  const popup = await openPopup(context, extensionId, await tabIdOf(serviceWorker, page));
  await expect(popup.getByLabel('Speed')).toHaveText('2.0×');
  await expect(popup.getByLabel('Voice')).toHaveValue(FAKE_VOICE_NO_WORDS);
});

test('after the user scrolls away, "Back to reading" returns to the sentence and follows again', async ({ context }) => {
  const page = await context.newPage();
  const player = await openPage(page, '/long-article.html');
  await player.hover();
  await player.getByRole('button', { name: /^Speed/ }).click();
  await button(player, '3×').click();
  await button(player, 'Play').click();

  await expect.poll(() => page.evaluate(() => scrollY), { timeout: 15_000 }).toBeGreaterThan(300);
  await page.mouse.move(300, 300);
  await page.mouse.wheel(0, -2000);
  const chip = button(player, 'Back to reading');
  await expect(chip).toBeVisible();

  await chip.click();
  await expect(chip).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const r = [...(CSS.highlights.get('lumen-sentence') ?? [])][0] as Range | undefined;
        const rect = r?.getBoundingClientRect();
        return rect ? rect.top >= 0 && rect.bottom <= innerHeight : false;
      }),
    )
    .toBe(true);
});

test('dragging moves the player along the right edge, and a shorter window keeps it fully visible', async ({
  context,
}) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1200, height: 900 });
  const player = await openPage(page);
  await page.waitForTimeout(200);
  const start = (await player.boundingBox())!;
  const grip = (await button(player, 'Move player').boundingBox())!;

  // Drag down 300 px; the sideways part of the gesture is ignored.
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 - 60, grip.y + grip.height / 2 + 300, { steps: 12 });
  await page.mouse.up();

  const moved = (await player.boundingBox())!;
  expect(Math.abs(moved.y - (start.y + 300))).toBeLessThanOrEqual(1);
  expect(moved.x).toBe(start.x);
  // A drag is not a click: the player stays collapsed.
  await page.waitForTimeout(100);
  await expect(player).toHaveAttribute('data-expanded', 'false');

  await page.setViewportSize({ width: 1200, height: 500 });
  await expect
    .poll(async () => {
      const b = (await player.boundingBox())!;
      return b.y >= 0 && b.y + b.height <= 500 && Math.round(b.x + b.width) === 1200 - 12;
    })
    .toBe(true);

  // Expanding near the bottom keeps the taller player on screen as well.
  await player.click({ position: { x: 24, y: 3 } });
  await expect(player).toHaveAttribute('data-expanded', 'true');
  await expect
    .poll(async () => {
      const b = (await player.boundingBox())!;
      return b.y >= 0 && b.y + b.height <= 500;
    })
    .toBe(true);
});

test('closing hides the player in this tab until the toolbar popup opens', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const page = await context.newPage();
  const player = await openPage(page);
  await player.hover();
  await button(player, 'Close player for this tab').click();
  await expect(player).toBeHidden();

  // Nothing per-site is stored by closing.
  const stored = await serviceWorker.evaluate(async () => ({
    ...(await chrome.storage.local.get(null)),
    ...(await chrome.storage.sync.get(null)),
  }));
  expect(stored).toEqual({});

  await openPopup(context, extensionId, await tabIdOf(serviceWorker, page));
  await expect(player).toBeVisible();

  // A new page load shows it again too.
  await player.hover();
  await button(player, 'Close player for this tab').click();
  await expect(player).toBeHidden();
  await page.reload();
  await expect(playerOf(page)).toBeVisible();
});
