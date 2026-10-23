import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TtsEvent } from '@/lib/tts/engine';

/** A minimal chrome.runtime/offscreen: one offscreen document that may or may not exist. */
const fake = vi.hoisted(() => {
  const state = {
    hasDocument: false,
    sent: [] as Record<string, unknown>[],
    listeners: [] as ((message: unknown, sender: { id: string }) => void)[],
  };
  const browser = {
    runtime: {
      id: 'lumen',
      getURL: (p: string) => `chrome-extension://lumen${p}`,
      getContexts: async () => (state.hasDocument ? [{}] : []),
      sendMessage: async (m: Record<string, unknown>) => {
        state.sent.push(m);
        return m.type === 'isSpeaking' ? true : null;
      },
      onMessage: { addListener: (l: (typeof state.listeners)[number]) => state.listeners.push(l) },
    },
    offscreen: {
      createDocument: async () => {
        state.hasDocument = true;
      },
    },
  };
  const fromOffscreen = (id: number, event: TtsEvent) =>
    state.listeners.forEach((l) => l({ target: 'lumen-background', type: 'event', id, event }, { id: 'lumen' }));
  return { state, browser, fromOffscreen };
});

vi.mock('wxt/browser', () => ({ browser: fake.browser }));

const { KokoroTtsEngine } = await import('@/lib/tts/kokoro-engine');

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('KokoroTtsEngine', () => {
  beforeEach(() => {
    fake.state.hasDocument = false;
    fake.state.sent = [];
    fake.state.listeners = [];
  });

  it('lists only Kokoro voices and promises word events', async () => {
    const engine = new KokoroTtsEngine();
    const voices = await engine.getVoices();
    expect(voices[0]).toEqual({ voiceName: 'Kokoro Heart (US)', lang: 'en-US', remote: false });
    expect(voices.every((v) => v.voiceName.startsWith('Kokoro '))).toBe(true);
    expect(engine.capabilities('Kokoro Heart (US)').wordEvents).toBe(true);
  });

  it('opens the offscreen document on speak and routes its events to the caller', async () => {
    const engine = new KokoroTtsEngine();
    const events: TtsEvent[] = [];
    engine.speak('Hello.', { voiceName: 'Kokoro Emma (UK)', rate: 1.5 }, (e) => events.push(e));
    await flush();

    expect(fake.state.hasDocument).toBe(true);
    expect(fake.state.sent).toEqual([
      { target: 'lumen-offscreen', type: 'speak', id: 1, text: 'Hello.', voice: 'bf_emma', speed: 1.5, enqueue: false },
    ]);
    fake.fromOffscreen(1, { type: 'start' });
    fake.fromOffscreen(1, { type: 'end', charIndex: 6 });
    fake.fromOffscreen(1, { type: 'word', charIndex: 0, length: 5 });
    expect(events).toEqual([{ type: 'start' }, { type: 'end', charIndex: 6 }]);
  });

  it('a stop without a document does not cancel a speak that follows it', async () => {
    // SessionController.load halts (stop) and then speaks before the document exists.
    const engine = new KokoroTtsEngine();
    const events: TtsEvent[] = [];
    engine.stop();
    engine.speak('New.', { rate: 1 }, (e) => events.push(e));
    await flush();

    fake.fromOffscreen(1, { type: 'start' });
    expect(events).toEqual([{ type: 'start' }]);
  });

  it('reports an error when the offscreen document cannot be opened', async () => {
    const engine = new KokoroTtsEngine();
    const create = vi.spyOn(fake.browser.offscreen, 'createDocument').mockRejectedValueOnce(new Error('denied'));
    const events: TtsEvent[] = [];
    engine.speak('Hello.', { rate: 1 }, (e) => events.push(e));
    await flush();
    expect(events).toEqual([{ type: 'error', message: 'denied' }]);
    create.mockRestore();
  });

  it('does not open a document just to stop, pause or ask whether it is speaking', async () => {
    const engine = new KokoroTtsEngine();
    engine.stop();
    engine.pause();
    expect(await engine.isSpeaking()).toBe(false);
    expect(fake.state.hasDocument).toBe(false);
    expect(fake.state.sent).toEqual([]);
  });
});
