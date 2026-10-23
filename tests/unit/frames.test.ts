import { describe, expect, it } from 'vitest';
import { pickFrame, type ProbedFrame } from '@/lib/frames';

const frame = (frameId: number, chars: number, selection = false, focused = false): ProbedFrame => ({
  frameId,
  probe: { chars, selection, focused },
});

describe('pickFrame', () => {
  it('reads the frame with the most text, e.g. a course inside an iframe', () => {
    expect(pickFrame([frame(0, 80), frame(3, 4000), frame(5, 300)], 'page')).toBe(3);
    expect(pickFrame([frame(0, 80), frame(3, 4000)], 'auto')).toBe(3);
  });

  it('prefers the top frame on a tie', () => {
    expect(pickFrame([frame(4, 500), frame(0, 500)], 'page')).toBe(0);
  });

  it('reads a selection in its frame, the focused one first', () => {
    const frames = [frame(0, 4000, true), frame(3, 100, true, true)];
    expect(pickFrame(frames, 'auto')).toBe(3);
    expect(pickFrame(frames, 'selection')).toBe(3);
    expect(pickFrame([frame(0, 4000), frame(3, 100, true)], 'toggle')).toBe(3);
  });

  it('ignores selections when reading the page', () => {
    expect(pickFrame([frame(0, 4000), frame(3, 100, true, true)], 'page')).toBe(0);
  });

  it('returns null when nothing qualifies', () => {
    expect(pickFrame([frame(0, 4000)], 'selection')).toBeNull();
    expect(pickFrame([], 'page')).toBeNull();
  });
});
