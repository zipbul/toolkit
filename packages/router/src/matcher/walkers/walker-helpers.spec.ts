/**
 * Direct unit specs for the small per-walker helpers extracted during
 * the walker decomposition. Each helper is pure (no closure state) and
 * can be exercised with raw arrays / SegmentNode literals.
 */
import { describe, expect, it } from 'bun:test';

import { consumeStaticPrefix, matchTerminalAtNode } from './iterative';
import { consumeStaticPrefixRec, tryWildcardCapture } from './recursive';
import { consumeFixedPrefix, scanSegmentEnd } from './prefix-factor';
import { walkSharedSubtree } from './factored';
import type { SegmentNode } from '../../tree';
import { createMatchState } from '../match-state';

const STORE: SegmentNode = {
  store: 7,
  staticChildren: null,
  singleChildKey: null,
  singleChildNext: null,
  paramChild: null,
  wildcardStore: null,
  wildcardName: null,
  wildcardOrigin: null,
  staticPrefix: null,
};

const STAR_WILDCARD: SegmentNode = {
  store: null,
  staticChildren: null,
  singleChildKey: null,
  singleChildNext: null,
  paramChild: null,
  wildcardStore: 9,
  wildcardName: 'rest',
  wildcardOrigin: 'star',
  staticPrefix: null,
};

const MULTI_WILDCARD: SegmentNode = { ...STAR_WILDCARD, wildcardOrigin: 'multi', wildcardStore: 11 };

describe('consumeStaticPrefix (iterative)', () => {
  it('advances `pos` past every matched segment', () => {
    expect(consumeStaticPrefix(['a', 'b'], '/a/b/x', 1, 6)).toBe(5);
  });

  it('returns -1 when a segment exceeds the remaining URL length', () => {
    expect(consumeStaticPrefix(['users'], '/u', 1, 2)).toBe(-1);
  });

  it('returns -1 when a literal segment fails to match', () => {
    expect(consumeStaticPrefix(['users'], '/admin/x', 1, 8)).toBe(-1);
  });

  it('returns -1 when the next char after a segment is not `/`', () => {
    expect(consumeStaticPrefix(['user'], '/userid', 1, 7)).toBe(-1);
  });

  it('returns the URL length when the prefix consumes the tail exactly', () => {
    expect(consumeStaticPrefix(['x'], '/x', 1, 2)).toBe(2);
  });
});

describe('matchTerminalAtNode (iterative)', () => {
  it('returns true for a store-bearing node and writes the handler index', () => {
    const state = createMatchState(2);
    expect(matchTerminalAtNode(STORE, 5, state)).toBe(true);
    expect(state.handlerIndex).toBe(7);
  });

  it('returns true for a star-wildcard node and captures an empty tail', () => {
    const state = createMatchState(2);
    expect(matchTerminalAtNode(STAR_WILDCARD, 4, state)).toBe(true);
    expect(state.handlerIndex).toBe(9);
    expect(state.paramOffsets[0]).toBe(4);
    expect(state.paramOffsets[1]).toBe(4);
    expect(state.paramCount).toBe(1);
  });

  it('returns false for a multi-wildcard at end of URL (multi requires non-empty tail)', () => {
    const state = createMatchState(2);
    expect(matchTerminalAtNode(MULTI_WILDCARD, 4, state)).toBe(false);
  });

  it('returns false for an empty leaf', () => {
    const state = createMatchState(2);
    const empty: SegmentNode = { ...STORE, store: null };
    expect(matchTerminalAtNode(empty, 1, state)).toBe(false);
  });
});

describe('consumeStaticPrefixRec (recursive)', () => {
  it('mirrors consumeStaticPrefix behavior — recursive walker uses the same shape', () => {
    expect(consumeStaticPrefixRec(['a'], '/a', 1, 2)).toBe(2);
    expect(consumeStaticPrefixRec(['a'], '/b', 1, 2)).toBe(-1);
  });
});

describe('tryWildcardCapture (recursive)', () => {
  it('writes the wildcard offsets and returns true for a star wildcard', () => {
    const state = createMatchState(2);
    expect(tryWildcardCapture(STAR_WILDCARD, 5, 12, state)).toBe(true);
    expect(state.paramOffsets[0]).toBe(5);
    expect(state.paramOffsets[1]).toBe(12);
  });

  it('returns false for a node without wildcardStore', () => {
    const state = createMatchState(2);
    expect(tryWildcardCapture(STORE, 0, 0, state)).toBe(false);
  });

  it('rejects multi-wildcard when pos is already at end of URL', () => {
    const state = createMatchState(2);
    expect(tryWildcardCapture(MULTI_WILDCARD, 5, 5, state)).toBe(false);
  });
});

describe('consumeFixedPrefix (prefix-factor)', () => {
  it('returns the position after every prefix segment is consumed', () => {
    expect(consumeFixedPrefix(['users'], 1, '/users/42', 1, 9)).toBe(7);
  });

  it('returns -1 on prefix mismatch', () => {
    expect(consumeFixedPrefix(['users'], 1, '/admin', 1, 6)).toBe(-1);
  });

  it('returns -1 when a prefix segment overruns the URL', () => {
    expect(consumeFixedPrefix(['users'], 1, '/u', 1, 2)).toBe(-1);
  });

  it('handles a zero-length prefix array as a no-op', () => {
    expect(consumeFixedPrefix([], 0, '/x', 5, 2)).toBe(5);
  });
});

describe('scanSegmentEnd (prefix-factor)', () => {
  it('returns the index of the next `/`', () => {
    expect(scanSegmentEnd('/a/b/c', 1, 6)).toBe(2);
  });

  it('returns `len` when no `/` is found before end-of-URL', () => {
    expect(scanSegmentEnd('/abc', 1, 4)).toBe(4);
  });

  it('returns `pos` for an empty segment when `pos` already points at `/`', () => {
    expect(scanSegmentEnd('/a//b', 2, 5)).toBe(2);
  });
});

describe('walkSharedSubtree (factored)', () => {
  it('returns true and writes storeOverride when descending to a store-leaf', () => {
    const state = createMatchState(2);
    const decoder = (s: string) => s;
    const ok = walkSharedSubtree(STORE, '/x', 2, 2, 99, decoder, state);
    expect(ok).toBe(true);
    expect(state.handlerIndex).toBe(99);
  });

  it('returns false when the URL has remaining characters but the subtree has no static/param child', () => {
    const state = createMatchState(2);
    const decoder = (s: string) => s;
    expect(walkSharedSubtree(STORE, '/x/y', 1, 4, 99, decoder, state)).toBe(false);
  });
});
