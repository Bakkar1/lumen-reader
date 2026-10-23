/**
 * Typed messages shared by every entrypoint (design §2).
 *
 * - Content script ⇄ background: one long-lived runtime.Port per frame. The
 *   player lives in the top frame; the text being read may be in any frame.
 * - Popup → background: runtime.sendMessage requests.
 *
 * Every message crosses a structured-clone boundary, so receivers validate
 * with the type guards below instead of trusting the static types.
 */

export const PORT_NAME = 'lumen-tab';

/** A sentence as the background sees it: its text and offsets into the extracted text. */
export interface SentenceRef {
  text: string;
  start: number;
  end: number;
}

export type ControlAction =
  | 'play'
  | 'pause'
  | 'resume'
  | 'toggle'
  | 'stop'
  | 'skipBack'
  | 'skipForward';

export type PlaybackStatus = 'idle' | 'playing' | 'paused' | 'stopped';

export interface PlaybackState {
  status: PlaybackStatus;
  /** Index of the current sentence. */
  index: number;
  total: number;
  /** Speed the user asked for. */
  rate: number;
  /** Speed actually used after the voice's cap. */
  effectiveRate: number;
  voiceName: string | null;
  /** The saved voice was missing, so a default was used. */
  voiceUnavailable: boolean;
  /** The voice sends no word events; the content script estimates word timing. */
  noWordTiming: boolean;
}

export type StartMode = 'page' | 'selection' | 'auto' | 'toggle';

export type TabToBackground =
  | {
      type: 'load';
      sentences: SentenceRef[];
      lang: string;
      startIndex: number;
      source: 'page' | 'selection';
      /** The page's address, for its resume position. */
      url: string;
    }
  | { type: 'control'; action: ControlAction }
  | { type: 'jump'; index: number }
  | { type: 'setRate'; rate: number }
  | { type: 'setVoice'; voiceName: string }
  | { type: 'heartbeat' }
  | { type: 'hello' }
  /** The reading frame's auto-scroll stopped or resumed following. */
  | { type: 'following'; following: boolean }
  /** The player's "Back to reading", for a session in another frame. */
  | { type: 'backToReading' }
  /** The player's voice list; answered with `voices`. */
  | { type: 'getVoices' };

export type BackgroundToTab =
  | { type: 'state'; state: PlaybackState }
  | { type: 'sentence'; index: number }
  /** `charIndex` is absolute, i.e. already offset by the sentence start. */
  | { type: 'word'; index: number; charIndex: number; length: number | null }
  | { type: 'finished' }
  /** Asks the tab to extract text and send a `load` (context menu, shortcut). */
  | { type: 'requestStart'; mode: StartMode }
  | { type: 'voices'; voices: VoiceInfo[] }
  /** The toolbar popup opened: show the player again if the user closed it. */
  | { type: 'showPlayer' }
  /** To the top frame: the reading frame's auto-scroll stopped or resumed following. */
  | { type: 'following'; following: boolean }
  /** To the reading frame: scroll back to the current sentence and follow again. */
  | { type: 'backToReading' }
  /** To a frame whose session moved to another frame of the same tab: drop its highlights. */
  | { type: 'released' };

/** A frame's answer when the background picks which frame to read (`__lumenProbe`). */
export interface FrameProbe {
  /** Has a readable selection. */
  selection: boolean;
  focused: boolean;
  /** Readable characters of the frame's main content. */
  chars: number;
}

export interface VoiceInfo {
  voiceName: string;
  lang: string | null;
  remote: boolean;
}

export type PopupRequest =
  | { type: 'popup:getState'; tabId: number }
  | { type: 'popup:control'; tabId: number; action: ControlAction }
  | { type: 'popup:setRate'; rate: number }
  | { type: 'popup:setVoice'; voiceName: string }
  | { type: 'popup:getVoices' };

// ---------------------------------------------------------------------------
// Type guards

type Obj = Record<string, unknown>;

const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null;
const isStr = (x: unknown): x is string => typeof x === 'string';
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isIndex = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0;
const isBool = (x: unknown): x is boolean => typeof x === 'boolean';

