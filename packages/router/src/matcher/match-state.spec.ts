import { describe, it, expect } from 'bun:test';

import { createMatchState } from './match-state';

describe('MatchState', () => {
  describe('createMatchState', () => {
    it('should initialize handlerIndex to -1', () => {
      const state = createMatchState();
      expect(state.handlerIndex).toBe(-1);
    });

    it('should initialize paramCount to 0', () => {
      const state = createMatchState();
      expect(state.paramCount).toBe(0);
    });

    it('should pre-allocate paramOffsets Int32Array sized for the default 64-param cap', () => {
      const state = createMatchState();
      expect(state.paramOffsets).toBeInstanceOf(Int32Array);
      // 64 params × 2 slots + 2 headroom slots (see createMatchState).
      expect(state.paramOffsets.length).toBe(64 * 2 + 2);
    });

    it('should size paramOffsets from the maxParams argument when provided', () => {
      const state = createMatchState(8);
      expect(state.paramOffsets.length).toBe(8 * 2 + 2);
    });

    it('should create independent state objects', () => {
      const s1 = createMatchState();
      const s2 = createMatchState();

      s1.handlerIndex = 5;
      s1.paramCount = 2;

      expect(s2.handlerIndex).toBe(-1);
      expect(s2.paramCount).toBe(0);
    });
  });
});
