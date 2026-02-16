import type { Node } from './node';
import type { SortedChildArrays, StaticChildEntry, StaticChildEntryFingerprint } from './types';

import { INLINE_THRESHOLD, FNV_OFFSET, FNV_PRIME } from './constants';

function fingerprintSegment(segment: string): number {
  let hash = FNV_OFFSET;

  for (let i = 0; i < segment.length; i++) {
    hash ^= segment.charCodeAt(i);

    hash = Math.imul(hash, FNV_PRIME);
  }

  return hash >>> 0;
}

function compareFingerprintAndSegment(fpA: number, segA: string, fpB: number, segB: string): number {
  if (fpA !== fpB) {
    return fpA - fpB;
  }

  if (segA === segB) {
    return 0;
  }

  return segA < segB ? -1 : 1;
}

export class StaticChildMap implements Iterable<StaticChildEntry> {
  private inlineKeys: string[] | null = null;
  private inlineValues: Node[] | null = null;
  private inlineCount = 0;
  private sorted: SortedChildArrays | undefined;

  static fromEntries(entries: Iterable<StaticChildEntry>): StaticChildMap {
    const store = new StaticChildMap();

    for (const [segment, node] of entries) {
      store.set(segment, node);
    }

    return store;
  }

  get size(): number {
    if (this.sorted) {
      return this.sorted.segments.length;
    }

    return this.inlineCount;
  }

  get(segment: string): Node | undefined {
    if (this.sorted) {
      return this.getFromSorted(segment);
    }

    if (!this.inlineKeys || !this.inlineValues) {
      return undefined;
    }

    for (let i = 0; i < this.inlineCount; i++) {
      if (this.inlineKeys[i] === segment) {
        return this.inlineValues[i];
      }
    }

    return undefined;
  }

  set(segment: string, node: Node): this {
    if (this.sorted) {
      this.setInSorted(segment, node);

      return this;
    }

    if (!this.inlineKeys || !this.inlineValues) {
      this.inlineKeys = [];
      this.inlineValues = [];
    }

    for (let i = 0; i < this.inlineCount; i++) {
      if (this.inlineKeys[i] === segment) {
        this.inlineValues[i] = node;

        return this;
      }
    }

    this.inlineKeys.push(segment);
    this.inlineValues.push(node);

    this.inlineCount++;

    if (this.inlineCount > INLINE_THRESHOLD) {
      this.promote();
    }

    return this;
  }

  clear(): void {
    if (this.sorted) {
      this.sorted.segments.length = 0;
      this.sorted.nodes.length = 0;
      this.sorted.fingerprints.length = 0;
    } else if (this.inlineKeys && this.inlineValues) {
      this.inlineKeys.length = 0;
      this.inlineValues.length = 0;
    }

    this.inlineCount = 0;
    this.sorted = undefined;
  }

  values(): IterableIterator<Node> {
    if (this.sorted) {
      return this.iterateSortedValues();
    }

    return this.iterateInlineValues();
  }

  keys(): IterableIterator<string> {
    if (this.sorted) {
      return this.iterateSortedKeys();
    }

    return this.iterateInlineKeys();
  }

  entries(): IterableIterator<StaticChildEntry> {
    if (this.sorted) {
      return this.iterateSortedEntries();
    }

    return this.iterateInlineEntries();
  }

  [Symbol.iterator](): IterableIterator<StaticChildEntry> {
    return this.entries();
  }

  private promote(): void {
    const keys = this.inlineKeys;
    const values = this.inlineValues;

    if (this.sorted || keys === undefined || keys === null || values === undefined || values === null) {
      return;
    }

    const entries: StaticChildEntryFingerprint[] = [];

    for (let i = 0; i < this.inlineCount; i++) {
      const segment = keys[i];
      const node = values[i];

      if (segment === undefined || node === undefined) {
        continue;
      }

      entries.push({
        segment,
        node,
        fingerprint: fingerprintSegment(segment),
      });
    }

    entries.sort((a, b) => compareFingerprintAndSegment(a.fingerprint, a.segment, b.fingerprint, b.segment));

    const segments = new Array<string>(entries.length);
    const nodes = new Array<Node>(entries.length);
    const fingerprints = new Array<number>(entries.length);

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];

