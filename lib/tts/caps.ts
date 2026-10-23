/**
 * Per-voice speed caps (design §3). Kokoro takes any speed, but a voice may
 * distort well below the UI maximum. Entries come from the
 * slice 1 listening tests (task 2.8); a voice without an entry is uncapped
 * within the UI range.
 *
 * `pattern` is matched against the voice name.
 */
export interface VoiceCap {
  pattern: RegExp;
  maxRate: number;
  note: string;
}

export const VOICE_CAPS: VoiceCap[] = [
  // Filled in by task 2.8.
];

/** The speed range offered in the UI (SPEC.md D-6). */
export const MIN_RATE = 0.5;
export const MAX_RATE = 3;
export const RATE_STEP = 0.1;
export const RATE_PRESETS = [0.8, 1, 1.2, 1.5, 2, 2.5, 3] as const;

export function voiceCap(voiceName: string | null | undefined, caps: VoiceCap[] = VOICE_CAPS): number {
  if (!voiceName) return MAX_RATE;
  return caps.find((c) => c.pattern.test(voiceName))?.maxRate ?? MAX_RATE;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/** Snaps a requested speed to the UI range and 0.1 steps. */
export function normaliseRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1;
  return round1(Math.min(MAX_RATE, Math.max(MIN_RATE, rate)));
}

/** The speed actually used for a voice: the requested speed, clamped by the voice's cap. */
export function effectiveRate(requested: number, voiceName: string | null | undefined, caps?: VoiceCap[]): number {
  return Math.min(normaliseRate(requested), voiceCap(voiceName, caps));
}
