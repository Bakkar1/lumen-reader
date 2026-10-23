import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HEARTBEAT_MS,
  PORT_NAME,
  PortRegistry,
  TabPortClient,
  isBackgroundToTab,
  isPopupRequest,
  isTabToBackground,
  type BackgroundToTab,
  type MinimalPort,
  type PopupRequest,
  type TabToBackground,
} from '@/lib/messages';

const roundTrip = <T>(msg: T): unknown => JSON.parse(JSON.stringify(msg));

describe('message type guards', () => {
  const tabMessages: TabToBackground[] = [
    {
      type: 'load',
      sentences: [{ text: 'Hello there.', start: 0, end: 12 }],
      lang: 'en',
      startIndex: 0,
      source: 'page',
      url: 'https://example.com/post',
    },
    { type: 'control', action: 'pause' },
    { type: 'jump', index: 3 },
    { type: 'setRate', rate: 1.5 },
    { type: 'setVoice', voiceName: 'Samantha' },
    { type: 'heartbeat' },
    { type: 'hello' },
    { type: 'getVoices' },
  ];

  it.each(tabMessages)('accepts tab→background $type after a JSON round trip', (msg) => {
    const copy = roundTrip(msg);
    expect(isTabToBackground(copy)).toBe(true);
    expect(copy).toEqual(msg);
  });

  const bgMessages: BackgroundToTab[] = [
    {
      type: 'state',
      state: {
        status: 'playing',
        index: 2,
        total: 10,
        rate: 2,
        effectiveRate: 1.8,
        voiceName: 'Samantha',
        voiceUnavailable: false,
        noWordTiming: false,
      },
    },
    { type: 'sentence', index: 2 },
    { type: 'word', index: 2, charIndex: 17, length: 4 },
    { type: 'finished' },
    { type: 'requestStart', mode: 'selection' },
    {
      type: 'voices',
      voices: [
        { voiceName: 'Samantha', lang: 'en-US', remote: false },
        { voiceName: 'Mystery', lang: null, remote: true },
      ],
    },
    { type: 'showPlayer' },
  ];

  it.each(bgMessages)('accepts background→tab $type after a JSON round trip', (msg) => {
    const copy = roundTrip(msg);
    expect(isBackgroundToTab(copy)).toBe(true);
    expect(copy).toEqual(msg);
  });

  const popupMessages: PopupRequest[] = [
    { type: 'popup:getState', tabId: 4 },
    { type: 'popup:control', tabId: 4, action: 'toggle' },
    { type: 'popup:setRate', rate: 0.8 },
    { type: 'popup:setVoice', voiceName: 'Daniel' },
    { type: 'popup:getVoices' },
  ];

  it.each(popupMessages)('accepts popup request $type after a JSON round trip', (msg) => {
    expect(isPopupRequest(roundTrip(msg))).toBe(true);
  });

  it.each([
    null,
    42,
    'load',
    {},
    { type: 'nope' },
    { type: 'control', action: 'explode' },
    { type: 'jump', index: -1 },
    { type: 'jump', index: 1.5 },
    { type: 'setRate', rate: 'fast' },
    { type: 'setRate', rate: Number.NaN },
    { type: 'load', sentences: 'x', lang: 'en', startIndex: 0, source: 'page', url: 'u' },
    { type: 'load', sentences: [{ text: 'a', start: 5, end: 2 }], lang: 'en', startIndex: 0, source: 'page', url: 'u' },
    { type: 'load', sentences: [], lang: 'en', startIndex: 0, source: 'clipboard', url: 'u' },
    { type: 'load', sentences: [], lang: 'en', startIndex: 0, source: 'page' },
  ])('rejects malformed tab message %j', (msg) => {
    expect(isTabToBackground(msg)).toBe(false);
  });

  it.each([
    { type: 'voices', voices: 'all' },
    { type: 'voices', voices: [{ voiceName: 3, lang: 'en', remote: false }] },
    { type: 'voices', voices: [{ voiceName: 'A', lang: 'en' }] },
  ])('rejects malformed background message %j', (msg) => {
    expect(isBackgroundToTab(msg)).toBe(false);
  });

  it('does not confuse the three directions', () => {
    expect(isBackgroundToTab({ type: 'heartbeat' })).toBe(false);
    expect(isTabToBackground({ type: 'finished' })).toBe(false);
    expect(isPopupRequest({ type: 'control', action: 'play' })).toBe(false);
    expect(isPopupRequest({ type: 'popup:control', action: 'play' })).toBe(false); // tabId required
  });
});

class FakePort implements MinimalPort {
  name = PORT_NAME;
  sent: unknown[] = [];
  private messageListeners: ((m: unknown) => void)[] = [];
  private disconnectListeners: (() => void)[] = [];
  constructor(public sender?: { tab?: { id?: number }; frameId?: number }) {}
  postMessage(m: unknown) {
    this.sent.push(m);
  }
  onMessage = { addListener: (fn: (m: unknown) => void) => void this.messageListeners.push(fn) };
  onDisconnect = { addListener: (fn: () => void) => void this.disconnectListeners.push(fn) };
  emit(m: unknown) {
    this.messageListeners.forEach((fn) => fn(m));
  }
  disconnect() {
    this.disconnectListeners.forEach((fn) => fn());
  }
}

