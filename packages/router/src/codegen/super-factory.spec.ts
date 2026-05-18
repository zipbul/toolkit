/**
 * Unit specs for `super-factory.ts` — the per-shape params factory cache
 * + the present-bitmask projection. Both are pure; the factory cache
 * collapses 2^N variant closures into one compiled function so its
 * correctness is load-bearing for memory savings.
 */
import { describe, expect, it } from 'bun:test';

import { computePresentBitmask, createFactoryCache, getOrCreateSuperFactory } from './super-factory';

const identityDecoder = (s: string) => s;

function offsetsFromCaptures(captures: Array<readonly [number, number]>): Int32Array {
  const v = new Int32Array(captures.length * 2);
  for (let i = 0; i < captures.length; i++) {
    v[i * 2] = captures[i]![0];
    v[i * 2 + 1] = captures[i]![1];
  }
  return v;
}

describe('createFactoryCache', () => {
  it('returns a fresh empty Map', () => {
    const cache = createFactoryCache();
    expect(cache.size).toBe(0);
  });
});

describe('getOrCreateSuperFactory', () => {
  it('produces a factory that assigns each present name to the decoded slice', () => {
    const cache = createFactoryCache();
    const fn = getOrCreateSuperFactory(cache, ['id', 'kind'], ['param', 'param'], true, identityDecoder);
    const url = '/users/42/admin';
    const v = offsetsFromCaptures([
      [7, 9],
      [10, 15],
    ]);
    const params = fn(0b11, url, v);
    expect(params.id).toBe('42');
    expect(params.kind).toBe('admin');
  });

  it('skips absent names entirely when omitBehavior=true', () => {
    const cache = createFactoryCache();
    const fn = getOrCreateSuperFactory(cache, ['id', 'tail'], ['param', 'param'], true, identityDecoder);
    const url = '/users/42';
    const v = offsetsFromCaptures([[7, 9]]);
    const params = fn(0b01, url, v);
    expect(params.id).toBe('42');
    expect('tail' in params).toBe(false);
  });

  it('writes undefined for absent names when omitBehavior=false', () => {
    const cache = createFactoryCache();
    const fn = getOrCreateSuperFactory(cache, ['id', 'tail'], ['param', 'param'], false, identityDecoder);
    const url = '/users/42';
    const v = offsetsFromCaptures([[7, 9]]);
    const params = fn(0b01, url, v);
    expect(params.id).toBe('42');
    expect('tail' in params).toBe(true);
    expect(params.tail).toBeUndefined();
  });

  it('does NOT decode wildcard slices (origin: wildcard skips decoder)', () => {
    const cache = createFactoryCache();
    const fn = getOrCreateSuperFactory(cache, ['rest'], ['wildcard'], true, () => 'should-not-be-called');
    const url = '/files/raw%20tail';
    const v = offsetsFromCaptures([[7, 17]]);
    const params = fn(0b1, url, v);
    expect(params.rest).toBe('raw%20tail');
  });

  it('returns the cached factory on a second call with the same shape', () => {
    const cache = createFactoryCache();
    const a = getOrCreateSuperFactory(cache, ['id'], ['param'], true, identityDecoder);
    const b = getOrCreateSuperFactory(cache, ['id'], ['param'], true, identityDecoder);
    expect(a).toBe(b);
    expect(cache.size).toBe(1);
  });

  it('caches separately for omit vs set-undefined behavior', () => {
    const cache = createFactoryCache();
    const omit = getOrCreateSuperFactory(cache, ['id'], ['param'], true, identityDecoder);
    const setUndef = getOrCreateSuperFactory(cache, ['id'], ['param'], false, identityDecoder);
    expect(omit).not.toBe(setUndef);
    expect(cache.size).toBe(2);
  });

  it('caches separately for param vs wildcard at the same name', () => {
    const cache = createFactoryCache();
    const asParam = getOrCreateSuperFactory(cache, ['x'], ['param'], true, identityDecoder);
    const asWild = getOrCreateSuperFactory(cache, ['x'], ['wildcard'], true, identityDecoder);
    expect(asParam).not.toBe(asWild);
    expect(cache.size).toBe(2);
  });
});

describe('computePresentBitmask', () => {
  it('returns 0 when no names are present', () => {
    expect(computePresentBitmask(['a', 'b', 'c'], [])).toBe(0);
  });

  it('sets the bit at the matching originalNames index for each present entry', () => {
    expect(computePresentBitmask(['a', 'b', 'c'], [{ name: 'a' }])).toBe(0b001);
    expect(computePresentBitmask(['a', 'b', 'c'], [{ name: 'b' }])).toBe(0b010);
    expect(computePresentBitmask(['a', 'b', 'c'], [{ name: 'c' }])).toBe(0b100);
  });

  it('combines bits for multiple present entries (order in present[] does not matter)', () => {
    expect(computePresentBitmask(['a', 'b', 'c'], [{ name: 'a' }, { name: 'c' }])).toBe(0b101);
    expect(computePresentBitmask(['a', 'b', 'c'], [{ name: 'c' }, { name: 'a' }])).toBe(0b101);
  });

  it('ignores present names that are not in originalNames', () => {
    expect(computePresentBitmask(['a'], [{ name: 'b' }])).toBe(0);
  });
});
