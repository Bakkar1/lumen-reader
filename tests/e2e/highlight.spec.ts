import type { Page } from '@playwright/test';
import { test, expect, openPopup, tabIdOf } from './fixtures';
import { FAKE_VOICE_NO_WORDS } from '../../lib/tts/fake-engine';

const S1 = 'The lighthouse keeper climbed the stairs at dusk.';
const S2 = 'Each step was worn smooth by a century of boots.';

/** Records every change of the Lumen highlights, as seen from the page. */
async function recordHighlights(page: Page): Promise<void> {
  await page.evaluate(() => {
    const read = (name: string) => {
      const h = CSS.highlights.get(name);
      return h ? [...h].map((r) => r.toString()).join('|') : '';
    };
    const log: { sentence: string; word: string }[] = [];
    (window as unknown as { __hl: typeof log }).__hl = log;
    setInterval(() => {
      const entry = { sentence: read('lumen-sentence'), word: read('lumen-word') };
      const last = log.at(-1);
      if (!last || last.sentence !== entry.sentence || last.word !== entry.word) log.push(entry);
    }, 15);
  });
}

const highlightLog = (page: Page) =>
  page.evaluate(() => (window as unknown as { __hl: { sentence: string; word: string }[] }).__hl);

async function readAndRecord(page: Page, popup: Page) {
  await recordHighlights(page);
  await popup.getByRole('button', { name: 'Play' }).click();
  // Wait until the second sentence has been highlighted for a while.
  await expect.poll(async () => (await highlightLog(page)).filter((e) => e.sentence === S2).length, { timeout: 10_000 }).toBeGreaterThan(2);
  return highlightLog(page);
}

function assertFollows(log: { sentence: string; word: string }[]) {
  const first = log.filter((e) => e.sentence === S1).map((e) => e.word);
  // The word highlight moves through several words of sentence 1, in order.
  expect(new Set(first).size).toBeGreaterThan(3);
  const words = S1.replace('.', '').split(' ');
  const idx = first.map((w) => words.indexOf(w));
  expect(idx.every((i) => i >= 0)).toBe(true);
  expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  // When sentence 2 starts, the word highlight is on its first word.
  expect(log.find((e) => e.sentence === S2)?.word).toBe('Each');
}

test('sentence and word highlights follow the fake engine (word events)', async ({ context, serviceWorker, extensionId }) => {
  const page = await context.newPage();
  await page.goto('/demo.html');
  const popup = await openPopup(context, extensionId, await tabIdOf(serviceWorker, page));
  assertFollows(await readAndRecord(page, popup));

  await popup.getByRole('button', { name: 'Stop' }).click();
  await expect.poll(async () => (await highlightLog(page)).at(-1)).toEqual({ sentence: '', word: '' });
});

test('sentence and word highlights follow the estimate (voice without word events)', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto('/demo.html');
  const popup = await openPopup(context, extensionId, await tabIdOf(serviceWorker, page));
  await popup.getByLabel('Voice').selectOption(FAKE_VOICE_NO_WORDS);
  assertFollows(await readAndRecord(page, popup));
});
