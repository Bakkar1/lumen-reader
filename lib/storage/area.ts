/**
 * The parts of chrome.storage the storage adapters need, so they can be
 * unit-tested against an in-memory area.
 */
export interface StorageAreaLike {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface StorageChangeLike {
  oldValue?: unknown;
  newValue?: unknown;
}

/** chrome.storage.onChanged. */
export interface StorageEventsLike {
  addListener(fn: (changes: Record<string, StorageChangeLike>, areaName: string) => void): void;
}
