import type { Locator, Page, Worker } from '@playwright/test';
import { test, expect, highlightText, playerOf, tabIdOf } from './fixtures';

const button = (player: Locator, name: string) => player.getByRole('button', { name, exact: true });

/** The test hook E2E builds put on the service worker (native menus and commands can't be driven by CDP). */
declare const __lumenTest: {
  onMenuClick(info: { menuItemId: string; selectionText?: string }, tab: { id: number }): Promise<void>;
  onCommand(command: string, tab: { id: number }): Promise<void>;
};

const menuClick = (sw: Worker, tabId: number, selectionText?: string) =>
  sw.evaluate(([id, text]) => __lumenTest.onMenuClick({ menuItemId: 'lumen-listen', selectionText: text }, { id }), [
    tabId,
    selectionText,
  ] as const);

const shortcut = (sw: Worker, tabId: number) =>
  sw.evaluate((id) => __lumenTest.onCommand('toggle-reading', { id }), tabId);

async function openPage(page: Page, url = '/navigation.html') {
  await page.goto(url);
  const player = playerOf(page);
  await expect(player).toBeVisible();
  return player;
}

/** Viewport centre of `word` inside the element matching `selector`. */
function wordPoint(page: Page, selector: string, word: string) {
  return page.evaluate(
    ([sel, w]) => {
      const el = document.querySelector(sel)!;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const i = node.textContent!.indexOf(w);
        if (i === -1) continue;
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + w.length);
        const r = range.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
      throw new Error(`"${w}" not found in ${sel}`);
    },
    [selector, word] as const,
  );
}

/** Selects from `from` to the end of `to` (both are words in the page's text). */
function select(page: Page, fromSel: string, from: string, toSel: string, to: string) {
  return page.evaluate(
    ([fs, f, ts, t]) => {
      const textNode = (sel: string) => document.querySelector(sel)!.firstChild as Text;
      const a = textNode(fs);
      const b = textNode(ts);
      const range = document.createRange();
      range.setStart(a, a.data.indexOf(f));
      range.setEnd(b, b.data.indexOf(t) + t.length);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      return getSelection()!.toString();
    },
    [fromSel, from, toSel, to] as const,
  );
}

const statusIndex = async (player: Locator) => Number(await player.getAttribute('data-index'));

/** Starts logging every change of the word highlight in the page; returns a reader for the log. */
async function recordWords(page: Page) {
  await page.evaluate(() => {
    const log: string[] = [];
    Object.assign(window, { __words: log });
    setInterval(() => {
      const r = [...(CSS.highlights.get('lumen-word') ?? [])][0] as Range | undefined;
      const w = r?.toString() ?? '';
      if (w && w !== log.at(-1)) log.push(w);
    }, 5);
  });
  return () => page.evaluate(() => (window as unknown as { __words: string[] }).__words.slice());
}

test.describe('context menu "Listen with Lumen Reader"', () => {
  test('with a selection, reads only the selected text', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    const player = await openPage(page);
    const selected = await select(page, '#p2', 'He', '#p3', 'wall.');
    expect(selected).toContain('Children ran along the sea wall.');

    await menuClick(serviceWorker, await tabIdOf(serviceWorker, page), selected);
    await expect.poll(() => highlightText(page, 'lumen-sentence')).toBe('He whistled an old tune.');
    await expect(player).toHaveAttribute('data-status', 'playing');
    await player.hover();
    await expect(player.getByRole('status')).toContainText('sentence 1 of 2');

    // It ends at the selection end rather than continuing with the page.
    await expect.poll(() => highlightText(page, 'lumen-sentence'), { timeout: 10_000 }).toBe(
      'Children ran along the sea wall.',
    );
    await expect(player).toHaveAttribute('data-status', 'stopped', { timeout: 10_000 });
  });

  test('without a selection, reads the page from the start of the main content', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    const player = await openPage(page);
    await menuClick(serviceWorker, await tabIdOf(serviceWorker, page));

    await expect.poll(() => highlightText(page, 'lumen-sentence')).toBe('An evening at the harbour');
    await player.hover();
    // The nav links are not part of the main content.
    await expect(player.getByRole('status')).toContainText('sentence 1 of 11');
  });
});

