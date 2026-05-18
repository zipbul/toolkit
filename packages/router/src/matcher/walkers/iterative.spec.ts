/**
 * Unit specs for the iterative walker helpers. Each helper is pure
 * (no closure state) and exercised with raw arrays / SegmentNode literals.
 */
import { describe, expect, it } from 'bun:test';

import type { SegmentNode } from '../../tree';

import { createMatchState } from '../match-state';
import { consumeStaticPrefix, matchTerminalAtNode } from './iterative';
import { MULTI_WILDCARD_NODE, STAR_WILDCARD_NODE, STORE_NODE } from './test-fixtures';

const STORE = STORE_NODE;
const STAR_WILDCARD = STAR_WILDCARD_NODE;
const MULTI_WILDCARD = MULTI_WILDCARD_NODE;

describe('consumeStaticPrefix', () => {
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

describe('matchTerminalAtNode', () => {
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
