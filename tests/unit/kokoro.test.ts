import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIRST_CHUNK_CHARS, splitChunks, wordTimings } from '@/lib/tts/kokoro/chunks';
import { KokoroPlayer, type AudioOut, type Synthesis } from '@/lib/tts/kokoro/player';
import { spokenText } from '@/lib/tts/kokoro/spoken';
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

  it('does not end a chunk inside a file path, but still ends one at a dot followed by a space', () => {
    const text = 'See docs/agents/issue-tracker.md now. Next.';
    const chunks = splitChunks(text);
    expect(chunks).toEqual([
      { text: 'See docs/agents/issue-tracker.md now.', offset: 0 },
      { text: 'Next.', offset: 38 },
    ]);
    for (const c of chunks) expect(text.slice(c.offset, c.offset + c.text.length)).toBe(c.text);
  });

  it('does not end a chunk at a leading or inner dot of a word, but does after an ellipsis', () => {
    const text = 'Load .env from ../lib with Node.js now. Then wait...what so…yes';
    const chunks = splitChunks(text);
    expect(chunks).toEqual([
      { text: 'Load .env from ../lib with Node.js now.', offset: 0 },
      { text: 'Then wait...', offset: 40 },
      { text: 'what so…', offset: 52 },
      { text: 'yes', offset: 60 },
    ]);
    for (const c of chunks) expect(text.slice(c.offset, c.offset + c.text.length)).toBe(c.text);
  });

  it('measures the limit on the spoken form, which is longer than the displayed text for paths', () => {
    const text = `Files ${Array.from({ length: 30 }, (_, i) => `a${i}/b.c`).join(' ')} done.`;
    const chunks = splitChunks(text, 100);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(spokenText(c.text).length).toBeLessThanOrEqual(100);
    for (const c of chunks) expect(text.slice(c.offset, c.offset + c.text.length)).toBe(c.text);
  });

  it('breaks a path or URL longer than the limit after a slash', () => {
    const text = 'example.com/docs/agents/issue-tracker.md';
    const chunks = splitChunks(text, 30);
    expect(chunks.map((c) => c.text)).toEqual(['example.com/', 'docs/agents/', 'issue-tracker.md']);
    for (const c of chunks) expect(text.slice(c.offset, c.offset + c.text.length)).toBe(c.text);
  });

  it('can hold only the first chunk to a shorter limit', () => {
    const text = 'aaaa, bbbb cccc dddd. eeee ffff gggg hhhh.';
    const chunks = splitChunks(text, 30, 8);
    expect(chunks.map((c) => c.text)).toEqual(['aaaa,', 'bbbb cccc dddd.', 'eeee ffff gggg hhhh.']);
    for (const c of chunks) expect(text.slice(c.offset, c.offset + c.text.length)).toBe(c.text);
  });
});

