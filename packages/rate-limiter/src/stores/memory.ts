import type { RateLimiterStore, StoreEntry } from '../interfaces';

/**
 * In-memory store backed by a `Map`.
 * All operations are synchronous for atomic read-modify-write.
 */
export class MemoryStore implements RateLimiterStore {
  private readonly map: Map<string, StoreEntry>;

  constructor() {
    this.map = new Map();
  }

  update(key: string, updater: (current: StoreEntry | null) => StoreEntry): StoreEntry {
    const current = this.map.get(key) ?? null;
    const next = updater(current);
    this.map.set(key, next);
    return next;
  }

  get(key: string): StoreEntry | null {
    return this.map.get(key) ?? null;
  }

  clear(): void {
    this.map.clear();
  }
}
