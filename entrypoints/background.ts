import { browser } from 'wxt/browser';
import {
  PortRegistry,
  isFrameProbe,
  isPopupRequest,
  type BackgroundToTab,
  type ControlAction,
  type PopupRequest,
  type StartMode,
  type TabToBackground,
} from '@/lib/messages';
import { SessionController } from '@/lib/session';
import { pickFrame, type ProbedFrame } from '@/lib/frames';
import { loadSnapshot, saveSnapshot } from '@/lib/storage/session-store';
import { DEFAULT_SETTINGS, SettingsSync } from '@/lib/storage/settings';
import { PositionStore, positionRecord, urlKey } from '@/lib/storage/positions';
import { createTtsEngine } from '@/lib/tts';

const stripFragment = (url: string) => url.split('#')[0] ?? url;

const STARTS_READING: readonly ControlAction[] = ['play', 'resume', 'toggle'];

const LISTEN_MENU_ID = 'lumen-listen';
/** The `commands` entry in wxt.config.ts. */
const TOGGLE_COMMAND = 'toggle-reading';
const PRUNE_ALARM = 'lumen-prune-positions';

export default defineBackground(() => {
  const engine = createTtsEngine();
  /** URL (without fragment) of the tab being read; null until known. */
  let sessionUrl: string | null = null;

  // Voice and speed are written only here; the tabs and the popup send their changes to us.
  const settings = new SettingsSync(browser.storage.sync, browser.storage.onChanged);
  const positions = new PositionStore(browser.storage.local);

  const controller = new SessionController({
    engine,
    send: (tabId, message, frameId) => registry.send(tabId, message, frameId),
    persist: (snapshot) => void saveSnapshot(snapshot),
    saveSettings: (patch) => void settings.save(patch).catch(() => {}),
    savePosition: ({ url, ...update }) =>
      void positions.save(urlKey(url), positionRecord(update, Date.now())).catch(() => {}),
    settings: { voiceName: DEFAULT_SETTINGS.voiceName, rate: DEFAULT_SETTINGS.rate },
  });

  const registry = new PortRegistry({
    onMessage: (tabId, message, frameId) => void ready.then(() => onTabMessage(tabId, message, frameId)),
    onDisconnect: (tabId, frameId) => void ready.then(() => controller.frameGone(tabId, frameId)),
  });

  const ready = (async () => {
    const saved = await settings.load().catch(() => DEFAULT_SETTINGS);
    controller.applySettings({ voiceName: saved.voiceName, rate: saved.rate });
    // Start-up reconciliation (design §4): a session from a previous worker
    // instance comes back paused at its last sentence, never "playing" while silent.
    const snapshot = await loadSnapshot().catch(() => null);
    if (snapshot) controller.restore(snapshot);
  })();

  // Resume positions expire after 30 days: pruned at start-up and once a day.
  void positions.prune().catch(() => {});
  void browser.alarms.get(PRUNE_ALARM).then((alarm) => {
    // Chrome may drop alarms on a browser restart, so re-create a missing one.
    if (!alarm) void browser.alarms.create(PRUNE_ALARM, { periodInMinutes: 24 * 60 });
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === PRUNE_ALARM) void positions.prune().catch(() => {});
  });

  // Voice or speed changed on another machine.
  settings.onChange(({ voiceName, rate }) => {
    if (voiceName === undefined && rate === undefined) return;
    void ready.then(() => {
      controller.applySettings({ voiceName, rate });
      broadcastState();
    });
  });

  function onTabMessage(tabId: number, message: TabToBackground, frameId: number): void {
    switch (message.type) {
      case 'hello':
        registry.send(tabId, { type: 'state', state: controller.getState(tabId) }, frameId);
        break;
      case 'load':
        sessionUrl = null;
        void browser.tabs.get(tabId).then((t) => (sessionUrl = stripFragment(t.url ?? '')), () => {});
        void controller.load(tabId, message, frameId);
        break;
      case 'control': {
        const handled = controller.control(tabId, message.action);
        // The player's play button on a tab with no session: start one.
        if (!handled && STARTS_READING.includes(message.action)) {
          void requestStart(tabId, 'auto').catch(() => {});
        }
        break;
      }
      case 'jump':
        controller.jump(tabId, message.index, frameId);
        break;
      case 'following':
        // The reading frame's auto-scroll, shown by the player in the top frame.
        if (controller.readingFrame(tabId) === frameId) registry.send(tabId, message, 0);
        break;
      case 'backToReading': {
        const reading = controller.readingFrame(tabId);
        if (reading !== null) registry.send(tabId, message, reading);
        break;
      }
      case 'setRate':
        controller.setRate(message.rate);
        broadcastState();
        break;
      case 'setVoice':
        void controller.setVoice(message.voiceName).then(broadcastState);
        break;
      case 'getVoices':
        // The player asks when it expands, which is usually just before play is pressed.
        engine.prepare();
        void engine.getVoices().then(
          (voices) => registry.send(tabId, { type: 'voices', voices }, frameId),
          () => {},
        );
        break;
      case 'heartbeat':
        break;
    }
  }

  /**
   * The controller only publishes to the session's tab; every other tab's
   * player still needs the new voice and speed. Tabs without a port follow
   * the synced settings themselves.
   */
  function broadcastState(): void {
    for (const tabId of registry.tabIds()) {
      if (tabId !== controller.activeTabId) registry.send(tabId, { type: 'state', state: controller.getState(tabId) });
    }
  }

  /**
   * Starts reading in a tab that has no session yet by asking the content
   * script of the right frame to extract (`frameId`, or the best frame).
   * Idle tabs have no port (they connect lazily), so this goes through
   * tabs.sendMessage.
   */
  async function requestStart(tabId: number, mode: StartMode = 'auto', frameId?: number): Promise<void> {
    // The model loads while the page's text is found and extracted.
    engine.prepare();
    const message: BackgroundToTab = { type: 'requestStart', mode };
    const target = frameId ?? (await chooseFrame(tabId, mode));
    if (target === null) return;
    try {
      await browser.tabs.sendMessage(tabId, message, { frameId: target });
    } catch {
      await injectContentScript(tabId);
      await browser.tabs.sendMessage(tabId, message, { frameId: target });
    }
  }

  /** The frame to read: the page's content may be in an iframe (e.g. a SCORM course player). */
  async function chooseFrame(tabId: number, mode: StartMode): Promise<number | null> {
    let frames = await probeFrames(tabId);
    if (!frames.some((f) => f.frameId === 0)) {
      await injectContentScript(tabId);
      frames = await probeFrames(tabId);
    }
    return pickFrame(frames, mode);
  }

  /** Asks every frame's content script how well it could serve a start request. */
  async function probeFrames(tabId: number): Promise<ProbedFrame[]> {
    const results = await browser.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => (globalThis as { __lumenProbe?: () => unknown }).__lumenProbe?.() ?? null,
    });
    return results.flatMap((r) => (isFrameProbe(r.result) ? [{ frameId: r.frameId, probe: r.result }] : []));
  }

  /** Tabs opened before the extension was loaded have no content script yet. */
  async function injectContentScript(tabId: number): Promise<void> {
    await browser.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['/content-scripts/content.js'] });
  }

  async function onPopupRequest(request: PopupRequest): Promise<unknown> {
    await ready;
    switch (request.type) {
      case 'popup:getState':
        // Opening the popup is usually the first step towards pressing play.
        engine.prepare();
        return controller.getState(request.tabId);
      case 'popup:control': {
        const handled = controller.control(request.tabId, request.action);
        if (!handled && STARTS_READING.includes(request.action)) {
          await requestStart(request.tabId).catch(() => {});
        }
        return controller.getState(request.tabId);
      }
      case 'popup:setRate':
        controller.setRate(request.rate);
        broadcastState();
        return null;
      case 'popup:setVoice':
        await controller.setVoice(request.voiceName);
        broadcastState();
        return null;
      case 'popup:getVoices':
        return engine.getVoices();
    }
  }

  /** Context menu "Listen" (design §8): the selection if there is one, otherwise the page. */
  async function onMenuClick(
    info: { menuItemId: string | number; selectionText?: string; frameId?: number },
    tab?: { id?: number },
  ) {
    if (info.menuItemId !== LISTEN_MENU_ID || tab?.id === undefined) return;
    await ready;
    // A selection is read in the frame it was made in; a page goes to the frame with the content.
    if (info.selectionText) await requestStart(tab.id, 'selection', info.frameId).catch(() => {});
    else await requestStart(tab.id, 'page').catch(() => {});
  }

  /** The shortcut toggles play/pause, and starts reading (selection, else page) when idle. */
  async function onCommand(command: string, tab?: { id?: number }) {
    if (command !== TOGGLE_COMMAND) return;
    const tabId = tab?.id ?? (await browser.tabs.query({ active: true, currentWindow: true }))[0]?.id;
    if (tabId === undefined) return;
    await ready;
    if (!controller.control(tabId, 'toggle')) await requestStart(tabId, 'auto').catch(() => {});
  }

  browser.runtime.onInstalled.addListener(() => {
    void browser.contextMenus.removeAll().then(() =>
      browser.contextMenus.create({
        id: LISTEN_MENU_ID,
        title: 'Listen with Lumen Reader',
        contexts: ['selection', 'page'],
      }),
    );
  });
  browser.contextMenus.onClicked.addListener((info, tab) => void onMenuClick(info, tab));
  browser.commands.onCommand.addListener((command, tab) => void onCommand(command, tab));

  // Native menus and Chrome commands cannot be driven through CDP (SPEC.md §15),
  // so E2E builds expose the handlers to the tests.
  if (__LUMEN_E2E__) Object.assign(globalThis, { __lumenTest: { onMenuClick, onCommand } });

  browser.runtime.onConnect.addListener((port) => registry.accept(port));

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id || !isPopupRequest(message)) return;
    onPopupRequest(message).then(sendResponse, () => sendResponse(null));
    return true;
  });

  browser.tabs.onRemoved.addListener((tabId) => void ready.then(() => controller.tabGone(tabId)));

  // Navigating the session's tab to another URL ends the session. Full page
  // loads also disconnect the port; this catches SPA (pushState) navigation.
  browser.tabs.onUpdated.addListener(async (tabId, change) => {
    if (!change.url) return;
    await ready;
    if (tabId !== controller.activeTabId) return;
    sessionUrl ??= await browser.tabs.get(tabId).then((t) => stripFragment(t.url ?? ''), () => '');
    // A fragment-only change is not navigating away.
    if (stripFragment(change.url) !== sessionUrl) controller.tabGone(tabId);
  });
});
