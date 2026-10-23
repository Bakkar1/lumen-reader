import { test as base, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import path from 'node:path';

/** The fake-TTS build produced by `npm run build:e2e`. */
export const EXTENSION_PATH = path.resolve(import.meta.dirname, '../../.output-e2e/chrome-mv3');

/** `userDataDir` '' is a fresh throwaway profile; pass a directory to keep storage across restarts. */
export async function launchWithExtension(
  extensionPath = EXTENSION_PATH,
  { headless = true, userDataDir = '' } = {},
): Promise<BrowserContext> {
  return chromium.launchPersistentContext(userDataDir, {
    // The "chromium" channel runs extensions in headless mode.
    channel: 'chromium',
    headless,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
}

export async function getServiceWorker(context: BrowserContext): Promise<Worker> {
  return context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
}

/** Opens the popup as a tab that controls `tabId` (the real popup targets the active tab). */
export async function openPopup(context: BrowserContext, extensionId: string, tabId: number): Promise<Page> {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html?tabId=${tabId}`);
  return popup;
}

/** The Chrome tab id of a page, looked up from the service worker by URL. */
export async function tabIdOf(serviceWorker: Worker, page: Page): Promise<number> {
  const url = page.url();
  return serviceWorker.evaluate(async (u) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((t) => t.url === u);
    if (!tab?.id) throw new Error(`no tab for ${u}`);
    return tab.id;
  }, url);
}

/** The docked player. E2E builds open its shadow root so locators can reach it. */
export const playerOf = (page: Page) => page.locator('lumen-reader .player');

/** The current Lumen highlight text, as seen from the page. */
export const highlightText = (page: Page, name: 'lumen-sentence' | 'lumen-word') =>
  page.evaluate((n) => {
    const h = CSS.highlights.get(n);
    return h ? [...h].map((r) => r.toString()).join('|') : '';
  }, name);

/**
 * The page's DOM and every element's box in document coordinates,
 * leaving out Lumen Reader's own host.
 */
export const pageSnapshot = (page: Page) =>
  page.evaluate(() => {
    const isOurs = (el: Element) => el.closest('[data-lumen-reader]') !== null;
    const clone = document.documentElement.cloneNode(true) as Element;
    clone.querySelectorAll('[data-lumen-reader]').forEach((el) => el.remove());
    const rects = [...document.querySelectorAll('*')]
      .filter((el) => !isOurs(el))
      .map((el) => {
        const r = el.getBoundingClientRect();
        return [el.tagName, r.left + scrollX, r.top + scrollY, r.width, r.height].map((v) => (typeof v === 'number' ? Math.round(v) : v)).join(',');
      });
    return { html: clone.outerHTML, rects };
  });

export const test = base.extend<{
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
}>({
  context: async ({}, use) => {
    const context = await launchWithExtension();
    await use(context);
    await context.close();
  },
  serviceWorker: async ({ context }, use) => {
    await use(await getServiceWorker(context));
  },
  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },
});

export const expect = test.expect;
