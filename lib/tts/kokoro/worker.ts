/// <reference lib="webworker" />
import { env } from '@huggingface/transformers';
import { KokoroTTS } from 'kokoro-js';
import type { SynthesisRequest, SynthesisResult } from './protocol';
import { DEFAULT_KOKORO_VOICE } from './voices';

/**
 * Runs Kokoro-82M (q8, ONNX Runtime WASM) off the offscreen document's main
 * thread. Everything is loaded from the extension package (scripts/fetch-kokoro.mjs);
 * nothing is fetched from the network.
 */

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const base = `${self.location.origin}/kokoro/`;

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = `${base}models/`;
// The files are already local; caching them again would only double the storage.
env.useBrowserCache = false;
const wasm = env.backends.onnx.wasm!;
wasm.wasmPaths = `${base}ort/`;
// WASM threads need cross-origin isolation (set in the manifest); a few are plenty for an 82M model.
wasm.numThreads = self.crossOriginIsolated ? Math.min(4, Math.max(1, navigator.hardwareConcurrency - 1)) : 1;

// kokoro-js reads voice files from a fixed Hugging Face URL; serve the bundled copies instead.
const VOICE_URL = `https://huggingface.co/${MODEL_ID}/resolve/main/voices/`;
const networkFetch = self.fetch.bind(self);
self.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return networkFetch(url.startsWith(VOICE_URL) ? `${base}voices/${url.slice(VOICE_URL.length)}` : input, init);
};

const loadStart = performance.now();
const model = KokoroTTS.from_pretrained(MODEL_ID, { dtype: 'q8', device: 'wasm' });

/** One synthesis at a time: the ONNX session is not re-entrant. */
let queue: Promise<void> = model
  .then(async (tts) => {
    console.debug(`[lumen] Kokoro loaded in ${ms(loadStart)} (${wasm.numThreads} threads)`);
    // The first run of an ONNX session is the slowest; take that hit before anyone is waiting.
    const warmStart = performance.now();
    await tts.generate('Ready.', { voice: DEFAULT_KOKORO_VOICE.id as keyof typeof tts.voices });
    console.debug(`[lumen] Kokoro warmed up in ${ms(warmStart)}`);
  })
  // A failed load is reported to each request instead.
  .catch(() => {});

self.onmessage = (e: MessageEvent<SynthesisRequest>) => {
  const { id, text, voice, speed } = e.data;
  queue = queue.then(async () => {
    let result: SynthesisResult;
    try {
      const tts = await model;
      const start = performance.now();
      const audio = await tts.generate(text, { voice: voice as keyof typeof tts.voices, speed });
      const seconds = audio.audio.length / audio.sampling_rate;
      console.debug(`[lumen] synthesised ${text.length} chars in ${ms(start)} (${seconds.toFixed(1)} s of audio)`);
      result = { id, audio: audio.audio, sampleRate: audio.sampling_rate };
    } catch (err) {
      result = { id, error: err instanceof Error ? err.message : String(err) };
    }
    self.postMessage(result, 'audio' in result ? [result.audio.buffer] : []);
  });
};

const ms = (since: number) => `${Math.round(performance.now() - since)} ms`;