      if (entry === undefined) {
        continue;
      }

      segments[i] = entry.segment;
      nodes[i] = entry.node;
      fingerprints[i] = entry.fingerprint;
    }

    this.sorted = { segments, nodes, fingerprints };
    this.inlineKeys = null;
    this.inlineValues = null;
  }

  private setInSorted(segment: string, node: Node): void {
    const arrays = this.sorted;

    if (!arrays) {
      return;
    }

    const fp = fingerprintSegment(segment);
    const index = this.findSortedIndex(segment, fp);

    if (index >= 0) {
      arrays.nodes[index] = node;
      arrays.segments[index] = segment;
      arrays.fingerprints[index] = fp;

      return;
    }

    const insertAt = ~index;

    arrays.segments.splice(insertAt, 0, segment);
    arrays.nodes.splice(insertAt, 0, node);
    arrays.fingerprints.splice(insertAt, 0, fp);
  }

  private getFromSorted(segment: string): Node | undefined {
    const arrays = this.sorted;

    if (!arrays) {
      return undefined;
    }

    const index = this.findSortedIndex(segment, fingerprintSegment(segment));

    if (index >= 0) {
      return arrays.nodes[index];
    }

    return undefined;
  }

  private findSortedIndex(segment: string, fp: number): number {
    const arrays = this.sorted;

    if (!arrays) {
      return -1;
    }

    let low = 0;
    let high = arrays.segments.length - 1;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      const fingerprint = arrays.fingerprints[mid];
      const currentSegment = arrays.segments[mid];

      if (fingerprint === undefined || currentSegment === undefined) {
        return ~low;
      }

      const cmp = compareFingerprintAndSegment(fp, segment, fingerprint, currentSegment);

      if (cmp === 0) {
        return mid;
      }

      if (cmp < 0) {
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    return ~low;
  }

  private *iterateInlineEntries(): IterableIterator<StaticChildEntry> {
    if (!this.inlineKeys || !this.inlineValues) {
      return;
    }

    for (let i = 0; i < this.inlineCount; i++) {
      const key = this.inlineKeys[i];
      const value = this.inlineValues[i];

      if (key !== undefined && value !== undefined) {
        yield [key, value];
      }
    }
  }
  private *iterateInlineKeys(): IterableIterator<string> {
    if (!this.inlineKeys) {
      return;
    }

    for (let i = 0; i < this.inlineCount; i++) {
      const key = this.inlineKeys[i];

      if (key !== undefined) {
        yield key;
      }
    }
  }
  private *iterateInlineValues(): IterableIterator<Node> {
    if (!this.inlineValues) {
      return;
    }

    for (let i = 0; i < this.inlineCount; i++) {
      const value = this.inlineValues[i];

      if (value !== undefined) {
        yield value;
      }
    }
  }
  private *iterateSortedEntries(): IterableIterator<StaticChildEntry> {
    const arrays = this.sorted;

    if (!arrays) {
      return;
    }

    for (let i = 0; i < arrays.segments.length; i++) {
      const key = arrays.segments[i];
      const value = arrays.nodes[i];

      if (key !== undefined && value !== undefined) {
        yield [key, value];
      }
    }
  }
  private *iterateSortedKeys(): IterableIterator<string> {
    const arrays = this.sorted;

    if (!arrays) {
      return;
    }

    for (let i = 0; i < arrays.segments.length; i++) {
      const key = arrays.segments[i];

      if (key !== undefined) {
        yield key;
      }
    }
  }
  private *iterateSortedValues(): IterableIterator<Node> {
    const arrays = this.sorted;

    if (!arrays) {
      return;
    }

    for (let i = 0; i < arrays.nodes.length; i++) {
      const value = arrays.nodes[i];

      if (value !== undefined) {
        yield value;
      }
    }
  }
}
