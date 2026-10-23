import type { FrameProbe, StartMode } from './messages';

export interface ProbedFrame {
  frameId: number;
  probe: FrameProbe;
}

/**
 * Picks the frame a start request goes to: the frame holding the selection
 * (the focused one first) when the mode reads selections, otherwise the frame
 * with the most readable text, so a page whose content sits in an iframe
 * (e.g. a SCORM course player) reads that content and not just the header.
 * Ties go to the lower frame id, so the top frame (0) wins. Null when no frame qualifies.
 */
export function pickFrame(frames: ProbedFrame[], mode: StartMode): number | null {
  if (mode !== 'page') {
    const selected = frames.filter((f) => f.probe.selection);
    const chosen = selected.find((f) => f.probe.focused) ?? selected[0];
    if (chosen) return chosen.frameId;
    if (mode === 'selection') return null;
  }
  let best: ProbedFrame | null = null;
  for (const f of frames) {
    if (!best || f.probe.chars > best.probe.chars || (f.probe.chars === best.probe.chars && f.frameId < best.frameId)) {
      best = f;
    }
  }
  return best?.frameId ?? null;
}
