import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { splitChunks, wordTimings } from '@/lib/tts/kokoro/chunks';
import { KokoroPlayer, type AudioOut, type Synthesis } from '@/lib/tts/kokoro/player';
import { DEFAULT_KOKORO_VOICE, KOKORO_VOICES, kokoroVoice } from '@/lib/tts/kokoro/voices';
import type { TtsEvent } from '@/lib/tts/engine';

describe('splitChunks', () => {
  it('splits an utterance into sentences with their offsets', () => {
    const text = 'One two. Three four!  Five?';
    const chunks = splitChunks(text);
    expect(chunks).toEqual([
      { text: 'One two.', offset: 0 },
      { text: 'Three four!', offset: 9 },
      { text: 'Five?', offset: 22 },
    ]);
    for (const c of chunks) expect(text.slice(c.offset, c.offset + c.text.length)).toBe(c.text);
  });

  it('keeps a trailing sentence without end punctuation and drops whitespace', () => {
    expect(splitChunks('  Hello there. And more')).toEqual([
      { text: 'Hello there.', offset: 2 },
      { text: 'And more', offset: 15 },
    ]);
    expect(splitChunks('   ')).toEqual([]);
  });

  it('breaks long sentences at a comma, else at a space', () => {
    const text = 'aaaa bbbb, cccc dddd eeee ffff';
    const chunks = splitChunks(text, 12);
    expect(chunks.map((c) => c.text)).toEqual(['aaaa bbbb,', 'cccc dddd', 'eeee ffff']);
    for (const c of chunks) expect(text.slice(c.offset, c.offset + c.text.length)).toBe(c.text);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(12);
  });
});

describe('wordTimings', () => {
  it('places words by text position across the audio and offsets them into the utterance', () => {
    expect(wordTimings({ text: 'ab cd', offset: 10 }, 1)).toEqual([
      { at: 0, charIndex: 10, length: 2 },
      { at: 0.6, charIndex: 13, length: 2 },
    ]);
  });
});

describe('Kokoro voices', () => {
  it('maps display names to kokoro-js ids and falls back to the best voice', () => {
    expect(DEFAULT_KOKORO_VOICE.id).toBe('af_heart');
    expect(kokoroVoice('Kokoro Emma (UK)')).toMatchObject({ id: 'bf_emma', lang: 'en-GB' });
    expect(kokoroVoice('Samantha')).toBe(DEFAULT_KOKORO_VOICE);
    expect(new Set(KOKORO_VOICES.map((v) => v.voiceName)).size).toBe(KOKORO_VOICES.length);
  });
});

/** An audio clock that follows the fake timers, at 1 s of audio per 1 s of time. */
function fakeAudio() {
  let suspendedAt: number | null = null;
  let offset = 0;
  const played: { at: number; samples: number }[] = [];
  const stopped: number[] = [];
  const out: AudioOut = {
    get currentTime() {
      return (suspendedAt ?? Date.now()) / 1000 - offset;
    },
    async suspend() {
      suspendedAt ??= Date.now();
    },
    async resume() {
      if (suspendedAt !== null) offset += (Date.now() - suspendedAt) / 1000;
      suspendedAt = null;
    },
    play({ audio, sampleRate }, at) {
      const i = played.push({ at, samples: audio.length }) - 1;
      return { duration: audio.length / sampleRate, stop: () => stopped.push(i) };
    },
  };
  return { out, played, stopped };
}

/** Synthesises 1 audio sample per character at 10 Hz (100 ms a character), after `delay` ms. */
function fakeSynth(delay = 50) {
  const requests: string[] = [];
  return {
    requests,
    fail: null as string | null,
    async synthesize({ text }: { text: string }): Promise<Synthesis> {
      requests.push(text);
      await new Promise((r) => setTimeout(r, delay));
      if (this.fail && text.includes(this.fail)) throw new Error('boom');
      return { audio: new Float32Array(text.length), sampleRate: 10 };
    },
  };
}

