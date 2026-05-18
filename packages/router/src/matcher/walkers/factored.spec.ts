/**
 * Unit specs for the factored walker helpers. The factored walker shares
 * a subtree across multiple compiled paths and descends through it
 * after the per-path prefix matches; these specs pin its descent contract.
 */
import { describe, expect, it } from 'bun:test';

import { createMatchState } from '../match-state';
import { walkSharedSubtree } from './factored';
import { STORE_NODE } from './test-fixtures';

const STORE = STORE_NODE;

describe('walkSharedSubtree', () => {
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
