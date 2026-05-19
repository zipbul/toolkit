/**
 * Unit specs for `null-proto-obj.ts` — the hot-path bucket constructor
 * and the frozen sentinels reused by every match. Spec pins each of these
 * because their identity and prototype lookup behavior are load-bearing
 * for downstream IC stability.
 */
import { describe, expect, it } from 'bun:test';

import { MatchSource } from '../types';
import { CACHE_META, DYNAMIC_META, EMPTY_PARAMS, NullProtoObj, STATIC_META, createNullProtoBucket } from './null-proto-obj';

describe('NullProtoObj', () => {
  it('produces an object whose prototype chain does not include Object.prototype', () => {
    const obj = new NullProtoObj();
    expect(Object.getPrototypeOf(obj)).not.toBe(Object.prototype);
  });

  it('exposes no inherited keys (hasOwnProperty / toString / etc. are unreachable)', () => {
    const obj = new NullProtoObj() as Record<string, unknown>;
    expect((obj as unknown as { hasOwnProperty?: unknown }).hasOwnProperty).toBeUndefined();
    expect((obj as unknown as { toString?: unknown }).toString).toBeUndefined();
  });

  it('allows direct property assignment and reads', () => {
    const obj = new NullProtoObj();
    obj['foo'] = 1;
    expect(obj['foo']).toBe(1);
  });

  it('shares one stable hidden class across instances (prototype identity)', () => {
    const a = new NullProtoObj();
    const b = new NullProtoObj();
    expect(Object.getPrototypeOf(a)).toBe(Object.getPrototypeOf(b));
  });
});

describe('createNullProtoBucket', () => {
  it('returns a typed record with no inherited properties', () => {
    const bucket = createNullProtoBucket<number>();
    bucket['x'] = 42;
    expect(bucket['x']).toBe(42);
    expect(Object.getPrototypeOf(bucket)).not.toBe(Object.prototype);
  });
});

describe('frozen singletons', () => {
  it('EMPTY_PARAMS is frozen and inert', () => {
    expect(Object.isFrozen(EMPTY_PARAMS)).toBe(true);
    expect(() => {
      (EMPTY_PARAMS as Record<string, unknown>)['x'] = 1;
    }).toThrow();
  });

  it('STATIC_META has source: "static" and is frozen', () => {
    expect(STATIC_META.source).toBe(MatchSource.Static);
    expect(Object.isFrozen(STATIC_META)).toBe(true);
  });

  it('CACHE_META has source: "cache" and is frozen', () => {
    expect(CACHE_META.source).toBe(MatchSource.Cache);
    expect(Object.isFrozen(CACHE_META)).toBe(true);
  });

  it('DYNAMIC_META has source: "dynamic" and is frozen', () => {
    expect(DYNAMIC_META.source).toBe(MatchSource.Dynamic);
    expect(Object.isFrozen(DYNAMIC_META)).toBe(true);
  });

  it('singleton identity is stable across imports', () => {
    expect(STATIC_META).toBe(STATIC_META);
    expect(CACHE_META).toBe(CACHE_META);
    expect(DYNAMIC_META).toBe(DYNAMIC_META);
    expect(EMPTY_PARAMS).toBe(EMPTY_PARAMS);
  });
});
