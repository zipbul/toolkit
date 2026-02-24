interface CacheEntry<T> {
  key: string;
  value: T | null;
  used: boolean;
}

export class RouterCache<T> {
  private readonly entries: Array<CacheEntry<T> | undefined>;
  private readonly index: Map<string, number>;
  private readonly maxSize: number;
  private hand: number = 0;
  private count: number = 0;

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;
    this.entries = new Array(maxSize);
    this.index = new Map();
  }

  get(key: string): T | null | undefined {
    const idx = this.index.get(key);

    if (idx === undefined) {
      return undefined;
    }

    const entry = this.entries[idx];

    if (entry === undefined) {
      return undefined;
    }

    entry.used = true;

    return entry.value;
  }

  set(key: string, value: T | null): void {
    const existing = this.index.get(key);

    if (existing !== undefined) {
      const entry = this.entries[existing];

      if (entry !== undefined) {
        entry.value = value;
        entry.used = true;
      }

      return;
    }

    let slot: number;

    if (this.count < this.maxSize) {
      slot = this.count++;
    } else {
      // Clock-sweep eviction
      slot = this.evict();
    }

    this.entries[slot] = { key, value, used: true };
    this.index.set(key, slot);
  }

  clear(): void {
    this.entries.fill(undefined);
    this.index.clear();
    this.hand = 0;
    this.count = 0;
  }

  private evict(): number {
    while (true) {
      const entry = this.entries[this.hand];

      if (entry !== undefined) {
        if (!entry.used) {
          this.index.delete(entry.key);

          const slot = this.hand;

          this.hand = (this.hand + 1) % this.maxSize;

          return slot;
        }

        entry.used = false;
      }

      this.hand = (this.hand + 1) % this.maxSize;
    }
  }
}
