import { afterEach, describe, expect, it } from 'bun:test';

import { DEFAULT_MARKER_KEY, error, isError, setMarkerKey } from '../index';
import type { Error as ResultError, Result } from '../index';

describe('result', () => {
  it('should detect error created by error() using isError()', () => {
    // Arrange / Act
    const result = error(new globalThis.Error('x'));
    // Assert
    expect(isError(result)).toBe(true);
  });

  it('should not detect plain success value as error', () => {
    // Arrange / Act / Assert
    expect(isError('success')).toBe(false);
  });

  it('should preserve cause through error creation and detection cycle', () => {
    // Arrange
    const e = new globalThis.Error('x');
    // Act
    const result = error(e);
    // Assert
    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.cause).toBe(e);
    }
  });

  it('should preserve custom data through error creation and detection cycle', () => {
    // Arrange
    const cause = new globalThis.Error('x');
    // Act
    const result = error(cause, { code: 'A' });
    // Assert
    expect(isError(result)).toBe(true);
    if (isError<{ code: string }>(result)) {
      expect(result.data.code).toBe('A');
    }
  });

  it('should work with Error instance as cause end-to-end', () => {
    // Arrange
    const e = new globalThis.Error('end-to-end');
    // Act
    const result = error(e);
    // Assert
    expect(result.stack).toBe(e.stack);
    expect(isError(result)).toBe(true);
  });

  it('should work with non-Error cause end-to-end', () => {
    // Arrange / Act
    const result = error('msg');
    // Assert
    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.cause).toBe('msg');
    }
  });

  it('should produce same marker value for identical cause input', () => {
    // Arrange
    const e = new globalThis.Error('x');
    // Act
    const r1 = error(e);
    const r2 = error(e);
    // Assert
    expect((r1 as Record<string, unknown>)[DEFAULT_MARKER_KEY]).toBe(true);
    expect((r2 as Record<string, unknown>)[DEFAULT_MARKER_KEY]).toBe(true);
  });

  it('should handle multiple different error types in sequence', () => {
    // Arrange
    const causes: unknown[] = [
      new globalThis.Error('a'),
      'string cause',
      null,
      42,
      { code: 'X' },
    ];
    // Act / Assert
    for (const cause of causes) {
      const result = error(cause);
      expect(isError(result)).toBe(true);
    }
  });

  it('should work with function returning Result type', () => {
    // Arrange
    function findItem(id: string): Result<{ id: string }, ResultError<{ code: string }>> {
      if (!id) return error(new globalThis.Error('invalid'), { code: 'INVALID' });
      return { id };
    }

    // Act
    const failResult = findItem('');
    const successResult = findItem('1');

    // Assert
    expect(isError(failResult)).toBe(true);
    if (isError<{ code: string }>(failResult)) {
      expect(failResult.data.code).toBe('INVALID');
    }
    expect(isError(successResult)).toBe(false);
    if (!isError(successResult)) {
      expect(successResult.id).toBe('1');
    }
  });

  describe('marker key configuration', () => {
    afterEach(() => {
      setMarkerKey(DEFAULT_MARKER_KEY);
    });

    it('should detect error with custom marker key end-to-end', () => {
      // Arrange
      setMarkerKey('__custom__');
      // Act
      const result = error(new globalThis.Error('x'));
      // Assert
      expect(isError(result)).toBe(true);
    });

    it('should not detect error created with old marker key after marker key change', () => {
      // Arrange — create with default key
      const oldResult = error(new globalThis.Error('x'));
      // Act — change marker key
      setMarkerKey('__new__');
      // Assert — old result not detected with new key
      expect(isError(oldResult)).toBe(false);
    });
  });
});