describe('wordTimings', () => {
  it('places words by text position across the audio and offsets them into the utterance', () => {
    expect(wordTimings({ text: 'ab cd', offset: 10 }, 1)).toEqual([
      { at: 0, charIndex: 10, length: 2 },
      { at: 0.6, charIndex: 13, length: 2 },
    ]);
  });

  it('places words by their position in the spoken text', () => {
    // Spoken: "See a slash b slash c now" (25 chars), with "a/b/c" at 4 and "now" at 22.
    expect(wordTimings({ text: 'See a/b/c now', offset: 0 }, 25)).toEqual([
      { at: 0, charIndex: 0, length: 3 },
      { at: 4, charIndex: 4, length: 5 },
      { at: 22, charIndex: 10, length: 3 },
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
  const played: { at: number; samples: number; offset: number }[] = [];
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
    play({ audio, sampleRate }, at, offset = 0) {
      const i = played.push({ at, samples: audio.length, offset }) - 1;
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

  it('synthesises a sentence with a file path as one spoken request, with events on the displayed text', async () => {
    const { player, log, synth } = setup();
    player.speak({ id: 1, text: 'See docs/agents/issue-tracker.md now.', voice: 'af_heart', speed: 1 }, false);
    await vi.runAllTimersAsync();

    expect(synth.requests).toEqual(['See docs slash agents slash issue tracker dot md now.']);
    expect(log.map((e) => e.event)).toEqual([
      { type: 'start' },
      { type: 'word', charIndex: 0, length: 3 },
      { type: 'word', charIndex: 4, length: 28 },
      { type: 'word', charIndex: 33, length: 4 },
      { type: 'end', charIndex: 37 },
    ]);
  });

  it('from silence, starts with a short chunk; behind other speech, chunks are whole sentences', async () => {
    const { player, synth } = setup();
    const long = `First part, ${'x'.repeat(FIRST_CHUNK_CHARS)} end.`;
    player.speak({ id: 1, text: long, voice: 'af_heart', speed: 1 }, false);
    player.speak({ id: 2, text: long, voice: 'af_heart', speed: 1 }, true);
    await vi.runAllTimersAsync();

    expect(synth.requests).toEqual(['First part,', `${'x'.repeat(FIRST_CHUNK_CHARS)} end.`, long]);
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
    expect(player.resume()).toBe(true);
    await vi.runAllTimersAsync();
    expect(log.at(-1)!.event.type).toBe('end');
    expect(log.at(-1)!.t).toBeGreaterThan(5000);
    expect(player.resume()).toBe(false); // nothing left to continue
  });

  it('resume backs up to the start of the phrase, replaying its audio without synthesising again', async () => {
    const { player, log, synth, audio } = setup();
    // One chunk from t=50 ms at 100 ms a character: "then" is at 0.8 s, "more." at 1.3 s.
    player.speak({ id: 1, text: 'Hi you, then more.', voice: 'af_heart', speed: 1 }, false);
    await vi.advanceTimersByTimeAsync(1150); // 1.1 s into the audio, during "then"
    player.pause();
    await vi.advanceTimersByTimeAsync(2000);
    const before = log.length;
    player.resume();
    await vi.runAllTimersAsync();

    expect(synth.requests).toEqual(['Hi you, then more.']);
    // The chunk replays from "then", 0.3 s back, at the moment of the resume.
    expect(audio.played.at(-1)!.offset).toBeCloseTo(0.8);
    expect(audio.played.at(-1)!.at).toBeCloseTo(1.15);
    expect(log.slice(before).map((e) => e.event)).toEqual([
      { type: 'word', charIndex: 8, length: 4 },
      { type: 'word', charIndex: 13, length: 5 },
      { type: 'end', charIndex: 18 },
    ]);
    // "then" again at once, then the rest 0.3 s later than it would have been.
    expect(log.at(-2)!.t - log.at(-3)!.t).toBeGreaterThanOrEqual(480);
    expect(log.at(-2)!.t - log.at(-3)!.t).toBeLessThanOrEqual(520);
  });

  it('in the first phrase, resume backs up to the start of the chunk', async () => {
    const { player, audio } = setup();
    player.speak({ id: 1, text: 'Hi you, then more.', voice: 'af_heart', speed: 1 }, false);
    await vi.advanceTimersByTimeAsync(550); // during "you,"
    player.pause();
    player.resume();
    expect(audio.played.at(-1)).toMatchObject({ offset: 0 });
    expect(audio.played.at(-1)!.at).toBeCloseTo(0.55);
  });

  it('a backed-up start moves to the pause after the punctuation', async () => {
    const audio = fakeAudio();
    // Loud everywhere except 0.6–0.8 s, the pause after "you,".
    const synth = {
      async synthesize({ text }: { text: string }): Promise<Synthesis> {
        await new Promise((r) => setTimeout(r, 50));
        const samples = new Float32Array(text.length).fill(0.5);
        samples[6] = samples[7] = 0;
        return { audio: samples, sampleRate: 10 };
      },
    };
    const player = new KokoroPlayer(synth, () => {}, () => audio.out);
    player.speak({ id: 1, text: 'Hi you, then more.', voice: 'af_heart', speed: 1 }, false);
    await vi.advanceTimersByTimeAsync(1150);
    player.pause();
    player.resume();
    // Both quiet frames are in the pause; the one nearer the estimate (0.8 s) wins.
    expect(audio.played.at(-1)!.offset).toBeCloseTo(0.7);
  });

  it('later chunks and their events move back by the same amount', async () => {
    const { player, log, audio } = setup();
    player.speak({ id: 1, text: 'Hi you, then. Go.', voice: 'af_heart', speed: 1 }, false);
    await vi.runAllTimersAsync();
    const unpaused = log.find((e) => e.event.type === 'end')!.t;
    log.length = 0;

    player.speak({ id: 2, text: 'Hi you, then. Go.', voice: 'af_heart', speed: 1 }, false);
    const start = Date.now();
    await vi.advanceTimersByTimeAsync(1150); // during "then.", 0.3 s after it starts
    player.pause();
    player.resume();
    await vi.runAllTimersAsync();
    // "Go." was already scheduled; it is replayed 0.3 s later, and so is the end.
    const go = audio.played.filter((p) => p.samples === 3).at(-1)!;
    expect(go.offset).toBe(0);
    const end = log.find((e) => e.event.type === 'end')!.t - start;
    expect(end - unpaused).toBeGreaterThanOrEqual(280);
    expect(end - unpaused).toBeLessThanOrEqual(320);
  });

  it('a pause before the audio output exists still holds the first chunk', async () => {
    const audio = fakeAudio();
    const log: TtsEvent[] = [];
    let created = 0;
    const player = new KokoroPlayer(fakeSynth(), (_, event) => log.push(event), () => (created++, audio.out));
    player.speak({ id: 1, text: 'Hold me.', voice: 'af_heart', speed: 1 }, false);
    player.pause();
    await vi.advanceTimersByTimeAsync(5000);
    expect(created).toBe(1);
    expect(log).toEqual([]);
    player.resume();
    await vi.runAllTimersAsync();
    expect(log.at(-1)?.type).toBe('end');
  });

  it('finishes an utterance with nothing to say without synthesising', async () => {
    const { player, types, synth } = setup();
    player.speak({ id: 1, text: '   ', voice: 'af_heart', speed: 1 }, false);
    await vi.runAllTimersAsync();
    expect(types(1)).toEqual(['start', 'end']);
    expect(synth.requests).toEqual([]);
  });
});
