export class RouterCache<T> {
  private map: Map<string, T | null>;
  private readonly maxSize: number;

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;
    this.map = new Map();
  }

  get(key: string): T | null | undefined {
    const value = this.map.get(key);

    if (value !== undefined) {
      this.map.delete(key);
      this.map.set(key, value);
    }

    return value;
  }

  set(key: string, value: T | null): void {
    if (this.map.size >= this.maxSize) {
      const first = this.map.keys().next().value;

      if (first !== undefined) {
        this.map.delete(first);
      }
    }

    this.map.set(key, value);
  }

  clear(): void {
    this.map.clear();
  }
}
