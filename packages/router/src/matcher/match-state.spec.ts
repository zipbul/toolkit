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

    it('should pre-allocate paramValues array with 32 slots', () => {
      const state = createMatchState();
      expect(state.paramValues.length).toBe(32);
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
