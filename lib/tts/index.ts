import type { TtsEngine } from './engine';
import { KokoroTtsEngine } from './kokoro-engine';
import { FakeTtsEngine } from './fake-engine';

export * from './engine';

/** Speech is always Kokoro; the build flag (`LUMEN_FAKE_TTS`) picks the deterministic fake for E2E builds. */
export function createTtsEngine(): TtsEngine {
  return __LUMEN_FAKE_TTS__ ? new FakeTtsEngine({ defaultWordEvents: __LUMEN_FAKE_WORD_EVENTS__ }) : new KokoroTtsEngine();
}
