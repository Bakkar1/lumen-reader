import type { TtsVoice } from '../engine';

export interface KokoroVoice {
  /** The kokoro-js voice id; also the name of its file under public/kokoro/voices/. */
  id: string;
  /** Shown in the voice pickers and stored in the settings. */
  voiceName: string;
  lang: string;
}

/**
 * The voices kokoro-js supports, best rated first (its VOICES table, overall
 * grade). Kept here rather than imported so the background and the UI do not
 * pull in the model runtime.
 */
const VOICES: [id: string, name: string][] = [
  ['af_heart', 'Heart'],
  ['af_bella', 'Bella'],
  ['af_nicole', 'Nicole'],
  ['bf_emma', 'Emma'],
  ['af_aoede', 'Aoede'],
  ['af_kore', 'Kore'],
  ['af_sarah', 'Sarah'],
  ['am_fenrir', 'Fenrir'],
  ['am_michael', 'Michael'],
  ['am_puck', 'Puck'],
  ['af_alloy', 'Alloy'],
  ['af_nova', 'Nova'],
  ['bf_isabella', 'Isabella'],
  ['bm_george', 'George'],
  ['bm_fable', 'Fable'],
  ['af_sky', 'Sky'],
  ['bm_lewis', 'Lewis'],
  ['af_jessica', 'Jessica'],
  ['af_river', 'River'],
  ['am_echo', 'Echo'],
  ['am_eric', 'Eric'],
  ['am_liam', 'Liam'],
  ['am_onyx', 'Onyx'],
  ['bf_alice', 'Alice'],
  ['bf_lily', 'Lily'],
  ['bm_daniel', 'Daniel'],
  ['am_santa', 'Santa'],
  ['am_adam', 'Adam'],
];

export const KOKORO_VOICES: readonly KokoroVoice[] = VOICES.map(([id, name]) => {
  const british = id.startsWith('b');
  return { id, voiceName: `Kokoro ${name} (${british ? 'UK' : 'US'})`, lang: british ? 'en-GB' : 'en-US' };
});

export const DEFAULT_KOKORO_VOICE = KOKORO_VOICES[0]!;

export const kokoroVoice = (voiceName: string | undefined): KokoroVoice =>
  KOKORO_VOICES.find((v) => v.voiceName === voiceName) ?? DEFAULT_KOKORO_VOICE;

export const kokoroTtsVoices = (): TtsVoice[] =>
  KOKORO_VOICES.map(({ voiceName, lang }) => ({ voiceName, lang, remote: false }));