const CONTROL_ACTIONS: readonly ControlAction[] = [
  'play',
  'pause',
  'resume',
  'toggle',
  'stop',
  'skipBack',
  'skipForward',
];
const STATUSES: readonly PlaybackStatus[] = ['idle', 'playing', 'paused', 'stopped'];
const START_MODES: readonly StartMode[] = ['page', 'selection', 'auto', 'toggle'];

const isAction = (x: unknown): x is ControlAction => CONTROL_ACTIONS.includes(x as ControlAction);

function isVoiceInfo(x: unknown): x is VoiceInfo {
  return isObj(x) && isStr(x.voiceName) && (x.lang === null || isStr(x.lang)) && isBool(x.remote);
}

function isSentenceRef(x: unknown): x is SentenceRef {
  return isObj(x) && isStr(x.text) && isIndex(x.start) && isIndex(x.end) && x.end >= x.start;
}

export function isPlaybackState(x: unknown): x is PlaybackState {
  return (
    isObj(x) &&
    STATUSES.includes(x.status as PlaybackStatus) &&
    isIndex(x.index) &&
    isIndex(x.total) &&
    isNum(x.rate) &&
    isNum(x.effectiveRate) &&
    (x.voiceName === null || isStr(x.voiceName)) &&
    isBool(x.voiceUnavailable) &&
    isBool(x.noWordTiming)
  );
}

export function isTabToBackground(x: unknown): x is TabToBackground {
  if (!isObj(x)) return false;
  switch (x.type) {
    case 'load':
      return (
        Array.isArray(x.sentences) &&
        x.sentences.every(isSentenceRef) &&
        isStr(x.lang) &&
        isIndex(x.startIndex) &&
        (x.source === 'page' || x.source === 'selection') &&
        isStr(x.url)
      );
    case 'control':
      return isAction(x.action);
    case 'jump':
      return isIndex(x.index);
    case 'setRate':
      return isNum(x.rate);
    case 'setVoice':
      return isStr(x.voiceName);
    case 'following':
      return isBool(x.following);
    case 'heartbeat':
    case 'hello':
    case 'getVoices':
    case 'backToReading':
      return true;
    default:
      return false;
  }
}

export function isBackgroundToTab(x: unknown): x is BackgroundToTab {
  if (!isObj(x)) return false;
  switch (x.type) {
    case 'state':
      return isPlaybackState(x.state);
    case 'sentence':
      return isIndex(x.index);
    case 'word':
      return isIndex(x.index) && isIndex(x.charIndex) && (x.length === null || isIndex(x.length));
    case 'following':
      return isBool(x.following);
    case 'finished':
    case 'showPlayer':
    case 'backToReading':
    case 'released':
      return true;
    case 'requestStart':
      return START_MODES.includes(x.mode as StartMode);
    case 'voices':
      return Array.isArray(x.voices) && x.voices.every(isVoiceInfo);
    default:
      return false;
  }
}

export function isFrameProbe(x: unknown): x is FrameProbe {
  return isObj(x) && isBool(x.selection) && isBool(x.focused) && isIndex(x.chars);
}

