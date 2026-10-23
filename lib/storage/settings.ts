import { normaliseRate } from '../tts/caps';
import type { StorageAreaLike, StorageEventsLike } from './area';

export type Theme = 'system' | 'light' | 'dark';
export const THEMES: readonly Theme[] = ['system', 'light', 'dark'];

/** The user's preferences, kept in chrome.storage.sync (design §9, D12). */
export interface Settings {
  /** The chosen voice; null = a default for the page language. */
  voiceName: string | null;
  rate: number;
  theme: Theme;
  /** The player's top edge in px; null = vertically centred. */
  playerY: number | null;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = { voiceName: null, rate: 1, theme: 'system', playerY: null };

type Key = keyof Settings;
const KEYS = Object.keys(DEFAULT_SETTINGS) as Key[];
const PREFIX = 'lumen:setting:';
const storageKey = (key: Key) => PREFIX + key;

/** Validates a stored value; undefined means "not valid, use the default". */
const PARSERS: { [K in Key]: (x: unknown) => Settings[K] | undefined } = {
  voiceName: (x) => (x === null || typeof x === 'string' ? x : undefined),
  rate: (x) => (typeof x === 'number' && Number.isFinite(x) ? normaliseRate(x) : undefined),
  theme: (x) => (THEMES.includes(x as Theme) ? (x as Theme) : undefined),
  playerY: (x) => (x === null || (typeof x === 'number' && Number.isFinite(x) && x >= 0) ? x : undefined),
};

function parse<K extends Key>(key: K, value: unknown): Settings[K] {
  return PARSERS[key](value) ?? DEFAULT_SETTINGS[key];
}

/**
 * Settings shared by the background, every tab and the popup. Each context
 * owns one instance: it writes the settings that context changes and hears
 * about the ones changed elsewhere (another tab, the popup, another machine),
 * so a change applies everywhere without a reload.
 *
 * One key per setting, so concurrent writes of different settings from
 * different contexts never overwrite each other.
 */
export class SettingsSync {
  private known: Settings = { ...DEFAULT_SETTINGS };
  /** Values this instance wrote whose onChanged echo has not arrived yet, oldest first. */
  private pending = new Map<Key, unknown[]>();
  private listeners = new Set<(patch: Partial<Settings>) => void>();

  constructor(
    private area: StorageAreaLike,
    events: StorageEventsLike,
    private areaName = 'sync',
  ) {
    events.addListener((changes, name) => {
      if (name !== this.areaName) return;
      const patch: Partial<Settings> = {};
      for (const key of KEYS) {
        const change = changes[storageKey(key)];
        if (!change) continue;
        const value = parse(key, change.newValue);
        if (this.consumeEcho(key, value)) continue;
        this.known = { ...this.known, [key]: value };
        Object.assign(patch, { [key]: value });
      }
      if (Object.keys(patch).length) this.listeners.forEach((fn) => fn(patch));
    });
  }

  async load(): Promise<Settings> {
    const data = await this.area.get(KEYS.map(storageKey));
    const loaded = Object.fromEntries(KEYS.map((key) => [key, parse(key, data[storageKey(key)])])) as unknown as Settings;
    this.known = loaded;
    return { ...loaded };
  }

  get(): Settings {
    return { ...this.known };
  }

  /** Writes the settings in `patch` that differ from the known values. */
  async save(patch: Partial<Settings>): Promise<void> {
    const items: Record<string, unknown> = {};
    for (const key of KEYS) {
      if (!(key in patch)) continue;
      const value = parse(key, patch[key]);
      if (value === this.known[key]) continue;
      this.known = { ...this.known, [key]: value };
      this.pending.set(key, [...(this.pending.get(key) ?? []), value]);
      items[storageKey(key)] = value;
    }
    if (Object.keys(items).length) await this.area.set(items);
  }

  /** Subscribes to changes made by other contexts. */
  onChange(fn: (patch: Partial<Settings>) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** onChanged events arrive in write order, so our own echo is the next pending value. */
  private consumeEcho(key: Key, value: unknown): boolean {
    const queue = this.pending.get(key);
    const i = queue?.indexOf(value) ?? -1;
    if (i === -1) return false;
    queue!.splice(0, i + 1);
    return true;
  }
}
