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
    if (value === null) {
      return this.internPrimitive('null:');
    }
    const t = typeof value;
    if (t === 'object' || t === 'function') {
      const obj = value as object;
      const cached = this.objectIds.get(obj);
      if (cached !== undefined) {
        return cached;
      }
      const id = this.nextId++;
      this.objectIds.set(obj, id);
      return id;
    }
    if (t === 'undefined') {
      return this.internPrimitive('undef:');
    }
    if (t === 'string') {
      return this.internPrimitive('s:' + (value as string));
    }
    if (t === 'number') {
      return this.internPrimitive('n:' + String(value));
    }
    if (t === 'boolean') {
      return this.internPrimitive('b:' + String(value));
    }
    if (t === 'bigint') {
      return this.internPrimitive('i:' + (value as bigint).toString());
    }
    if (t === 'symbol') {
      return this.internPrimitive('y:' + (value as symbol).toString());
    }
    return this.internPrimitive('x:' + String(value));
  }

  private internPrimitive(key: string): number {
    const cached = this.primitiveIds.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const id = this.nextId++;
    this.primitiveIds.set(key, id);
    return id;
  }
}
