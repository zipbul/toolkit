import { describe, it, expect } from 'bun:test';

import { createMatchState, resetMatchState } from './match-state';
import type { MatchState } from './match-state';

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

    it('should initialize errorKind to null', () => {
      const state = createMatchState();
      expect(state.errorKind).toBeNull();
    });

    it('should initialize errorMessage to null', () => {
      const state = createMatchState();
      expect(state.errorMessage).toBeNull();
    });

    it('should pre-allocate paramNames array with 32 slots', () => {
      const state = createMatchState();
      expect(state.paramNames.length).toBe(32);
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

  describe('resetMatchState', () => {
    it('should reset handlerIndex to -1', () => {
      const state = createMatchState();
      state.handlerIndex = 42;

      resetMatchState(state);

      expect(state.handlerIndex).toBe(-1);
    });

    it('should reset paramCount to 0', () => {
      const state = createMatchState();
      state.paramCount = 3;

      resetMatchState(state);

      expect(state.paramCount).toBe(0);
    });

    it('should reset errorKind to null', () => {
      const state = createMatchState();
      state.errorKind = 'regex-timeout';
      state.errorMessage = 'bad %';

      resetMatchState(state);

      expect(state.errorKind).toBeNull();
      expect(state.errorMessage).toBeNull();
    });

    it('should NOT clear paramNames or paramValues arrays (reused)', () => {
      const state = createMatchState();
      state.paramNames[0] = 'id';
      state.paramValues[0] = '42';
      state.paramCount = 1;

      resetMatchState(state);

      // Arrays retain previous values (not cleared for performance)
      expect(state.paramNames[0]).toBe('id');
      expect(state.paramValues[0]).toBe('42');
    });

    it('should allow reuse after reset', () => {
      const state = createMatchState();

      // First use
      state.handlerIndex = 1;
      state.paramNames[0] = 'userId';
      state.paramValues[0] = '100';
      state.paramCount = 1;

      // Reset and second use
      resetMatchState(state);
      state.handlerIndex = 2;
      state.paramNames[0] = 'postId';
      state.paramValues[0] = '200';
      state.paramCount = 1;

      expect(state.handlerIndex).toBe(2);
      expect(state.paramNames[0]).toBe('postId');
      expect(state.paramValues[0]).toBe('200');
      expect(state.paramCount).toBe(1);
    });
  });
});
