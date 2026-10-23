import type { HighlightApi } from '@/lib/highlight/renderer';
import type { PlaybackState } from '@/lib/messages';

/** happy-dom has no CSS Custom Highlight API; a Set-backed stand-in behaves the same. */
export function fakeHighlightApi() {
  const registry = new Map<string, Set<Range>>();
  const api: HighlightApi = {
    registry: { set: (n, h) => void registry.set(n, h as Set<Range>), delete: (n) => registry.delete(n) },
    create: () => new Set<Range>(),
  };
  const text = (name: string) => [...(registry.get(name) ?? [])].map((r) => r.toString()).join('|');
  return { api, registry, text };
}

export const playingState = (patch: Partial<PlaybackState> = {}): PlaybackState => ({
  status: 'playing',
  index: 0,
  total: 2,
  rate: 1,
  effectiveRate: 1,
  voiceName: 'v',
  voiceUnavailable: false,
  noWordTiming: false,
  ...patch,
});