export function isPopupRequest(x: unknown): x is PopupRequest {
  if (!isObj(x)) return false;
  switch (x.type) {
    case 'popup:getState':
      return isIndex(x.tabId);
    case 'popup:control':
      return isIndex(x.tabId) && isAction(x.action);
    case 'popup:setRate':
      return isNum(x.rate);
    case 'popup:setVoice':
      return isStr(x.voiceName);
    case 'popup:getVoices':
      return true;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Per-tab port plumbing (background side)

/** The subset of runtime.Port the registry needs, so it can be unit-tested. */
export interface MinimalPort {
  name: string;
  sender?: { tab?: { id?: number }; frameId?: number };
  postMessage(message: unknown): void;
  onMessage: { addListener(fn: (message: unknown) => void): void };
  onDisconnect: { addListener(fn: () => void): void };
}

export interface PortRegistryHandlers {
  onMessage(tabId: number, message: TabToBackground, frameId: number): void;
  onDisconnect?(tabId: number, frameId: number): void;
}

/** Tracks the content-script port of each frame and validates what arrives on it. */
export class PortRegistry {
  /** tabId → frameId → port. */
  private ports = new Map<number, Map<number, MinimalPort>>();

  constructor(private handlers: PortRegistryHandlers) {}

  /** Registers a newly connected port. Returns false if it is not a Lumen tab port. */
  accept(port: MinimalPort): boolean {
    const tabId = port.sender?.tab?.id;
    if (port.name !== PORT_NAME || tabId === undefined) return false;
    const frameId = port.sender?.frameId ?? 0;

    const frames = this.ports.get(tabId) ?? new Map<number, MinimalPort>();
    frames.set(frameId, port);
    this.ports.set(tabId, frames);
    port.onMessage.addListener((message) => {
      if (isTabToBackground(message)) this.handlers.onMessage(tabId, message, frameId);
    });
    port.onDisconnect.addListener(() => {
      // A reload can connect the new port before the old one disconnects.
      if (this.ports.get(tabId)?.get(frameId) !== port) return;
      this.remove(tabId, frameId);
      this.handlers.onDisconnect?.(tabId, frameId);
    });
    return true;
  }

  has(tabId: number): boolean {
    return this.ports.has(tabId);
  }

  /** Tabs with at least one live port. */
  tabIds(): number[] {
    return [...this.ports.keys()];
  }

  /**
   * Posts to one frame's port, or to every frame of the tab when `frameId` is
   * omitted. Returns false if nothing was delivered.
   */
  send(tabId: number, message: BackgroundToTab, frameId?: number): boolean {
    const frames = this.ports.get(tabId);
    if (!frames) return false;
    let delivered = false;
    for (const [id, port] of [...frames]) {
      if (frameId !== undefined && id !== frameId) continue;
      try {
        port.postMessage(message);
        delivered = true;
      } catch {
        this.remove(tabId, id);
      }
    }
    return delivered;
  }

  private remove(tabId: number, frameId: number): void {
    const frames = this.ports.get(tabId);
    frames?.delete(frameId);
    if (frames?.size === 0) this.ports.delete(tabId);
  }
}

// ---------------------------------------------------------------------------
// Per-tab port plumbing (content-script side)

/** Keeps the worker alive while playing (Chrome extends its lifetime on port traffic). */
export const HEARTBEAT_MS = 20_000;

export interface TabPortClientOptions {
  connect(): MinimalPort;
  onMessage(message: BackgroundToTab): void;
}

/**
 * The content script's end of the tab port. It connects lazily, so idle tabs
 * never wake the worker. If the worker restarts during a session it
 * reconnects at once, so the recovered state reaches the page (design §4).
 */
export class TabPortClient {
  private port: MinimalPort | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private inSession = false;

  constructor(private options: TabPortClientOptions) {}

  connect(): MinimalPort {
    if (this.port) return this.port;
    const port = this.options.connect();
    this.port = port;
    port.onMessage.addListener((message) => {
      if (!isBackgroundToTab(message)) return;
      if (message.type === 'state') this.track(message.state.status);
      this.options.onMessage(message);
    });
    port.onDisconnect.addListener(() => {
      if (this.port !== port) return;
      this.port = null;
      this.setHeartbeat(false);
      if (this.inSession) this.connect();
    });
    port.postMessage({ type: 'hello' } satisfies TabToBackground);
    return port;
  }

  send(message: TabToBackground): void {
    try {
      this.connect().postMessage(message);
    } catch {
      // The port died between checks (worker restart); retry once on a fresh one.
      this.port = null;
      this.connect().postMessage(message);
    }
  }

  private track(status: PlaybackStatus): void {
    this.inSession = status === 'playing' || status === 'paused';
    this.setHeartbeat(status === 'playing');
  }

  private setHeartbeat(on: boolean): void {
    if (on && !this.heartbeat) {
      this.heartbeat = setInterval(() => this.port?.postMessage({ type: 'heartbeat' }), HEARTBEAT_MS);
    } else if (!on && this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }
}
