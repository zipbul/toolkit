import { MemoryStore } from '../src/stores/memory';
import type { RateLimiterStore, StoreEntry } from '../src/interfaces';

export function createClock(start = 0) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => { now += ms; },
    set: (ms: number) => { now = ms; },
  };
}

export function createAsyncStore(inner = new MemoryStore()): RateLimiterStore & { inner: MemoryStore } {
  return {
    inner,
    update: async (key: string, updater: (current: StoreEntry | null) => StoreEntry) => inner.update(key, updater),
    get: async (key: string) => inner.get(key),
    delete: async (key: string) => inner.delete(key),
    clear: async () => inner.clear(),
  };
}
