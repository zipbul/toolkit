import { afterEach, describe, expect, it } from 'bun:test';

import { DEFAULT_MARKER_KEY, err, isErr, setMarkerKey } from '../index';
import type { Err, Result } from '../index';

describe('result', () => {
  afterEach(() => {
    setMarkerKey(DEFAULT_MARKER_KEY);
  });

  it('should detect err() result using isErr()', () => {
    // Arrange / Act
    const result = err();
    // Assert
    expect(isErr(result)).toBe(true);
  });

  it('should not detect plain success value as error', () => {
    // Arrange / Act / Assert
    expect(isErr('success')).toBe(false);
  });

  it('should access data through type narrowing after isErr()', () => {
    // Arrange
    const result = err({ code: 'A' });
    // Act / Assert
    expect(isErr(result)).toBe(true);
    if (isErr<{ code: string }>(result)) {
      expect(result.data.code).toBe('A');
    }
  });

  it('should access success type through !isErr() narrowing', () => {
    // Arrange
    const value: Result<{ id: string }, { code: string }> = { id: '1' };
    // Act / Assert
    expect(isErr(value)).toBe(false);
    if (!isErr(value)) {
      expect(value.id).toBe('1');
    }
  });

  it('should work with Result function pattern: success case', () => {
    // Arrange
    function findItem(id: string): Result<{ id: string }, { code: string }> {
      if (!id) return err({ code: 'INVALID' });
      return { id };
    }
    // Act
    const result = findItem('1');
    // Assert
    expect(isErr(result)).toBe(false);
    if (!isErr(result)) {
      expect(result.id).toBe('1');
    }
  });

  it('should work with Result function pattern: error case', () => {
    // Arrange
    function findItem(id: string): Result<{ id: string }, { code: string }> {
      if (!id) return err({ code: 'INVALID' });
      return { id };
    }
    // Act
    const result = findItem('');
    // Assert
    expect(isErr(result)).toBe(true);
    if (isErr<{ code: string }>(result)) {
      expect(result.data.code).toBe('INVALID');
    }
  });

  it('should handle err() with no arguments end-to-end', () => {
    // Arrange / Act
    const result = err();
    // Assert
    expect(isErr(result)).toBe(true);
    expect(typeof result.stack).toBe('string');
  });

  it('should handle err() with string data end-to-end', () => {
    // Arrange / Act
    const result = err('something went wrong');
    // Assert
    expect(isErr(result)).toBe(true);
    if (isErr<string>(result)) {
      expect(result.data).toBe('something went wrong');
    }
  });

  it('should handle err() with number data end-to-end', () => {
    // Arrange / Act
    const result = err(404);
    // Assert
    expect(isErr(result)).toBe(true);
    if (isErr<number>(result)) {
      expect(result.data).toBe(404);
    }
  });

  it('should handle multiple different error types in sequence', () => {
    // Arrange
    const errors = [err(), err('msg'), err(42), err({ code: 'X' })];
    // Act / Assert
    for (const e of errors) {
      expect(isErr(e)).toBe(true);
    }
  });

  it('should produce marker value for err() results', () => {
    // Arrange / Act
    const r1 = err();
    const r2 = err({ code: 'A' });
    // Assert
    expect((r1 as Record<string, unknown>)[DEFAULT_MARKER_KEY]).toBe(true);
    expect((r2 as Record<string, unknown>)[DEFAULT_MARKER_KEY]).toBe(true);
  });

  it('should have string stack on err() results', () => {
    // Arrange / Act
    const result = err();
    // Assert
    expect(typeof result.stack).toBe('string');
  });

  describe('marker key configuration', () => {
    it('should detect error with custom marker key end-to-end', () => {
      // Arrange
      setMarkerKey('__custom__');
      // Act
      const result = err({ code: 'A' });
      // Assert
      expect(isErr(result)).toBe(true);
    });

    it('should not detect error created with old marker key after change', () => {
      // Arrange
      const oldResult = err();
      // Act
      setMarkerKey('__new__');
      // Assert
      expect(isErr(oldResult)).toBe(false);
    });
  });

  it('should work with generic Result function', () => {
    // Arrange
    function safeDivide(a: number, b: number): Result<number, string> {
      if (b === 0) return err('division by zero');
      return a / b;
    }
    // Act
    const success = safeDivide(10, 2);
    const failure = safeDivide(10, 0);
    // Assert
    expect(isErr(success)).toBe(false);
    if (!isErr(success)) {
      expect(success).toBe(5);
    }
    expect(isErr(failure)).toBe(true);
    if (isErr<string>(failure)) {
      expect(failure.data).toBe('division by zero');
    }
  });

  it('should distinguish err from success object with same shape', () => {
    // Arrange — success object that has stack and data fields
    const success: Result<{ stack: string; data: string }, string> = {
      stack: 'not an error',
      data: 'hello',
    };
    const failure = err('fail');
    // Act / Assert
    expect(isErr(success)).toBe(false);
    expect(isErr(failure)).toBe(true);
  });
});
