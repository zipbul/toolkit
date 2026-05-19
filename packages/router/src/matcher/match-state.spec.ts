import { describe, it, expect } from 'bun:test';

import { createMatchState } from './match-state';

describe('MatchState', () => {
  describe('createMatchState', () => {
    it('should initialize handlerIndex to -1', () => {
      const state = createMatchState(64);
      expect(state.handlerIndex).toBe(-1);
    });

    it('should initialize paramCount to 0', () => {
      const state = createMatchState(64);
      expect(state.paramCount).toBe(0);
    });

    it('should pre-allocate paramOffsets Int32Array sized from the given param cap', () => {
      const state = createMatchState(64);
      expect(state.paramOffsets).toBeInstanceOf(Int32Array);
      expect(state.paramOffsets.length).toBe(64 * 2 + 2);
    });

    it('should size paramOffsets from the maxParams argument', () => {
      const state = createMatchState(8);
      expect(state.paramOffsets.length).toBe(8 * 2 + 2);
    });

    it('should clamp paramOffsets to the 2-slot floor when no params are observed', () => {
      const state = createMatchState(0);
      expect(state.paramOffsets.length).toBe(2);
    });

    it('should create independent state objects', () => {
      const s1 = createMatchState(64);
      const s2 = createMatchState(64);

      s1.handlerIndex = 5;
      s1.paramCount = 2;

      expect(s2.handlerIndex).toBe(-1);
      expect(s2.paramCount).toBe(0);
    });
  });
});
