import type { RouterErrorData } from '../types';

import { err, isErr } from '@zipbul/result';
import type { Result } from '@zipbul/result';

/**
 * Build-scoped identity registry. Issues a stable numeric id for each
 * distinct route value within one build pass.
 *
 *  - non-null object/function values are interned via WeakMap so equal
 *    references yield the same id without preventing GC after build.
 *  - primitive values are interned via tagged keys in a Map, so semantically
 *    equal primitives (`1` and `1`, `'x'` and `'x'`) collapse onto one id.
 *
 * The registry is per-`seal()` and is discarded together with the rest of
 * the build-only state once the snapshot is published.
 */
export class IdentityRegistry {
  private readonly objectIds = new WeakMap<object, number>();
  private readonly primitiveIds = new Map<string, number>();
  private nextId = 0;

  idFor(value: unknown): number {
    if (value === null) return this.internPrimitive('null:');
    const t = typeof value;
    if (t === 'object' || t === 'function') {
      const obj = value as object;
      const cached = this.objectIds.get(obj);
      if (cached !== undefined) return cached;
      const id = this.nextId++;
      this.objectIds.set(obj, id);
      return id;
    }
    if (t === 'undefined') return this.internPrimitive('undef:');
    if (t === 'string') return this.internPrimitive('s:' + (value as string));
    if (t === 'number') return this.internPrimitive('n:' + String(value));
    if (t === 'boolean') return this.internPrimitive('b:' + String(value));
    if (t === 'bigint') return this.internPrimitive('i:' + (value as bigint).toString());
    if (t === 'symbol') return this.internPrimitive('y:' + (value as symbol).toString());
    return this.internPrimitive('x:' + String(value));
  }

  private internPrimitive(key: string): number {
    const cached = this.primitiveIds.get(key);
    if (cached !== undefined) return cached;
    const id = this.nextId++;
    this.primitiveIds.set(key, id);
    return id;
  }
}

/**
 * Stable, deterministic FNV-1a 32-bit hash of a canonicalised route-options
 * object. The `optionsKey` derived from this lets the prefix index treat
 * semantically equal options as identical for terminal-alias detection.
 */
export function optionsKeyOf(options: unknown): Result<string, RouterErrorData> {
  const serialised = deepStableSerialize(options, new WeakSet());
  if (isErr(serialised)) return serialised;
  return fnv1a32(serialised).toString(16);
}

function deepStableSerialize(value: unknown, seen: WeakSet<object>): Result<string, RouterErrorData> {
  if (value === null) return 'n';
  if (value === undefined) return 'u';
  const t = typeof value;
  if (t === 'string') return 's:' + JSON.stringify(value);
  if (t === 'number') return 'd:' + (Number.isFinite(value as number) ? String(value) : (Number.isNaN(value as number) ? 'NaN' : (value as number) > 0 ? '+Inf' : '-Inf'));
  if (t === 'boolean') return 'b:' + String(value);
  if (t === 'bigint') return 'i:' + (value as bigint).toString() + 'n';
  if (t === 'function' || t === 'symbol') {
    return err({
      kind: 'option-invalid',
      message: `route options contain unsupported value of type ${t}`,
      option: t,
    });
  }
  if (t === 'object') {
    const obj = value as object;
    if (seen.has(obj)) {
      return err({
        kind: 'option-invalid',
        message: 'route options contain a circular reference',
        option: 'options',
      });
    }
    seen.add(obj);
    if (obj instanceof RegExp) {
      seen.delete(obj);
      return 'r:' + JSON.stringify({ source: obj.source, flags: obj.flags });
    }
    if (Array.isArray(obj)) {
      const parts: string[] = [];
      for (const item of obj) {
        const ser = deepStableSerialize(item, seen);
        if (isErr(ser)) { seen.delete(obj); return ser; }
        parts.push(ser);
      }
      seen.delete(obj);
      return 'a:[' + parts.join(',') + ']';
    }
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const ser = deepStableSerialize((obj as Record<string, unknown>)[k], seen);
      if (isErr(ser)) { seen.delete(obj); return ser; }
      parts.push(JSON.stringify(k) + ':' + ser);
    }
    seen.delete(obj);
    return 'o:{' + parts.join(',') + '}';
  }
  return err({
    kind: 'option-invalid',
    message: `route options contain unsupported value of type ${t}`,
    option: t,
  });
}

function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}
