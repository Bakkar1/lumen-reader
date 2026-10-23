import path from 'node:path';
import { existsSync } from 'node:fs';
import { test as base, expect } from '@playwright/test';
import { getServiceWorker, launchWithExtension, openPopup, tabIdOf } from './fixtures';

/** The production build, which speaks through the bundled Kokoro model. */
const REAL_BUILD = path.resolve(import.meta.dirname, '../../.output/chrome-mv3');

base.describe('real Kokoro smoke test', () => {
  base.skip(!existsSync(REAL_BUILD), 'run `npm run build` first');

  base('the production build reads a sentence aloud with Kokoro, offline', async ({}, testInfo) => {
    // Loading the model takes a while on a cold start.
    base.setTimeout(120_000);
    const context = await launchWithExtension(REAL_BUILD);
    context.on('console', (m) => {
      if (m.type() === 'error') testInfo.annotations.push({ type: 'console error', description: m.text() });
    });
    const external: string[] = [];
    context.on('request', (r) => {
      const url = new URL(r.url());
      if (url.protocol.startsWith('http') && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') external.push(r.url());
    });
    try {
      const worker = await getServiceWorker(context);
      const page = await context.newPage();
      await page.goto('/demo.html');
      const extensionId = new URL(worker.url()).host;
      const popup = await openPopup(context, extensionId, await tabIdOf(worker, page));
      const status = popup.locator('p.status');

      await expect(popup.getByLabel('Voice')).toContainText('Kokoro Heart (US)');
      await popup.getByRole('button', { name: 'Play' }).click();
      await expect(status).toHaveAttribute('data-status', 'playing');
      // The first sentence includes loading the model; finishing it moves the reader on.
      const started = Date.now();
      await expect(status).toHaveAttribute('data-index', '1', { timeout: 90_000 });
      testInfo.annotations.push({ type: 'first sentence', description: `${Date.now() - started} ms` });

      const offscreen = await worker.evaluate(async () =>
        (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length,
      );
      expect(offscreen).toBe(1);

      await popup.getByRole('button', { name: 'Stop' }).click();
      await expect(status).toHaveAttribute('data-status', 'stopped');
      // The model, voices and runtime are all bundled.
      expect(external).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
