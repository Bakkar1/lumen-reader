import { browser } from 'wxt/browser';
import { PORT_NAME, TabPortClient, isBackgroundToTab, type BackgroundToTab, type FrameProbe } from '@/lib/messages';
import { SettingsSync } from '@/lib/storage/settings';
import { PositionStore } from '@/lib/storage/positions';
import { extractPage } from '@/lib/text/extract';
import { PageReader } from './reader';
import { PlayerUi, MIN_READABLE_CHARS, READABLE_CHECKS_MS } from './ui';

declare global {
  interface Window {
    __lumenReaderLoaded?: boolean;
    /** Called by the background (scripting.executeScript) to pick the frame to read. */
    __lumenProbe?: () => FrameProbe;
  }
}

/** Posted by a child frame to the top window: it has readable text, so show the player. */
const FRAME_READABLE = 'lumen-reader:frame-readable';
/** A child frame smaller than this (ads, trackers, widgets) never shows the player. */
const MIN_FRAME_AREA = 300 * 200;

export default defineContentScript({
  matches: ['<all_urls>'],
  // Page content can live in an iframe (e.g. SCORM course players), so every frame gets a reader.
  allFrames: true,
  matchAboutBlank: true,
  main() {
    // The background may inject this script into tabs opened before install; run once.
    if (window.__lumenReaderLoaded) return;
    window.__lumenReaderLoaded = true;
    const isTop = window === window.top;

    const deliver = (message: BackgroundToTab) => {
      reader.onMessage(message);
      ui?.onMessage(message);
    };
    const client = new TabPortClient({
      connect: () => browser.runtime.connect({ name: PORT_NAME }),
      onMessage: deliver,
    });
    const send = client.send.bind(client);
    const reader = new PageReader({
      send,
      // The player is in the top frame; a child frame being read reports through the background.
      onFollowChange: (following) => (ui ? ui.setFollowing(following) : send({ type: 'following', following })),
    });
    window.__lumenProbe = () => reader.probe();

    // Only the top frame shows the player.
    const ui = isTop
      ? new PlayerUi({
          reader,
          send,
          settings: new SettingsSync(browser.storage.sync, browser.storage.onChanged),
          positions: new PositionStore(browser.storage.local),
        })
      : null;
    if (ui) {
      ui.showWhenReadable();
      window.addEventListener('message', (e) => {
        if (e.data === FRAME_READABLE) ui.revealForFrame();
      });
    } else {
      reportWhenReadable();
    }

    // Start requests (and "show the player") arrive by tabs.sendMessage, because idle tabs have no port.
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (sender.id !== browser.runtime.id || !isBackgroundToTab(message)) return;
      deliver(message);
      sendResponse(true);
    });
  },
});

/**
 * A child frame with readable content tells the top frame to show the player.
 * By postMessage rather than the background, so idle tabs never wake the worker.
 */
function reportWhenReadable(): void {
  // Reported at every check: the top frame's script may not be listening yet at the first.
  for (const delay of READABLE_CHECKS_MS) {
    setTimeout(() => {
      if (window.innerWidth * window.innerHeight < MIN_FRAME_AREA) return;
      if (extractPage(document).text.trim().length < MIN_READABLE_CHARS) return;
      window.top?.postMessage(FRAME_READABLE, '*');
    }, delay);
  }
}
