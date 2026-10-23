import { useEffect, useState } from 'preact/hooks';

/** A minimal observable value shared by the content script and the Preact tree. */
export class Store<T extends object> {
  private listeners = new Set<() => void>();

  constructor(private value: T) {}

  get(): T {
    return this.value;
  }

  set(patch: Partial<T>): void {
    this.value = { ...this.value, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export function useStore<T extends object>(store: Store<T>): T {
  const value = store.get();
  const [, rerender] = useState(0);
  useEffect(() => {
    const unsubscribe = store.subscribe(() => rerender((n) => n + 1));
    // Effects run after render; catch a change made in between.
    if (store.get() !== value) rerender((n) => n + 1);
    return unsubscribe;
  }, [store]);
  return value;
}
