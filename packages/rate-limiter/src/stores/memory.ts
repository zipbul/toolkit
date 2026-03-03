import type { RateLimiterStore, StoreEntry } from '../interfaces';

export interface MemoryStoreOptions {
  /** Maximum number of entries to keep. Oldest entries are evicted first (FIFO). */
  maxSize?: number;
  /** TTL in milliseconds for stored entries. Expired entries are lazily removed on access. */
  ttl?: number;
  /** Clock function for TTL checks. Defaults to `Date.now`. */
  clock?: () => number;
}

interface TimedEntry {
  entry: StoreEntry;
  createdAt: number;
}

/**
 * In-memory store backed by a `Map`.
 * All operations are synchronous for atomic read-modify-write.
 *
 * Supports optional `maxSize` (FIFO eviction) and `ttl` (lazy expiry) to
 * prevent unbounded memory growth in long-running processes.
 */
export class MemoryStore implements RateLimiterStore {
  private readonly map: Map<string, TimedEntry>;
  private readonly maxSize: number;
  private readonly ttl: number;
  private readonly clock: () => number;

  constructor(options?: MemoryStoreOptions) {
    this.map = new Map();
    this.maxSize = options?.maxSize ?? 0;
    this.ttl = options?.ttl ?? 0;
    this.clock = options?.clock ?? Date.now;
  }

  update(key: string, updater: (current: StoreEntry | null) => StoreEntry): StoreEntry {
    const current = this.getValid(key);
    const next = updater(current);
    const existing = this.map.get(key);
    // Preserve createdAt when entry exists and state is unchanged (deny path)
    const createdAt = existing !== undefined && next === current
      ? existing.createdAt
      : this.clock();
    this.map.set(key, { entry: next, createdAt });
    this.evictIfNeeded();
    return next;
  }

  get(key: string): StoreEntry | null {
    return this.getValid(key);
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  /** Number of entries currently stored. */
  get size(): number {
    return this.map.size;
  }

  private getValid(key: string): StoreEntry | null {
    const timed = this.map.get(key);
    if (timed === undefined) return null;

    if (this.ttl > 0 && this.clock() - timed.createdAt >= this.ttl) {
      this.map.delete(key);
      return null;
    }

    return timed.entry;
  }

  private evictIfNeeded(): void {
    if (this.maxSize <= 0) return;
    while (this.map.size > this.maxSize) {
      // Map iteration order is insertion order — first key is oldest
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }
}
