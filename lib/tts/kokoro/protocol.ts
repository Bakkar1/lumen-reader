import type { TtsEvent } from '../engine';

/**
 * Messages between KokoroTtsEngine (background) and the offscreen document
 * that runs the model and plays its audio. Both travel over
 * runtime.sendMessage, which every extension page receives, so each carries
 * the context it is meant for.
 */

export const OFFSCREEN_PATH = '/offscreen.html';

export type ToOffscreen = { target: 'lumen-offscreen' } & (
  | { type: 'speak'; id: number; text: string; voice: string; speed: number; enqueue: boolean }
  | { type: 'stop' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'isSpeaking' }
);

export interface FromOffscreen {
  target: 'lumen-background';
  type: 'event';
  id: number;
  event: TtsEvent;
}

/** The model worker: one synthesis request at a time. */
export interface SynthesisRequest {
  id: number;
  text: string;
  voice: string;
  speed: number;
}

export type SynthesisResult = { id: number; audio: Float32Array; sampleRate: number } | { id: number; error: string };

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

export const isToOffscreen = (x: unknown): x is ToOffscreen => isObject(x) && x.target === 'lumen-offscreen';

export const isFromOffscreen = (x: unknown): x is FromOffscreen =>
  isObject(x) && x.target === 'lumen-background' && x.type === 'event' && typeof x.id === 'number' && isObject(x.event);
