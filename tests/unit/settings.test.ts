import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, SettingsSync, type Settings } from '@/lib/storage/settings';
import { MemoryArea, flush } from './helpers/storage';

/** Two contexts (e.g. the background and a tab) sharing one synced area. */
function twoContexts() {
  const area = new MemoryArea('sync');
  const a = new SettingsSync(area, area.events);
  const b = new SettingsSync(area, area.events);
  return { area, a, b };
}

describe('SettingsSync', () => {
  it('loads the defaults from an empty area', async () => {
    const { a } = twoContexts();
    expect(await a.load()).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips every setting through the storage area', async () => {
    const { area, a } = twoContexts();
    const wanted: Settings = { voiceName: 'Lumen Test Voice', rate: 1.5, theme: 'dark', playerY: 240 };
    await a.save(wanted);
    const fresh = new SettingsSync(area, area.events);
    expect(await fresh.load()).toEqual(wanted);
  });

  it('ignores invalid stored values and keeps the defaults for them', async () => {
    const { area, a } = twoContexts();
    area.data = {
      'lumen:setting:voiceName': 42,
      'lumen:setting:rate': 'fast',
      'lumen:setting:theme': 'neon',
      'lumen:setting:playerY': -5,
    };
    expect(await a.load()).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps and rounds a stored rate into the supported range', async () => {
    const { area, a } = twoContexts();
    area.data = { 'lumen:setting:rate': 9 };
    expect((await a.load()).rate).toBe(3);
  });

  it('writes only the keys that changed', async () => {
    const { area, a } = twoContexts();
    await a.load();
    const set = vi.spyOn(area, 'set');
    await a.save({ rate: 1, theme: 'light' });
    expect(set).toHaveBeenCalledWith({ 'lumen:setting:theme': 'light' });
    set.mockClear();
    await a.save({ theme: 'light' });
    expect(set).not.toHaveBeenCalled();
  });

  it('reports a change made by another context, live', async () => {
    const { a, b } = twoContexts();
    await Promise.all([a.load(), b.load()]);
    const seen: Partial<Settings>[] = [];
    b.onChange((patch) => seen.push(patch));
    await a.save({ rate: 1.5 });
    await flush();
    expect(seen).toEqual([{ rate: 1.5 }]);
    expect(b.get().rate).toBe(1.5);
  });

  it('does not report its own writes back, even when several are in flight', async () => {
    const { a } = twoContexts();
    await a.load();
    const seen: Partial<Settings>[] = [];
    a.onChange((patch) => seen.push(patch));
    await a.save({ rate: 1.1 });
    await a.save({ rate: 1.2 });
    await a.save({ rate: 1.1 });
    await flush();
    expect(seen).toEqual([]);
    expect(a.get().rate).toBe(1.1);
  });

  it('reports a change from another machine that arrives between its own writes', async () => {
    const { area, a } = twoContexts();
    await a.load();
    const seen: Partial<Settings>[] = [];
    a.onChange((patch) => seen.push(patch));
    await a.save({ rate: 1.2 });
    await area.externalSet({ 'lumen:setting:theme': 'dark' });
    await flush();
    expect(seen).toEqual([{ theme: 'dark' }]);
  });

  it('treats a removed key as a reset to its default', async () => {
    const { area, a, b } = twoContexts();
    await a.save({ voiceName: 'X' });
    await b.load();
    const seen: Partial<Settings>[] = [];
    b.onChange((patch) => seen.push(patch));
    await area.remove('lumen:setting:voiceName');
    await flush();
    expect(seen).toEqual([{ voiceName: null }]);
  });

  it('ignores changes in other storage areas and to unrelated keys', async () => {
    const sync = new MemoryArea('sync');
    const local = new MemoryArea('local');
    const listeners: Parameters<typeof sync.events.addListener>[0][] = [];
    const events = { addListener: (fn: (typeof listeners)[number]) => void listeners.push(fn) };
    sync.events.addListener((c, n) => listeners.forEach((fn) => fn(c, n)));
    local.events.addListener((c, n) => listeners.forEach((fn) => fn(c, n)));
    const s = new SettingsSync(sync, events);
    await s.load();
    const seen: Partial<Settings>[] = [];
    s.onChange((patch) => seen.push(patch));
    await local.set({ 'lumen:setting:rate': 2 });
    await sync.set({ unrelated: 1 });
    await flush();
    expect(seen).toEqual([]);
  });
});