describe('PortRegistry', () => {
  it('routes valid messages with the sender tab id and ignores invalid ones', () => {
    const onMessage = vi.fn();
    const registry = new PortRegistry({ onMessage });
    const port = new FakePort({ tab: { id: 7 } });
    registry.accept(port);

    port.emit({ type: 'jump', index: 2 });
    port.emit({ type: 'garbage' });

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith(7, { type: 'jump', index: 2 }, 0);
  });

  it('sends to the right tab only', () => {
    const registry = new PortRegistry({ onMessage: () => {} });
    const a = new FakePort({ tab: { id: 1 } });
    const b = new FakePort({ tab: { id: 2 } });
    registry.accept(a);
    registry.accept(b);

    expect(registry.send(2, { type: 'finished' })).toBe(true);
    expect(a.sent).toEqual([]);
    expect(b.sent).toEqual([{ type: 'finished' }]);
    expect(registry.tabIds()).toEqual([1, 2]);
  });

  it('forgets a tab on disconnect and reports it', () => {
    const onDisconnect = vi.fn();
    const registry = new PortRegistry({ onMessage: () => {}, onDisconnect });
    const port = new FakePort({ tab: { id: 3 } });
    registry.accept(port);
    port.disconnect();

    expect(onDisconnect).toHaveBeenCalledWith(3, 0);
    expect(registry.has(3)).toBe(false);
    expect(registry.tabIds()).toEqual([]);
    expect(registry.send(3, { type: 'finished' })).toBe(false);
  });

  it('tracks each frame of a tab and sends to one frame or to all of them', () => {
    const onMessage = vi.fn();
    const onDisconnect = vi.fn();
    const registry = new PortRegistry({ onMessage, onDisconnect });
    const top = new FakePort({ tab: { id: 4 }, frameId: 0 });
    const child = new FakePort({ tab: { id: 4 }, frameId: 12 });
    registry.accept(top);
    registry.accept(child);

    child.emit({ type: 'jump', index: 1 });
    expect(onMessage).toHaveBeenCalledWith(4, { type: 'jump', index: 1 }, 12);

    registry.send(4, { type: 'sentence', index: 0 }, 12);
    registry.send(4, { type: 'finished' });
    expect(top.sent).toEqual([{ type: 'finished' }]);
    expect(child.sent).toEqual([{ type: 'sentence', index: 0 }, { type: 'finished' }]);

    child.disconnect();
    expect(onDisconnect).toHaveBeenCalledWith(4, 12);
    expect(registry.has(4)).toBe(true);
    expect(registry.send(4, { type: 'finished' }, 12)).toBe(false);
  });

  it('keeps the newer port when a tab reconnects before the old one disconnects', () => {
    const onDisconnect = vi.fn();
    const registry = new PortRegistry({ onMessage: () => {}, onDisconnect });
    const old = new FakePort({ tab: { id: 5 } });
    const fresh = new FakePort({ tab: { id: 5 } });
    registry.accept(old);
    registry.accept(fresh);
    old.disconnect();

    expect(onDisconnect).not.toHaveBeenCalled();
    registry.send(5, { type: 'finished' });
    expect(fresh.sent).toEqual([{ type: 'finished' }]);
  });

  it('ignores ports with another name or without a tab', () => {
    const registry = new PortRegistry({ onMessage: () => {} });
    const other = new FakePort({ tab: { id: 9 } });
    other.name = 'something-else';
    expect(registry.accept(other)).toBe(false);
    expect(registry.accept(new FakePort({}))).toBe(false);
  });
});

describe('TabPortClient', () => {
  afterEach(() => vi.useRealTimers());

  const playing = {
    type: 'state',
    state: {
      status: 'playing',
      index: 0,
      total: 2,
      rate: 1,
      effectiveRate: 1,
      voiceName: null,
      voiceUnavailable: false,
      noWordTiming: false,
    },
  } as const;

  function setup() {
    const ports: FakePort[] = [];
    const received: BackgroundToTab[] = [];
    const client = new TabPortClient({
      connect: () => {
        const p = new FakePort({});
        ports.push(p);
        return p;
      },
      onMessage: (m) => received.push(m),
    });
    return { ports, received, client };
  }

  it('connects lazily on first send and says hello', () => {
    const { ports, client } = setup();
    expect(ports).toHaveLength(0);
    client.send({ type: 'control', action: 'play' });
    expect(ports).toHaveLength(1);
    expect(ports[0]?.sent).toEqual([{ type: 'hello' }, { type: 'control', action: 'play' }]);
  });

  it('delivers only valid background messages', () => {
    const { ports, received, client } = setup();
    client.connect();
    ports[0]?.emit({ type: 'finished' });
    ports[0]?.emit({ type: 'heartbeat' });
    expect(received).toEqual([{ type: 'finished' }]);
  });

  it('sends heartbeats while playing and stops when paused', () => {
    vi.useFakeTimers();
    const { ports, client } = setup();
    client.connect();
    const port = ports[0]!;
    port.emit(playing);
    vi.advanceTimersByTime(HEARTBEAT_MS * 2);
    expect(port.sent.filter((m) => (m as { type: string }).type === 'heartbeat')).toHaveLength(2);

    port.emit({ ...playing, state: { ...playing.state, status: 'paused' } });
    vi.advanceTimersByTime(HEARTBEAT_MS * 3);
    expect(port.sent.filter((m) => (m as { type: string }).type === 'heartbeat')).toHaveLength(2);
  });

  it('reconnects at once after a disconnect while in a session, but not when idle', () => {
    const { ports, client } = setup();
    client.connect();
    ports[0]?.emit(playing);
    ports[0]?.disconnect();
    expect(ports).toHaveLength(2);
    expect(ports[1]?.sent).toEqual([{ type: 'hello' }]);

    ports[1]?.emit({ ...playing, state: { ...playing.state, status: 'stopped' } });
    ports[1]?.disconnect();
    expect(ports).toHaveLength(2);
  });
});