describe('KokoroPlayer', () => {
  beforeEach(() => vi.useFakeTimers({ now: 0 }));
  afterEach(() => vi.useRealTimers());

  function setup(delay?: number) {
    const audio = fakeAudio();
    const synth = fakeSynth(delay);
    const log: { id: number; event: TtsEvent; t: number }[] = [];
    const player = new KokoroPlayer(synth, (id, event) => log.push({ id, event, t: Date.now() }), () => audio.out);
    const types = (id?: number) => log.filter((e) => id === undefined || e.id === id).map((e) => e.event.type);
    return { audio, synth, log, player, types };
  }

  it('speaks each sentence as a chunk, with start, words and end on the audio clock', async () => {
    const { player, log, synth } = setup();
    player.speak({ id: 1, text: 'Hi you. Go.', voice: 'af_heart', speed: 1 }, false);
    await vi.runAllTimersAsync();

    expect(synth.requests).toEqual(['Hi you.', 'Go.']);
    // 'Hi you.' is 7 chars (0.7 s) from t=50; 'Go.' (0.3 s) follows straight after.
    expect(log.map((e) => e.event)).toEqual([
      { type: 'start' },
      { type: 'word', charIndex: 0, length: 2 },
      { type: 'word', charIndex: 3, length: 4 },
      { type: 'word', charIndex: 8, length: 3 },
      { type: 'end', charIndex: 11 },
    ]);
    // Cues fire on a 20 ms tick.
    const expected = [50, 50, 350, 750, 1050];
    log.forEach((e, i) => expect(e.t - expected[i]!).toBeGreaterThanOrEqual(0));
    log.forEach((e, i) => expect(e.t - expected[i]!).toBeLessThanOrEqual(20));
  });

  it('plays enqueued utterances back to back and reports each one', async () => {
    const { player, types, audio } = setup();
    player.speak({ id: 1, text: 'One.', voice: 'af_heart', speed: 1 }, false);
    player.speak({ id: 2, text: 'Two.', voice: 'af_heart', speed: 1 }, true);
    await vi.runAllTimersAsync();

    expect(types(1)).toEqual(['start', 'word', 'end']);
    expect(types(2)).toEqual(['start', 'word', 'end']);
    expect(audio.played[1]!.at).toBeCloseTo(audio.played[0]!.at + 0.4);
    expect(player.isSpeaking()).toBe(false);
  });

  it('stop interrupts the playing utterance, cancels the queued one and silences the audio', async () => {
    const { player, types, audio } = setup();
    player.speak({ id: 1, text: 'A long first sentence.', voice: 'af_heart', speed: 1 }, false);
    player.speak({ id: 2, text: 'Next.', voice: 'af_heart', speed: 1 }, true);
    await vi.advanceTimersByTimeAsync(500);
    player.stop();
    await vi.runAllTimersAsync();

    expect(types(1).at(-1)).toBe('interrupted');
    expect(types(2)).toEqual(['cancelled']);
    expect(audio.stopped.length).toBeGreaterThan(0);
    expect(player.isSpeaking()).toBe(false);
  });

  it('a non-enqueued speak replaces what is playing, dropping in-flight synthesis', async () => {
    const { player, types, synth } = setup(200);
    player.speak({ id: 1, text: 'Old text.', voice: 'af_heart', speed: 1 }, false);
    await vi.advanceTimersByTimeAsync(100);
    player.speak({ id: 2, text: 'New text.', voice: 'af_heart', speed: 1 }, false);
    await vi.runAllTimersAsync();

    expect(types(1)).toEqual(['cancelled']);
    expect(types(2)).toEqual(['start', 'word', 'word', 'end']);
    expect(synth.requests).toEqual(['Old text.', 'New text.']);
  });

  it('a synthesis failure reports an error and cancels what is queued behind it', async () => {
    const { player, types, synth } = setup();
    synth.fail = 'Bad';
    player.speak({ id: 1, text: 'Bad one.', voice: 'af_heart', speed: 1 }, false);
    player.speak({ id: 2, text: 'Fine.', voice: 'af_heart', speed: 1 }, true);
    await vi.runAllTimersAsync();

    expect(types(1)).toEqual(['error']);
    expect(types(2)).toEqual(['cancelled']);
  });

  it('pause holds playback and events until resume', async () => {
    const { player, log } = setup();
    player.speak({ id: 1, text: 'Hold me.', voice: 'af_heart', speed: 1 }, false);
    await vi.advanceTimersByTimeAsync(200);
    player.pause();
    await vi.advanceTimersByTimeAsync(5000);
    expect(log.some((e) => e.event.type === 'end')).toBe(false);
    player.resume();
    await vi.runAllTimersAsync();
    expect(log.at(-1)!.event.type).toBe('end');
    expect(log.at(-1)!.t).toBeGreaterThan(5000);
  });

  it('finishes an utterance with nothing to say without synthesising', async () => {
    const { player, types, synth } = setup();
    player.speak({ id: 1, text: '   ', voice: 'af_heart', speed: 1 }, false);
    await vi.runAllTimersAsync();
    expect(types(1)).toEqual(['start', 'end']);
    expect(synth.requests).toEqual([]);
  });
});
