import { browser } from 'wxt/browser';
import type { SpeakOptions, TtsEngine, TtsEvent, TtsVoice, VoiceCapabilities } from './engine';
import { isFinalEvent } from './engine';
import { voiceCap } from './caps';
import { isFromOffscreen, OFFSCREEN_PATH, type ToOffscreen } from './kokoro/protocol';
import { kokoroTtsVoices, kokoroVoice } from './kokoro/voices';

type Command = ToOffscreen extends infer T ? (T extends unknown ? Omit<T, 'target'> : never) : never;

/**
 * TtsEngine over Kokoro-82M (D2). The service worker can neither play audio
 * nor host a long-running model, so the model and the audio live in an
 * offscreen document (entrypoints/offscreen); this side forwards commands to
 * it and routes its events back to the session's callbacks.
 */
export class KokoroTtsEngine implements TtsEngine {
  private nextId = 0;
  private callbacks = new Map<number, (event: TtsEvent) => void>();
  /** Commands go out in order, each after the document exists. */
  private outbox: Promise<unknown> = Promise.resolve();
  private creating: Promise<void> | null = null;

  constructor() {
    browser.runtime.onMessage.addListener((message, sender) => {
      if (sender.id !== browser.runtime.id || !isFromOffscreen(message)) return;
      this.dispatch(message.id, message.event);
    });
  }

  async getVoices(): Promise<TtsVoice[]> {
    return kokoroTtsVoices();
  }

  capabilities(voiceName: string | undefined): VoiceCapabilities {
    // Word events are placed by text position within each synthesised sentence.
    return { wordEvents: true, minRate: 0.5, maxRate: voiceCap(voiceName) };
  }

  speak(text: string, options: SpeakOptions, onEvent: (event: TtsEvent) => void): void {
    const id = ++this.nextId;
    this.callbacks.set(id, onEvent);
    const voice = kokoroVoice(options.voiceName).id;
    void this.send({ type: 'speak', id, text, voice, speed: options.rate, enqueue: options.enqueue ?? false }, true).catch(
      (err: unknown) => this.dispatch(id, { type: 'error', message: err instanceof Error ? err.message : String(err) }),
    );
  }

  pause(): void {
    void this.send({ type: 'pause' }, false).catch(() => {});
  }

  resume(): void {
    void this.send({ type: 'resume' }, false).catch(() => {});
  }

  stop(): void {
    // Only what was queued before this call: a speak() right after stop() must survive it.
    const stopped = [...this.callbacks.keys()];
    void this.send({ type: 'stop' }, false).catch(() => {
      // No document: nothing is playing, but those callers still expect a final event.
      for (const id of stopped) this.dispatch(id, { type: 'cancelled' });
    });
  }

  async isSpeaking(): Promise<boolean> {
    return (await this.send({ type: 'isSpeaking' }, false).catch(() => false)) === true;
  }

  private dispatch(id: number, event: TtsEvent): void {
    const callback = this.callbacks.get(id);
    if (!callback) return;
    if (isFinalEvent(event)) this.callbacks.delete(id);
    callback(event);
  }

  /** Sends after earlier commands; `create` opens the offscreen document if needed, otherwise a missing one rejects. */
  private send(command: Command, create: boolean): Promise<unknown> {
    const sent = this.outbox.then(async () => {
      if (create) await this.ensureDocument();
      else if (!(await this.hasDocument())) throw new Error('no offscreen document');
      return browser.runtime.sendMessage({ target: 'lumen-offscreen', ...command } satisfies ToOffscreen);
    });
    this.outbox = sent.catch(() => {});
    return sent;
  }

  private async hasDocument(): Promise<boolean> {
    const contexts = await browser.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [browser.runtime.getURL(OFFSCREEN_PATH)],
    });
    return contexts.length > 0;
  }

  private async ensureDocument(): Promise<void> {
    if (await this.hasDocument()) return;
    this.creating ??= browser.offscreen
      .createDocument({
        url: OFFSCREEN_PATH,
        reasons: ['AUDIO_PLAYBACK', 'WORKERS'],
        justification: 'Runs the bundled Kokoro speech model and plays the speech it generates.',
      })
      .finally(() => (this.creating = null));
    await this.creating;
  }
}