test.describe('keyboard shortcut', () => {
  test('starts reading the page when idle, then pauses and resumes', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    const player = await openPage(page);
    const tabId = await tabIdOf(serviceWorker, page);

    await shortcut(serviceWorker, tabId);
    await expect(player).toHaveAttribute('data-status', 'playing');
    await expect.poll(() => highlightText(page, 'lumen-sentence')).toBe('An evening at the harbour');

    await expect.poll(() => statusIndexOf(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
    await shortcut(serviceWorker, tabId);
    await expect(player).toHaveAttribute('data-status', 'paused');
    const pausedAt = await statusIndexOf(page);

    await shortcut(serviceWorker, tabId);
    await expect(player).toHaveAttribute('data-status', 'playing');
    expect(await statusIndexOf(page)).toBe(pausedAt);
  });

  test('when idle with text selected, reads the selection', async ({ context, serviceWorker }) => {
    const page = await context.newPage();
    const player = await openPage(page);
    await select(page, '#p4', 'The', '#p4', 'ledger.');

    await shortcut(serviceWorker, await tabIdOf(serviceWorker, page));
    await expect(player).toHaveAttribute('data-status', 'playing');
    await expect.poll(() => highlightText(page, 'lumen-sentence')).toBe('The harbour master closed his ledger.');
  });
});

/** The current sentence index, read from the expanded player's status line. */
async function statusIndexOf(page: Page) {
  const status = playerOf(page).getByRole('status');
  if (!(await status.count())) await playerOf(page).hover();
  return statusIndex(status);
}

test.describe('click to jump', () => {
  async function startPlaying(page: Page) {
    const player = await openPage(page);
    await button(player, 'Play').click();
    await expect.poll(() => highlightText(page, 'lumen-sentence')).toBe('An evening at the harbour');
    return player;
  }

  test("while playing, clicking a word jumps to the start of that word's sentence", async ({ context }) => {
    const page = await context.newPage();
    await startPlaying(page);
    const words = await recordWords(page);
    const p = await wordPoint(page, '#p4', 'turning');
    await page.mouse.click(p.x, p.y);

    await expect.poll(() => highlightText(page, 'lumen-sentence')).toBe('The tide was turning again.');
    // Reading continues from the sentence start, not the clicked word.
    await expect.poll(async () => (await words()).join(' '), { timeout: 5000 }).toContain('The tide was');
    await expect(playerOf(page)).toHaveAttribute('data-status', 'playing');
  });

  test('clicking a link while playing follows it, with no jump', async ({ context }) => {
    const page = await context.newPage();
    await startPlaying(page);
    const p = await wordPoint(page, '#link', 'notice');
    await page.mouse.click(p.x, p.y);

    await page.waitForURL(/\/demo\.html$/);
    // Navigating away ended the session.
    await expect(playerOf(page)).toHaveAttribute('data-status', 'idle');
  });

  test('a click while paused does not move the position, and play resumes at the paused sentence', async ({
    context,
  }) => {
    const page = await context.newPage();
    const player = await startPlaying(page);
    await button(player, 'Pause').click();
    await expect(player).toHaveAttribute('data-status', 'paused');
    const pausedSentence = await highlightText(page, 'lumen-sentence');

    const p = await wordPoint(page, '#p4', 'turning');
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(300);
    expect(await highlightText(page, 'lumen-sentence')).toBe(pausedSentence);

    await button(player, 'Play').click();
    await expect(player).toHaveAttribute('data-status', 'playing');
    await expect.poll(() => highlightText(page, 'lumen-sentence')).toBe(pausedSentence);
  });

  test('drag-selecting during playback selects text and does not move the position', async ({ context }) => {
    const page = await context.newPage();
    await startPlaying(page);
    const from = await wordPoint(page, '#p3', 'Children');
    const to = await wordPoint(page, '#p3', 'sea');

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();

    expect(await page.evaluate(() => getSelection()!.toString())).toContain('ren ran along the');
    await page.waitForTimeout(300);
    // Still in the opening sentences; p3 starts at sentence 6.
    expect(await statusIndexOf(page)).toBeLessThan(5);
    expect(await highlightText(page, 'lumen-sentence')).not.toContain('Children');
  });
});

test.describe('skip by sentence', () => {
  test('the player buttons skip forward and back one sentence, and skip back on the first restarts it', async ({
    context,
  }) => {
    const page = await context.newPage();
    const player = await openPage(page, '/demo.html');
    await player.hover();
    await expect(player).toHaveAttribute('data-expanded', 'true');
    await button(player, 'Play').click();
    const status = player.getByRole('status');
    await expect(status).toContainText('sentence 1 of 6');

    await button(player, 'Next sentence').click();
    await expect(status).toContainText('sentence 2 of 6');
    await expect.poll(() => highlightText(page, 'lumen-sentence')).toBe('Each step was worn smooth by a century of boots.');

    await button(player, 'Previous sentence').click();
    await expect(status).toContainText('sentence 1 of 6');
    await expect.poll(() => highlightText(page, 'lumen-sentence')).toBe('The lighthouse keeper climbed the stairs at dusk.');

    // On the first sentence, skip back restarts it from its first word. "keeper" is
    // highlighted for only ~300 ms, so sample it through the 5 ms recorder.
    const words = await recordWords(page);
    await expect.poll(async () => (await words()).includes('keeper'), { intervals: [20] }).toBe(true);
    await button(player, 'Previous sentence').click();
    // The restart comes before sentence 2 ("Each step…") is ever reached.
    await expect.poll(async () => (await words()).join(' ')).toMatch(/keeper(?:(?!Each).)* The lighthouse/);
    await expect(status).toContainText('sentence 1 of 6');
    await expect(player).toHaveAttribute('data-status', 'playing');
  });

  test('skip forward on the last sentence ends playback as if the text had finished', async ({ context }) => {
    const page = await context.newPage();
    const player = await openPage(page, '/demo.html');
    await player.hover();
    await button(player, 'Play').click();
    const status = player.getByRole('status');
    for (let n = 2; n <= 6; n++) {
      await button(player, 'Next sentence').click();
      await expect(status).toContainText(`sentence ${n} of 6`);
    }
    await button(player, 'Next sentence').click();

    await expect(player).toHaveAttribute('data-status', 'stopped');
    await expect.poll(() => highlightText(page, 'lumen-sentence')).toBe('');
  });
});
