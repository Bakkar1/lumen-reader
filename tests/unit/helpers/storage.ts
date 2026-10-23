import type { StorageAreaLike, StorageChangeLike, StorageEventsLike } from '@/lib/storage/area';

type Listener = (changes: Record<string, StorageChangeLike>, areaName: string) => void;

/**
 * An in-memory chrome.storage area with chrome's change semantics: onChanged
 * fires asynchronously, only for keys whose value actually changed.
 */
export class MemoryArea implements StorageAreaLike {
  data: Record<string, unknown> = {};
  private listeners = new Set<Listener>();

  constructor(readonly areaName = 'sync') {}

  readonly events: StorageEventsLike = {
    addListener: (fn) => void this.listeners.add(fn),
  };

  async get(keys?: string | string[] | null): Promise<Record<string, unknown>> {
    if (keys === null || keys === undefined) return structuredClone(this.data);
    const list = typeof keys === 'string' ? [keys] : keys;
    return Object.fromEntries(list.filter((k) => k in this.data).map((k) => [k, structuredClone(this.data[k])]));
  }

  async set(items: Record<string, unknown>): Promise<void> {
    const changes: Record<string, StorageChangeLike> = {};
    for (const [k, v] of Object.entries(items)) {
      if (JSON.stringify(this.data[k]) === JSON.stringify(v)) continue;
      changes[k] = { oldValue: this.data[k], newValue: structuredClone(v) };
      this.data[k] = structuredClone(v);
    }
    this.emit(changes);
  }

  async remove(keys: string | string[]): Promise<void> {
    const changes: Record<string, StorageChangeLike> = {};
    for (const k of typeof keys === 'string' ? [keys] : keys) {
      if (!(k in this.data)) continue;
      changes[k] = { oldValue: this.data[k] };
      delete this.data[k];
    }
    this.emit(changes);
  }

  /** Simulates a write from another context or another machine. */
  externalSet(items: Record<string, unknown>): Promise<void> {
    return this.set(items);
  }

  private emit(changes: Record<string, StorageChangeLike>): void {
    if (Object.keys(changes).length === 0) return;
    queueMicrotask(() => this.listeners.forEach((fn) => fn(changes, this.areaName)));
  }
}

/** Lets queued onChanged events run. */
export const flush = () => new Promise((r) => setTimeout(r, 0));
