import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FAKE_VOICE_NO_WORDS,
  FAKE_VOICE_WORDS,
  FakeTtsEngine,
} from '@/lib/tts/fake-engine';
import type { TtsEvent } from '@/lib/tts/engine';

/** Records events with the fake clock's timestamp. */
function recorder() {
  const log: (TtsEvent & { t: number })[] = [];
  return { log, on: (e: TtsEvent) => log.push({ ...e, t: Date.now() }) };
}

describe('FakeTtsEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 0 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // 10 ms per character at 1×, so durations are easy to reason about.
  const engine = (wordEvents = true) => new FakeTtsEngine({ defaultWordEvents: wordEvents, msPerChar: 10 });

  it('emits start, one word event per word, then end, in order and on schedule', async () => {
    const tts = engine();
    const r = recorder();
    tts.speak('Hello big world', { rate: 1 }, r.on);
    await vi.runAllTimersAsync();

    expect(r.log).toEqual([
      { type: 'start', t: 0 },
      { type: 'word', charIndex: 0, length: 5, t: 0 },
      { type: 'word', charIndex: 6, length: 3, t: 60 },
      { type: 'word', charIndex: 10, length: 5, t: 100 },
      { type: 'end', charIndex: 15, t: 150 },
    ]);
  });

  it('emits no word events for the no-word voice', async () => {
    const tts = engine();
    const r = recorder();
    tts.speak('Hello big world', { rate: 1, voiceName: FAKE_VOICE_NO_WORDS }, r.on);
    await vi.runAllTimersAsync();

    expect(r.log.map((e) => e.type)).toEqual(['start', 'end']);
    expect(r.log.at(-1)?.t).toBe(150);
  });

  it('uses the build-flag default voice when none is given', async () => {
    const tts = engine(false);
    const r = recorder();
    tts.speak('Hi there', { rate: 1 }, r.on);
    await vi.runAllTimersAsync();
    expect(r.log.map((e) => e.type)).toEqual(['start', 'end']);
  });

  it('scales durations by rate', async () => {
    const tts = engine();
    const r = recorder();
    tts.speak('Hello big world', { rate: 2 }, r.on);
    await vi.runAllTimersAsync();
    expect(r.log.at(-1)).toEqual({ type: 'end', charIndex: 15, t: 75 });
  });

  it('interrupts the current utterance when speaking without enqueue', async () => {
    const tts = engine();
    const a = recorder();
    const b = recorder();
    tts.speak('First sentence here', { rate: 1 }, a.on);
    await vi.advanceTimersByTimeAsync(50);
    tts.speak('Second', { rate: 1 }, b.on);
    await vi.runAllTimersAsync();

    expect(a.log.at(-1)?.type).toBe('interrupted');
    expect(a.log.some((e) => e.type === 'end')).toBe(false);
    expect(b.log.map((e) => e.type)).toEqual(['start', 'word', 'end']);
  });

  it('plays enqueued utterances back to back', async () => {
    const tts = engine();
    const a = recorder();
    const b = recorder();
    tts.speak('One two', { rate: 1 }, a.on);
    tts.speak('Three', { rate: 1, enqueue: true }, b.on);
    await vi.runAllTimersAsync();

    expect(a.log.at(-1)).toEqual({ type: 'end', charIndex: 7, t: 70 });
    expect(b.log[0]).toEqual({ type: 'start', t: 70 });
    expect(b.log.at(-1)).toEqual({ type: 'end', charIndex: 5, t: 120 });
  });

  it('stop interrupts the current utterance and cancels queued ones', async () => {
    const tts = engine();
    const a = recorder();
    const b = recorder();
    tts.speak('One two', { rate: 1 }, a.on);
    tts.speak('Three', { rate: 1, enqueue: true }, b.on);
    await vi.advanceTimersByTimeAsync(20);
    tts.stop();
    await vi.runAllTimersAsync();

    expect(a.log.at(-1)?.type).toBe('interrupted');
    expect(b.log).toEqual([{ type: 'cancelled', t: 20 }]);
    expect(await tts.isSpeaking()).toBe(false);
  });

  it('pause freezes progress and resume continues where it was', async () => {
    const tts = engine();
    const r = recorder();
    tts.speak('Hello big world', { rate: 1 }, r.on);
    await vi.advanceTimersByTimeAsync(70); // past "big"
    tts.pause();
    await vi.advanceTimersByTimeAsync(1000);
    expect(r.log.map((e) => e.type)).toEqual(['start', 'word', 'word']);
    expect(await tts.resume()).toBe(true);
    await vi.runAllTimersAsync();

    expect(r.log.slice(3)).toEqual([
      { type: 'word', charIndex: 10, length: 5, t: 1100 },
      { type: 'end', charIndex: 15, t: 1150 },
    ]);
  });

  it('reports speaking state', async () => {
    const tts = engine();
    expect(await tts.isSpeaking()).toBe(false);
    tts.speak('Hi', { rate: 1 }, () => {});
    expect(await tts.isSpeaking()).toBe(true);
    await vi.runAllTimersAsync();
    expect(await tts.isSpeaking()).toBe(false);
  });

  it('lists the default voice first and reports capabilities', async () => {
    const voices = await engine(false).getVoices();
    expect(voices.map((v) => v.voiceName)).toEqual([FAKE_VOICE_NO_WORDS, FAKE_VOICE_WORDS]);

    const tts = engine();
    expect(tts.capabilities(FAKE_VOICE_WORDS).wordEvents).toBe(true);
    expect(tts.capabilities(FAKE_VOICE_NO_WORDS).wordEvents).toBe(false);
  });
});
