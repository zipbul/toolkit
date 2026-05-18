/**
 * Unit specs for `registration.ts` — the per-stage helpers used by
 * `Registration.compileDynamicRoute`. Pure projection / validation
 * helpers (collectRouteShape, checkDynamicRouteCaps) are exercised
 * here in isolation; orchestration is covered by the integration tests.
 */
import { describe, expect, it } from 'bun:test';

import type { PathPart } from '../tree';

import { MAX_OPTIONAL_SEGMENTS_PER_ROUTE } from '../builder';
import { checkDynamicRouteCaps, collectRouteShape } from './registration';

const STATIC_USERS: PathPart = { type: 'static', value: '/users', segments: ['users'] };
const PARAM_ID: PathPart = { type: 'param', name: 'id', pattern: null, optional: false };
const OPT_LANG: PathPart = { type: 'param', name: 'lang', pattern: null, optional: true };
const WILD_REST: PathPart = { type: 'wildcard', name: 'rest', origin: 'star' };

describe('collectRouteShape', () => {
  it('returns empty arrays and zero count for a fully static route', () => {
    const shape = collectRouteShape([STATIC_USERS]);
    expect(shape.originalNames).toEqual([]);
    expect(shape.originalTypes).toEqual([]);
    expect(shape.optionalCount).toBe(0);
  });

  it('captures param names + types and counts the required param as non-optional', () => {
    const shape = collectRouteShape([STATIC_USERS, PARAM_ID]);
    expect(shape.originalNames).toEqual(['id']);
    expect(shape.originalTypes).toEqual(['param']);
    expect(shape.optionalCount).toBe(0);
  });

  it('counts only the optional param toward `optionalCount`', () => {
    const shape = collectRouteShape([STATIC_USERS, OPT_LANG, PARAM_ID]);
    expect(shape.originalNames).toEqual(['lang', 'id']);
    expect(shape.optionalCount).toBe(1);
  });

  it('records wildcard segments alongside params with the right type tag', () => {
    const shape = collectRouteShape([STATIC_USERS, PARAM_ID, WILD_REST]);
    expect(shape.originalNames).toEqual(['id', 'rest']);
    expect(shape.originalTypes).toEqual(['param', 'wildcard']);
  });

  it('does not count wildcard segments as optional', () => {
    const shape = collectRouteShape([STATIC_USERS, WILD_REST]);
    expect(shape.optionalCount).toBe(0);
  });
});

describe('checkDynamicRouteCaps', () => {
  it('returns undefined for a route within both caps', () => {
    const shape = collectRouteShape([STATIC_USERS, PARAM_ID]);
    expect(checkDynamicRouteCaps({ path: '/users/:id' }, shape)).toBeUndefined();
  });

  it('rejects when optional segments exceed MAX_OPTIONAL_SEGMENTS_PER_ROUTE', () => {
    const shape = {
      originalNames: ['a', 'b', 'c', 'd', 'e'],
      originalTypes: ['param', 'param', 'param', 'param', 'param'] as const,
      optionalCount: MAX_OPTIONAL_SEGMENTS_PER_ROUTE + 1,
    };
    const out = checkDynamicRouteCaps({ path: '/x' }, shape);
    expect(out).toBeDefined();
    if (out) {
      expect(out.kind).toBe('route-parse');
      expect(out.message).toContain(String(shape.optionalCount));
      expect(out.message).toContain(String(MAX_OPTIONAL_SEGMENTS_PER_ROUTE));
    }
  });

  it('rejects when capturing-segment count exceeds the 31-bit presentBitmask ceiling', () => {
    const names = Array.from({ length: 32 }, (_, i) => `p${i}`);
    const shape = {
      originalNames: names,
      originalTypes: names.map(() => 'param' as const),
      optionalCount: 0,
    };
    const out = checkDynamicRouteCaps({ path: '/x' }, shape);
    expect(out).toBeDefined();
    if (out) {
      expect(out.kind).toBe('route-parse');
      expect(out.message).toContain('32');
      expect(out.message).toContain('31');
    }
  });

  it('accepts exactly 31 capturing segments at the boundary', () => {
    const names = Array.from({ length: 31 }, (_, i) => `p${i}`);
    const shape = {
      originalNames: names,
      originalTypes: names.map(() => 'param' as const),
      optionalCount: 0,
    };
    expect(checkDynamicRouteCaps({ path: '/x' }, shape)).toBeUndefined();
  });
});
