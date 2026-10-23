import { test, expect, getServiceWorker, openPopup, tabIdOf } from './fixtures';

// The speed <output> is also a status region, so target the playback status line.
const status = (popup: import('@playwright/test').Page) => popup.locator('p.status');

test('the popup plays the demo text through the fake engine and follows its state', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto('/demo.html');
  const popup = await openPopup(context, extensionId, await tabIdOf(serviceWorker, page));

  await expect(status(popup)).toHaveAttribute('data-status', 'idle');
  await popup.getByRole('button', { name: 'Play' }).click();
  await expect(status(popup)).toHaveAttribute('data-status', 'playing');
  await expect(status(popup)).toContainText('sentence 1 of 6');

  // The state follows the engine as it moves through the sentences.
  await expect(status(popup)).toHaveAttribute('data-index', '1', { timeout: 10_000 });

  await popup.getByRole('button', { name: 'Pause' }).click();
  await expect(status(popup)).toHaveAttribute('data-status', 'paused');
  await popup.getByRole('button', { name: 'Play' }).click();
  await expect(status(popup)).toHaveAttribute('data-status', 'playing');
  await expect(status(popup)).toHaveAttribute('data-index', '1');

  await popup.getByRole('button', { name: 'Faster' }).click();
  await expect(popup.getByLabel('Speed')).toHaveText('1.1×');
  await popup.getByRole('button', { name: '3×' }).click();
  await expect(popup.getByLabel('Speed')).toHaveText('3.0×');

  await popup.getByRole('button', { name: 'Stop' }).click();
  await expect(status(popup)).toHaveAttribute('data-status', 'stopped');
});

test('a voice change is applied and shown', async ({ context, serviceWorker, extensionId }) => {
  const page = await context.newPage();
  await page.goto('/demo.html');
  const popup = await openPopup(context, extensionId, await tabIdOf(serviceWorker, page));
  await popup.getByRole('button', { name: 'Play' }).click();
  await popup.getByLabel('Voice').selectOption('Lumen Test Voice (no word events)');
  await expect(popup.getByLabel('Voice')).toHaveValue('Lumen Test Voice (no word events)');
  await expect(status(popup)).toHaveAttribute('data-status', 'playing');
});

test('after the service worker is stopped mid-read, the state is paused at the last sentence', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto('/demo.html');
  const popup = await openPopup(context, extensionId, await tabIdOf(serviceWorker, page));

  await popup.getByRole('button', { name: 'Play' }).click();
  await expect(status(popup)).toHaveAttribute('data-index', '1', { timeout: 10_000 });

  const cdp = await context.newCDPSession(popup);
  await cdp.send('ServiceWorker.enable');
  const workerStopped = new Promise<void>((resolve) => {
    cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => {
      if (versions.some((v) => v.runningStatus === 'stopped')) resolve();
    });
  });
  await cdp.send('ServiceWorker.stopAllWorkers');
  await workerStopped;

  // The popup's polling and the tab's reconnect wake a fresh worker, which reconciles.
  await expect(status(popup)).toHaveAttribute('data-status', 'paused', { timeout: 5_000 });
  const shownIndex = Number(await status(popup).getAttribute('data-index'));
  expect(shownIndex).toBeGreaterThanOrEqual(1);

  const worker = await getServiceWorker(context);
  const stored = await worker.evaluate(async () => (await chrome.storage.session.get('lumen:session'))['lumen:session']);
  expect(stored).toMatchObject({ status: 'paused', index: shownIndex });

  // It stays paused (never "playing" while silent) until the user presses play.
  await popup.waitForTimeout(1500);
  await expect(status(popup)).toHaveAttribute('data-status', 'paused');
  await expect(status(popup)).toHaveAttribute('data-index', String(shownIndex));

  await popup.getByRole('button', { name: 'Play' }).click();
  await expect(status(popup)).toHaveAttribute('data-status', 'playing');
  await expect(status(popup)).toHaveAttribute('data-index', String(shownIndex));
});
