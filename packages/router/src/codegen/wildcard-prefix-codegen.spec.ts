/**
 * Unit spec for `wildcard-prefix-codegen.ts`. The compiled walker is a
 * single `new Function()` per qualifying root shape; the spec verifies
 * the walker correctly captures the wildcard tail and rejects the
 * disqualifiers (no slash, multi origin at exact prefix, >8 entries).
 */
import { describe, expect, it } from 'bun:test';

import { createMatchState } from '../matcher/match-state';
import { WildcardOrigin, createSegmentNode } from '../tree';
import { tryCodegenStaticPrefixWildcard } from './wildcard-prefix-codegen';

function rootWithPrefixes(entries: Array<{ prefix: string; origin: WildcardOrigin; store: number }>) {
  const root = createSegmentNode();
  root.staticChildren = Object.create(null) as Record<string, ReturnType<typeof createSegmentNode>>;
  for (const e of entries) {
    const child = createSegmentNode();
    child.wildcardStore = e.store;
    child.wildcardName = 'path';
    child.wildcardOrigin = e.origin;
    root.staticChildren[e.prefix] = child;
  }
  return root;
}

describe('tryCodegenStaticPrefixWildcard', () => {
  it('returns null when the root shape disqualifies (no staticChildren)', () => {
    const root = createSegmentNode();
    expect(tryCodegenStaticPrefixWildcard(root)).toBeNull();
  });

  it('returns null when more than 8 prefixes qualify (linear probe budget)', () => {
    const root = rootWithPrefixes(
      Array.from({ length: 9 }, (_, i) => ({ prefix: `p${i}`, origin: WildcardOrigin.Star as const, store: i })),
    );
    expect(tryCodegenStaticPrefixWildcard(root)).toBeNull();
  });

  it('returns a compiled walker for the qualifying shape', () => {
    const root = rootWithPrefixes([{ prefix: 'files', origin: WildcardOrigin.Star, store: 7 }]);
    const walker = tryCodegenStaticPrefixWildcard(root);
    expect(walker).not.toBeNull();
    expect(typeof walker).toBe('function');
    expect(walker!.name).toBe('compiledWildWalk');
  });

  it('captures the wildcard tail under /<prefix>/<tail>', () => {
    const root = rootWithPrefixes([{ prefix: 'files', origin: WildcardOrigin.Star, store: 7 }]);
    const walker = tryCodegenStaticPrefixWildcard(root)!;
    const state = createMatchState(2);
    expect(walker('/files/a/b/c.txt', state)).toBe(true);
    expect(state.handlerIndex).toBe(7);
    expect(state.paramCount).toBe(1);
    expect(state.paramOffsets[0]).toBe(7);
    expect(state.paramOffsets[1]).toBe('/files/a/b/c.txt'.length);
  });

  it('matches the bare /<prefix> path with an empty tail for star origin', () => {
    const root = rootWithPrefixes([{ prefix: 'files', origin: WildcardOrigin.Star, store: 7 }]);
    const walker = tryCodegenStaticPrefixWildcard(root)!;
    const state = createMatchState(2);
    expect(walker('/files', state)).toBe(true);
    expect(state.handlerIndex).toBe(7);
    expect(state.paramOffsets[0]).toBe(state.paramOffsets[1]);
  });

  it('rejects bare /<prefix> for multi origin (multi requires non-empty tail)', () => {
    const root = rootWithPrefixes([{ prefix: 'api', origin: WildcardOrigin.Multi, store: 3 }]);
    const walker = tryCodegenStaticPrefixWildcard(root)!;
    const state = createMatchState(2);
    expect(walker('/api', state)).toBe(false);
    expect(walker('/api/x', state)).toBe(true);
    expect(state.handlerIndex).toBe(3);
  });

  it('returns false for malformed paths missing the leading slash', () => {
    const root = rootWithPrefixes([{ prefix: 'files', origin: WildcardOrigin.Star, store: 7 }]);
    const walker = tryCodegenStaticPrefixWildcard(root)!;
    const state = createMatchState(2);
    expect(walker('files/a', state)).toBe(false);
  });

  it('returns false when no prefix matches', () => {
    const root = rootWithPrefixes([{ prefix: 'files', origin: WildcardOrigin.Star, store: 7 }]);
    const walker = tryCodegenStaticPrefixWildcard(root)!;
    const state = createMatchState(2);
    expect(walker('/other/x', state)).toBe(false);
  });

  it('dispatches to the right store across multiple prefixes', () => {
    const root = rootWithPrefixes([
      { prefix: 'static', origin: WildcardOrigin.Star, store: 1 },
      { prefix: 'files', origin: WildcardOrigin.Star, store: 2 },
    ]);
    const walker = tryCodegenStaticPrefixWildcard(root)!;
    const stateA = createMatchState(2);
    expect(walker('/static/a.js', stateA)).toBe(true);
    expect(stateA.handlerIndex).toBe(1);
    const stateB = createMatchState(2);
    expect(walker('/files/b.png', stateB)).toBe(true);
    expect(stateB.handlerIndex).toBe(2);
  });
});
