import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { test, expect, playerOf } from './fixtures';

const button = (player: Locator, name: string | RegExp) =>
  player.getByRole('button', { name, exact: typeof name === 'string' });

/** Tabs once and checks that `target` now has focus. */
async function tabTo(page: Page, target: Locator) {
  await page.keyboard.press('Tab');
  await expect(target).toBeFocused();
}

test('the player is fully operable with the keyboard alone', async ({ context }) => {
  const page = await context.newPage();
  // demo.html has no focusable content of its own, so the first Tab enters the player.
  await page.goto('/demo.html');
  const player = playerOf(page);
  await expect(player).toBeVisible();

  // Focus moves into the player and expands it; each control has a name, in order.
  await tabTo(page, button(player, 'Move player'));
  await expect(player).toHaveAttribute('data-expanded', 'true');
  await tabTo(page, button(player, 'Collapse player'));
  await tabTo(page, button(player, 'Close player for this tab'));
  // Skip buttons are disabled (and so skipped) until a session exists.
  await tabTo(page, button(player, 'Play'));
  await tabTo(page, button(player, 'Slower'));
  await tabTo(page, button(player, 'Speed 1.0×'));
  await tabTo(page, button(player, 'Faster'));
  await tabTo(page, player.getByRole('combobox', { name: 'Voice' }));

  // Enter plays, Space pauses.
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(button(player, 'Play')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(button(player, 'Pause')).toBeFocused();
  await expect(player).toHaveAttribute('data-status', 'playing');
  await page.keyboard.press('Space');
  await expect(player).toHaveAttribute('data-status', 'paused');

  // In a session the skip buttons join the order around play.
  await tabTo(page, button(player, 'Next sentence'));
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(button(player, 'Previous sentence')).toBeFocused();

  // The speed control opens its presets with Enter; a preset applies with Space.
  await button(player, /^Speed/).focus();
  await page.keyboard.press('Enter');
  await expect(button(player, /^Speed/)).toHaveAttribute('aria-expanded', 'true');
  await tabTo(page, button(player, 'Faster'));
  for (const preset of ['0.8×', '1×', '1.2×', '1.5×', '2×']) await tabTo(page, button(player, preset));
  await page.keyboard.press('Space');
  await expect(button(player, 'Speed 2.0×')).toBeVisible();

  // Escape closes the presets (focus returns to the speed control), then collapses.
  await page.keyboard.press('Escape');
  await expect(button(player, '2×')).toHaveCount(0);
  await expect(button(player, /^Speed/)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(player).toHaveAttribute('data-expanded', 'false');

  // The grip moves the player with the arrow keys.
  await page.keyboard.press('Tab');
  await expect(button(player, 'Move player')).toBeFocused();
  const before = (await player.boundingBox())!.y;
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await player.boundingBox())!.y).toBeLessThan(before - 60);
});

async function axeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).include('lumen-reader').analyze();
  // Make sure axe really looked inside the shadow root.
  const checkedButtons = results.passes.find((r) => r.id === 'button-name')?.nodes.length ?? 0;
  return { violations: results.violations, checkedButtons };
}

test('axe finds no accessibility violations in the collapsed or expanded player', async ({ context }) => {
  const page = await context.newPage();
  await page.goto('/demo.html');
  const player = playerOf(page);
  await expect(player).toBeVisible();

  const collapsed = await axeViolations(page);
  expect(collapsed.violations).toEqual([]);
  expect(collapsed.checkedButtons).toBeGreaterThanOrEqual(2);

  await player.hover();
  await button(player, 'Play').click();
  await button(player, /^Speed/).click();
  await expect(button(player, '2×')).toBeVisible();
  const expanded = await axeViolations(page);
  expect(expanded.violations).toEqual([]);
  expect(expanded.checkedButtons).toBeGreaterThanOrEqual(10);
});
