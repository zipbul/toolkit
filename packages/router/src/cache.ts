interface CacheEntry<T> {
  key: string;
  value: T | null;
  used: boolean;
}

/**
 * Round up to the next power of 2.
 * Enables bitwise AND masking instead of modulo.
 */
function nextPow2(n: number): number {
  if (n <= 1) {return 1;}

  let v = n - 1;

  v |= v >>> 1;
  v |= v >>> 2;
  v |= v >>> 4;
  v |= v >>> 8;
  v |= v >>> 16;

  return v + 1;
}

export class RouterCache<T> {
  private readonly entries: Array<CacheEntry<T> | undefined>;
  private readonly index: Map<string, number>;
  private readonly capacity: number;
  private readonly mask: number;
  private hand: number = 0;
  private count: number = 0;

  constructor(maxSize: number = 1000) {
    this.capacity = nextPow2(maxSize);
    this.mask = this.capacity - 1;
    this.entries = new Array(this.capacity);
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

    if (this.count < this.capacity) {
      slot = this.count++;
    } else {
      slot = this.evict();
    }

    // Reuse the evicted slot's entry object when possible — avoids one
    // allocation per eviction in the steady-state cache-pressure regime.
    const existingSlot = this.entries[slot];
    if (existingSlot !== undefined) {
      existingSlot.key = key;
      existingSlot.value = value;
      existingSlot.used = true;
    } else {
      this.entries[slot] = { key, value, used: true };
    }
    this.index.set(key, slot);
  }

  private evict(): number {
    while (true) {
      const entry = this.entries[this.hand];

      if (entry !== undefined) {
        if (!entry.used) {
          this.index.delete(entry.key);

          const slot = this.hand;

          this.hand = (this.hand + 1) & this.mask;

          return slot;
        }

        entry.used = false;
      }

      this.hand = (this.hand + 1) & this.mask;
    }
  }
}
