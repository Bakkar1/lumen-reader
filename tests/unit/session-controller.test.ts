import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionController, type PlaybackSettings, type PositionUpdate, type SessionSnapshot } from '@/lib/session';
import { FAKE_VOICE_NO_WORDS, FAKE_VOICE_WORDS, FakeTtsEngine } from '@/lib/tts/fake-engine';
import type { BackgroundToTab, SentenceRef } from '@/lib/messages';
import { effectiveRate, normaliseRate } from '@/lib/tts/caps';

function sentences(...texts: string[]): SentenceRef[] {
  let pos = 0;
  return texts.map((text) => {
    const s = { text, start: pos, end: pos + text.length };
    pos = s.end + 1;
    return s;
  });
}

const TEXT = sentences('One two three.', 'Four five.', 'Six seven eight nine.');
/** The utterance that reads TEXT from sentence `i`: all of it fits in one. */
const from = (i: number) => TEXT.slice(i).map((s) => s.text).join(' ');

function setup(opts: { voiceName?: string | null; rate?: number; msPerChar?: number } = {}) {
  const engine = new FakeTtsEngine({ msPerChar: 10 });
  const speak = vi.spyOn(engine, 'speak');
  const sent: { tabId: number; msg: BackgroundToTab; frameId?: number }[] = [];
  const snapshots: (SessionSnapshot | null)[] = [];
  const savedSettings: Partial<PlaybackSettings>[] = [];
  const positions: PositionUpdate[] = [];
  const controller = new SessionController({
    engine,
    send: (tabId, msg, frameId) => sent.push({ tabId, msg, frameId }),
    persist: (s) => snapshots.push(s),
    saveSettings: (patch) => savedSettings.push(patch),
    savePosition: (p) => positions.push(p),
    settings: { voiceName: opts.voiceName === undefined ? FAKE_VOICE_WORDS : opts.voiceName, rate: opts.rate ?? 1 },
    caps: [{ pattern: /^Capped/, maxRate: 2, note: 'test' }],
    // The fake engine's speed, so estimated sentence timing matches it.
    msPerChar: opts.msPerChar ?? 10,
  });
  const of = (tabId: number, type: BackgroundToTab['type']) =>
    sent.filter((s) => s.tabId === tabId && s.msg.type === type).map((s) => s.msg);
  const lastState = (tabId: number) => {
    const s = of(tabId, 'state').at(-1);
    return s?.type === 'state' ? s.state : undefined;
  };
  return { engine, speak, sent, of, lastState, controller, snapshots, savedSettings, positions };
}

const PAGE_URL = 'https://example.com/article';

const load = (
  c: SessionController,
  tabId = 1,
  startIndex = 0,
  list = TEXT,
  source: 'page' | 'selection' = 'page',
) => c.load(tabId, { type: 'load', sentences: list, lang: 'en', startIndex, source, url: PAGE_URL });

