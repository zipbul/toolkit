import { describe, expect, it } from 'bun:test';

import { createMatchState } from '../match-state';
import { consumeStaticPrefixRec, tryWildcardCapture } from './recursive';
import { MULTI_WILDCARD_NODE, STAR_WILDCARD_NODE, STORE_NODE } from './test-fixtures';

const STORE = STORE_NODE;
const STAR_WILDCARD = STAR_WILDCARD_NODE;
const MULTI_WILDCARD = MULTI_WILDCARD_NODE;

describe('consumeStaticPrefixRec', () => {
  it('returns the new position when the prefix matches', () => {
    expect(consumeStaticPrefixRec(['a'], '/a', 1, 2)).toBe(2);
  });

  it('returns -1 when the literal segment differs', () => {
    expect(consumeStaticPrefixRec(['a'], '/b', 1, 2)).toBe(-1);
  });
});

describe('tryWildcardCapture', () => {
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