describe('SessionController', () => {
  beforeEach(() => vi.useFakeTimers({ now: 0 }));
  afterEach(() => vi.useRealTimers());

  it('starts at the requested sentence and reports sentence and absolute word offsets', async () => {
    const t = setup();
    await load(t.controller, 1, 1);
    await vi.advanceTimersByTimeAsync(0);

    expect(t.lastState(1)).toMatchObject({ status: 'playing', index: 1, total: 3 });
    expect(t.of(1, 'sentence')[0]).toEqual({ type: 'sentence', index: 1 });
    // "Four five." starts at offset 15; "five" is 5 chars in.
    await vi.advanceTimersByTimeAsync(60);
    expect(t.of(1, 'word')).toEqual([
      { type: 'word', index: 1, charIndex: 15, length: 4 },
      { type: 'word', index: 1, charIndex: 20, length: 5 },
    ]);
  });

  it('joins sentences into one utterance and enqueues the next one ahead of time', async () => {
    const t = setup();
    // 280 chars: too long to join "One two three. Four five.", short enough to take "Six." along.
    const long = 'word '.repeat(56).trim() + '.';
    const list = sentences('One two three.', 'Four five.', long, 'Six.');
    await load(t.controller, 1, 0, list);
    await vi.advanceTimersByTimeAsync(0);

    expect(t.speak.mock.calls.map(([text, o]) => [text, o.enqueue ?? false])).toEqual([
      ['One two three. Four five.', false],
      [`${long} Six.`, true],
    ]);
  });

  it('ends an utterance after a sentence without closing punctuation, such as a heading', async () => {
    const t = setup();
    await load(t.controller, 1, 0, sentences('A heading', 'One two three.', 'Four five.'));
    await vi.advanceTimersByTimeAsync(0);

    expect(t.speak.mock.calls.map(([text]) => text)).toEqual(['A heading', 'One two three. Four five.']);
  });

  it('follows word events into the next sentence of a joined utterance', async () => {
    const t = setup();
    await load(t.controller);
    await vi.advanceTimersByTimeAsync(160); // "Four" is at char 15
    expect(t.of(1, 'sentence').at(-1)).toEqual({ type: 'sentence', index: 1 });
    expect(t.of(1, 'word').at(-1)).toEqual({ type: 'word', index: 1, charIndex: 15, length: 4 });
    expect(t.lastState(1)?.index).toBe(1);
  });

  it('reads every sentence in order, then reports finished and stopped', async () => {
    const t = setup();
    await load(t.controller);
    await vi.runAllTimersAsync();

    expect(t.of(1, 'sentence').map((m) => (m.type === 'sentence' ? m.index : -1))).toEqual([0, 1, 2]);
    expect(t.of(1, 'finished')).toHaveLength(1);
    expect(t.lastState(1)?.status).toBe('stopped');
    expect(await t.engine.isSpeaking()).toBe(false);
  });

  it('pause holds the speech and resume continues it mid-sentence', async () => {
    const t = setup();
    await load(t.controller);
    await vi.advanceTimersByTimeAsync(170); // into sentence 1, after "Four"
    t.controller.control(1, 'pause');
    expect(t.lastState(1)).toMatchObject({ status: 'paused', index: 1 });
    expect(await t.engine.isSpeaking()).toBe(true);

    const wordsBefore = t.of(1, 'word').length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.of(1, 'word')).toHaveLength(wordsBefore); // nothing moves while paused

    t.speak.mockClear();
    t.controller.control(1, 'resume');
    expect(t.lastState(1)).toMatchObject({ status: 'playing', index: 1 });
    await vi.advanceTimersByTimeAsync(30);
    expect(t.speak).not.toHaveBeenCalled();
    expect(t.of(1, 'word').at(-1)).toEqual({ type: 'word', index: 1, charIndex: 20, length: 5 }); // "five"
  });

  it('resume re-speaks the sentence when the engine lost the held speech', async () => {
    const t = setup();
    await load(t.controller);
    await vi.advanceTimersByTimeAsync(170);
    t.controller.control(1, 'pause');
    vi.spyOn(t.engine, 'resume').mockResolvedValueOnce(false);

    t.speak.mockClear();
    t.controller.control(1, 'resume');
    await vi.advanceTimersByTimeAsync(0);
    expect(t.speak.mock.calls[0]?.[0]).toBe(from(1));
    expect(t.lastState(1)).toMatchObject({ status: 'playing', index: 1 });
  });

  it('with a voice without word events, pause stops and resume re-speaks the sentence', async () => {
    const t = setup({ voiceName: FAKE_VOICE_NO_WORDS });
    await load(t.controller);
    await vi.advanceTimersByTimeAsync(170);
    t.controller.control(1, 'pause');
    expect(await t.engine.isSpeaking()).toBe(false);

    t.speak.mockClear();
    t.controller.control(1, 'resume');
    expect(t.speak.mock.calls[0]?.[0]).toBe(from(t.lastState(1)!.index));
  });

  it('toggle pauses a playing session and resumes a paused one', async () => {
    const t = setup();
    await load(t.controller);
    t.controller.control(1, 'toggle');
    expect(t.lastState(1)?.status).toBe('paused');
    t.controller.control(1, 'toggle');
    expect(t.lastState(1)?.status).toBe('playing');
  });

  it('stop ends speech, clears the position and a later play starts from the beginning', async () => {
    const t = setup();
    await load(t.controller);
    await vi.advanceTimersByTimeAsync(170);
    t.controller.control(1, 'stop');

    expect(t.lastState(1)).toMatchObject({ status: 'stopped', index: 0 });
    expect(await t.engine.isSpeaking()).toBe(false);

    t.speak.mockClear();
    t.controller.control(1, 'play');
    expect(t.speak.mock.calls[0]?.[0]).toBe(from(0));
  });

  it('starting a second tab stops the first', async () => {
    const t = setup();
    await load(t.controller, 1);
    await load(t.controller, 2);

    expect(t.lastState(1)?.status).toBe('stopped');
    expect(t.lastState(2)?.status).toBe('playing');
    expect(t.controller.getState(1).status).toBe('idle');
    t.controller.control(1, 'play');
    expect(t.lastState(2)?.status).toBe('playing');
  });

  it('a speed change mid-read continues from the current sentence at the new speed', async () => {
    const t = setup();
    await load(t.controller);
    await vi.advanceTimersByTimeAsync(170); // sentence 1
    t.speak.mockClear();
    t.controller.setRate(1.5);

    expect(t.speak.mock.calls[0]?.[0]).toBe(from(1));
    expect(t.speak.mock.calls[0]?.[1]).toMatchObject({ rate: 1.5, enqueue: false });
    expect(t.lastState(1)).toMatchObject({ status: 'playing', index: 1, rate: 1.5, effectiveRate: 1.5 });
  });

  it('a speed change while paused applies without starting playback', async () => {
    const t = setup();
    await load(t.controller);
    t.controller.control(1, 'pause');
    t.speak.mockClear();
    t.controller.setRate(2);
    expect(t.speak).not.toHaveBeenCalled();
    expect(t.lastState(1)).toMatchObject({ status: 'paused', rate: 2 });

    // The held speech was at the old speed: resume speaks the sentence again at the new one.
    t.controller.control(1, 'resume');
    expect(t.speak.mock.calls[0]?.[0]).toBe(from(0));
    expect(t.speak.mock.calls[0]?.[1]).toMatchObject({ rate: 2 });
  });

  it('clamps to the voice cap and reports the effective speed', async () => {
    const t = setup({ voiceName: 'Capped voice' });
    // The fake engine has no "Capped voice", so make it known for this test.
    vi.spyOn(t.engine, 'getVoices').mockResolvedValue([
      { voiceName: 'Capped voice', lang: 'en-US', remote: false },
    ]);
    await load(t.controller);
    t.speak.mockClear();
    t.controller.setRate(3);

    expect(t.lastState(1)).toMatchObject({ rate: 3, effectiveRate: 2 });
    expect(t.speak.mock.calls[0]?.[1]).toMatchObject({ rate: 2 });
  });

  it('a voice change mid-read continues the current sentence in the new voice', async () => {
    const t = setup();
    await load(t.controller);
    await vi.advanceTimersByTimeAsync(170);
    t.speak.mockClear();
    await t.controller.setVoice(FAKE_VOICE_NO_WORDS);

    expect(t.speak.mock.calls[0]?.[0]).toBe(from(1));
    expect(t.speak.mock.calls[0]?.[1]).toMatchObject({ voiceName: FAKE_VOICE_NO_WORDS });
    expect(t.lastState(1)).toMatchObject({ voiceName: FAKE_VOICE_NO_WORDS, voiceUnavailable: false });
  });

  it('falls back to a default voice when the saved one is missing, and says so', async () => {
    const t = setup({ voiceName: 'Gone Voice' });
    await load(t.controller);

    expect(t.lastState(1)).toMatchObject({ voiceName: FAKE_VOICE_WORDS, voiceUnavailable: true });
    expect(t.speak.mock.calls[0]?.[1]).toMatchObject({ voiceName: FAKE_VOICE_WORDS });
  });

  it('marks the session as having no word timing for a voice without word events', async () => {
    const t = setup({ voiceName: FAKE_VOICE_NO_WORDS });
    await load(t.controller);
    await vi.runAllTimersAsync();

    expect(t.of(1, 'word')).toEqual([]);
    expect(t.of(1, 'sentence')).toHaveLength(3);
    expect(t.of(1, 'state').every((m) => m.type === 'state' && m.state.noWordTiming)).toBe(true);
  });

  it('without word events, moves through a joined utterance on estimated timing', async () => {
    const t = setup({ voiceName: FAKE_VOICE_NO_WORDS });
    await load(t.controller);
    await vi.advanceTimersByTimeAsync(140);
    expect(t.lastState(1)?.index).toBe(0);
    await vi.advanceTimersByTimeAsync(20); // "Four five." starts at char 15
    expect(t.lastState(1)?.index).toBe(1);
    expect(t.of(1, 'sentence').at(-1)).toEqual({ type: 'sentence', index: 1 });
  });

  it('calibrates the estimate from how long a voice without word events actually took', async () => {
    // The controller guesses 62 ms/char; the fake voice takes 10.
    const t = setup({ voiceName: FAKE_VOICE_NO_WORDS, msPerChar: 62 });
    const list = sentences('Alpha beta gamma delta epsilon zeta eta theta.', 'Heading', 'One two three.', 'Four five.');
    await load(t.controller, 1, 0, list);
    // Utterance 1 is 54 chars (540 ms); "Four five." is 150 ms into utterance 2.
    await vi.advanceTimersByTimeAsync(700);
    expect(t.lastState(1)?.index).toBe(3);
  });

  it('learns that a voice sends no word events after its first utterance', async () => {
    const t = setup({ voiceName: FAKE_VOICE_NO_WORDS });
    vi.spyOn(t.engine, 'capabilities').mockReturnValue({ wordEvents: null, minRate: 0.1, maxRate: 10 });
    await load(t.controller);
    expect(t.lastState(1)?.noWordTiming).toBe(false);
    await vi.advanceTimersByTimeAsync(500); // the utterance (48 chars) ends
    expect(t.lastState(1)?.noWordTiming).toBe(true);
  });

  it('stops when the tab being read closes or navigates, and ignores other tabs', async () => {
    const t = setup();
    await load(t.controller, 1);
    t.controller.tabGone(2);
    expect(await t.engine.isSpeaking()).toBe(true);
    t.controller.tabGone(1);

    expect(await t.engine.isSpeaking()).toBe(false);
    expect(t.controller.getState(1).status).toBe('idle');
    expect(t.snapshots.at(-1)).toBeNull();
  });

  it('restores a playing snapshot as paused at its sentence and resumes from there', async () => {
    const t = setup();
    const stop = vi.spyOn(t.engine, 'stop');
    t.controller.restore({
      tabId: 4,
      sentences: TEXT,
      lang: 'en',
      source: 'page',
      index: 2,
      status: 'playing',
      voiceName: FAKE_VOICE_WORDS,
      voiceUnavailable: false,
      url: PAGE_URL,
    });

    expect(stop).toHaveBeenCalled();
    expect(t.lastState(4)).toMatchObject({ status: 'paused', index: 2, total: 3 });
    t.controller.control(4, 'play');
    expect(t.speak.mock.calls[0]?.[0]).toBe(from(2));
  });

  describe('skipping by sentence', () => {
    it('skip forward continues at the next sentence', async () => {
      const t = setup();
      await load(t.controller);
      t.speak.mockClear();
      t.controller.control(1, 'skipForward');

      expect(t.speak.mock.calls[0]?.[0]).toBe(from(1));
      expect(t.lastState(1)).toMatchObject({ status: 'playing', index: 1 });
    });

    it('skip back always goes to the previous sentence, however far into the current one', async () => {
      const t = setup();
      await load(t.controller, 1, 2);
      await vi.advanceTimersByTimeAsync(150); // well into "Six seven eight nine."
      t.speak.mockClear();
      t.controller.control(1, 'skipBack');

      expect(t.speak.mock.calls[0]?.[0]).toBe(from(1));
      expect(t.lastState(1)).toMatchObject({ status: 'playing', index: 1 });
    });

    it('skip back on the first sentence restarts it', async () => {
      const t = setup();
      await load(t.controller);
      await vi.advanceTimersByTimeAsync(80);
      t.speak.mockClear();
      t.controller.control(1, 'skipBack');

      expect(t.speak.mock.calls[0]?.[0]).toBe(from(0));
      expect(t.speak.mock.calls[0]?.[1]).toMatchObject({ enqueue: false });
      expect(t.lastState(1)).toMatchObject({ status: 'playing', index: 0 });
    });

    it('skip forward on the last sentence ends playback as if the text had finished', async () => {
      const t = setup();
      await load(t.controller, 1, 2);
      t.speak.mockClear();
      t.controller.control(1, 'skipForward');

      expect(t.speak).not.toHaveBeenCalled();
      expect(await t.engine.isSpeaking()).toBe(false);
      expect(t.of(1, 'finished')).toHaveLength(1);
      expect(t.lastState(1)).toMatchObject({ status: 'stopped', index: 0 });
    });

    it('repeated presses step one sentence each, with no stale events from the skipped ones', async () => {
      const t = setup();
      await load(t.controller);
      t.controller.control(1, 'skipForward');
      t.controller.control(1, 'skipForward');
      await vi.advanceTimersByTimeAsync(0);

      expect(t.lastState(1)).toMatchObject({ status: 'playing', index: 2 });
      expect(t.of(1, 'sentence').at(-1)).toEqual({ type: 'sentence', index: 2 });
      const wordsBefore = t.of(1, 'word').length;
      await vi.runAllTimersAsync();
      const later = t.of(1, 'word').slice(wordsBefore);
      expect(later.length).toBeGreaterThan(0);
      expect(later.every((m) => m.type === 'word' && m.index === 2)).toBe(true);
    });

    it('skipping while paused moves the position and stays paused', async () => {
      const t = setup();
      await load(t.controller);
      t.controller.control(1, 'pause');
      t.speak.mockClear();
      t.controller.control(1, 'skipForward');

      expect(t.speak).not.toHaveBeenCalled();
      expect(t.lastState(1)).toMatchObject({ status: 'paused', index: 1 });
      t.controller.control(1, 'play');
      expect(t.speak.mock.calls[0]?.[0]).toBe(from(1));
    });

    it('does nothing without an active session', async () => {
      const t = setup();
      await load(t.controller);
      t.controller.control(1, 'stop');
      t.speak.mockClear();
      t.controller.control(1, 'skipForward');

      expect(t.speak).not.toHaveBeenCalled();
      expect(t.lastState(1)).toMatchObject({ status: 'stopped', index: 0 });
    });
  });

  describe('jumping to a sentence', () => {
    it('while playing, continues from the start of the given sentence', async () => {
      const t = setup();
      await load(t.controller);
      t.speak.mockClear();
      t.controller.jump(1, 2);

      expect(t.speak.mock.calls[0]?.[0]).toBe(from(2));
      expect(t.lastState(1)).toMatchObject({ status: 'playing', index: 2 });
    });

    it('is ignored while paused or stopped, for other tabs and for out-of-range indexes', async () => {
      const t = setup();
      await load(t.controller);
      t.controller.jump(2, 2);
      t.controller.jump(1, 9);
      expect(t.lastState(1)).toMatchObject({ status: 'playing', index: 0 });

      t.controller.control(1, 'pause');
      t.speak.mockClear();
      t.controller.jump(1, 2);
      expect(t.speak).not.toHaveBeenCalled();
      expect(t.lastState(1)).toMatchObject({ status: 'paused', index: 0 });
    });
  });

  it('persists a snapshot on every sentence change', async () => {
    const t = setup();
    await load(t.controller);
    await vi.advanceTimersByTimeAsync(170);
    const last = t.snapshots.at(-1);
    expect(last).toMatchObject({ tabId: 1, index: 1, status: 'playing' });
    expect(last?.sentences).toEqual(TEXT);
  });

  describe('resume positions', () => {
    const at = (index: number, finished = false): PositionUpdate => ({
      url: PAGE_URL,
      index,
      sentence: TEXT[index]!,
      finished,
    });

    it('saves the position on pause', async () => {
      const t = setup();
      await load(t.controller, 1, 1);
      t.controller.control(1, 'pause');
      expect(t.positions).toEqual([at(1)]);
    });

    it('saves where the user stopped, not the start it resets to', async () => {
      const t = setup();
      await load(t.controller, 1, 2);
      t.controller.control(1, 'stop');
      expect(t.positions).toEqual([at(2)]);
      // Stopping again has nothing new to save.
      t.controller.control(1, 'stop');
      expect(t.positions).toHaveLength(1);
    });

    it('marks the page finished when the last sentence ends, or on skipping past it', async () => {
      const t = setup();
      await load(t.controller, 1, 2);
      await vi.advanceTimersByTimeAsync(1000);
      expect(t.positions).toEqual([at(2, true)]);

      const u = setup();
      await load(u.controller, 1, 2);
      u.controller.control(1, 'skipForward');
      expect(u.positions).toEqual([at(2, true)]);
    });

    it('saves an abandoned read when the tab closes or navigates', async () => {
      const t = setup();
      await load(t.controller, 1, 1);
      t.controller.tabGone(1);
      expect(t.positions).toEqual([at(1)]);
    });

    it('does not overwrite a finished page when its tab closes afterwards', async () => {
      const t = setup();
      await load(t.controller, 1, 2);
      t.controller.control(1, 'skipForward');
      t.controller.tabGone(1);
      expect(t.positions).toEqual([at(2, true)]);
    });

    it('saves the old tab\'s position when reading starts in another tab', async () => {
      const t = setup();
      await load(t.controller, 1, 1);
      await load(t.controller, 2, 0);
      expect(t.positions).toEqual([at(1)]);
    });

    it('saves a session restored after a worker restart when its tab goes away', () => {
      const t = setup();
      t.controller.restore({
        tabId: 4,
        sentences: TEXT,
        lang: 'en',
        source: 'page',
        index: 2,
        status: 'playing',
        voiceName: FAKE_VOICE_WORDS,
        voiceUnavailable: false,
        url: PAGE_URL,
      });
      t.controller.tabGone(4);
      expect(t.positions).toEqual([at(2)]);
    });

    it('saves nothing for a selection read', async () => {
      const t = setup();
      await load(t.controller, 1, 1, TEXT, 'selection');
      t.controller.control(1, 'pause');
      t.controller.control(1, 'stop');
      expect(t.positions).toEqual([]);
    });
  });

  describe('frames', () => {
    const loadIn = (c: SessionController, frameId: number) =>
      c.load(1, { type: 'load', sentences: TEXT, lang: 'en', startIndex: 0, source: 'page', url: PAGE_URL }, frameId);

    it('sends progress to the reading frame only and state to the whole tab', async () => {
      const t = setup();
      await loadIn(t.controller, 7);
      await vi.advanceTimersByTimeAsync(60);

      expect(t.sent.filter((s) => s.msg.type === 'sentence' || s.msg.type === 'word').every((s) => s.frameId === 7)).toBe(true);
      expect(t.sent.filter((s) => s.msg.type === 'state').every((s) => s.frameId === undefined)).toBe(true);
      expect(t.controller.readingFrame(1)).toBe(7);
    });

    it('releases the previous frame when reading moves to another frame of the tab', async () => {
      const t = setup();
      await loadIn(t.controller, 0);
      await loadIn(t.controller, 7);
      expect(t.sent).toContainEqual({ tabId: 1, msg: { type: 'released' }, frameId: 0 });
      expect(t.controller.readingFrame(1)).toBe(7);
    });

    it('accepts jumps only from the reading frame', async () => {
      const t = setup();
      await loadIn(t.controller, 7);
      t.controller.jump(1, 2, 0);
      expect(t.lastState(1)?.index).toBe(0);
      t.controller.jump(1, 2, 7);
      expect(t.lastState(1)?.index).toBe(2);
    });

    it('ends the session only when the reading frame goes away', async () => {
      const t = setup();
      await loadIn(t.controller, 7);
      t.controller.frameGone(1, 3);
      expect(t.controller.activeTabId).toBe(1);
      t.controller.frameGone(1, 7);
      expect(t.controller.activeTabId).toBeNull();
    });
  });

  describe('synced settings', () => {
    it('saves a rate or voice the user picks', async () => {
      const t = setup();
      t.controller.setRate(1.54);
      await t.controller.setVoice(FAKE_VOICE_NO_WORDS);
      expect(t.savedSettings).toEqual([{ rate: 1.5 }, { voiceName: FAKE_VOICE_NO_WORDS }]);
    });

    it('applies settings loaded from storage without saving them back or starting playback', async () => {
      const t = setup();
      t.controller.applySettings({ rate: 2, voiceName: FAKE_VOICE_NO_WORDS });
      expect(t.savedSettings).toEqual([]);
      expect(t.controller.getState(1)).toMatchObject({ status: 'idle', rate: 2, voiceName: FAKE_VOICE_NO_WORDS });

      await load(t.controller);
      expect(t.speak.mock.calls[0]?.[1]).toMatchObject({ rate: 2, voiceName: FAKE_VOICE_NO_WORDS });
    });

    it('applies a change from another machine to the current sentence while playing', async () => {
      const t = setup();
      await load(t.controller);
      t.speak.mockClear();
      t.controller.applySettings({ rate: 1.5 });
      await vi.advanceTimersByTimeAsync(0);
      expect(t.speak.mock.calls[0]?.[0]).toBe(from(0));
      expect(t.speak.mock.calls[0]?.[1]).toMatchObject({ rate: 1.5 });
      expect(t.savedSettings).toEqual([]);
    });
  });
});

describe('rate helpers', () => {
  it('snaps to the 0.5–3.0 range in 0.1 steps', () => {
    expect(normaliseRate(0.2)).toBe(0.5);
    expect(normaliseRate(3.7)).toBe(3);
    expect(normaliseRate(1.26)).toBe(1.3);
    expect(normaliseRate(Number.NaN)).toBe(1);
  });

  it('applies the per-voice cap', () => {
    const caps = [{ pattern: /Google/, maxRate: 2, note: '' }];
    expect(effectiveRate(2.5, 'Google US English', caps)).toBe(2);
    expect(effectiveRate(2.5, 'Samantha', caps)).toBe(2.5);
    expect(effectiveRate(1.5, 'Google US English', caps)).toBe(1.5);
  });
});
