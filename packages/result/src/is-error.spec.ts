import { afterEach, describe, expect, it } from 'bun:test';

import { DEFAULT_MARKER_KEY, getMarkerKey, setMarkerKey } from './constants';
import { isError } from './is-error';

describe('isError', () => {
  describe('true cases', () => {
    it('should return true when value has marker property set to true', () => {
      // Arrange
      const value = { [DEFAULT_MARKER_KEY]: true, stack: '', cause: null, data: {} };
      // Act / Assert
      expect(isError(value)).toBe(true);
    });

    it('should return true when value is frozen with marker property true', () => {
      // Arrange
      const value = Object.freeze({ [DEFAULT_MARKER_KEY]: true, stack: '', cause: null, data: {} });
      // Act / Assert
      expect(isError(value)).toBe(true);
    });

    it('should return true when value has extra properties beyond Error shape', () => {
      // Arrange
      const value = { [DEFAULT_MARKER_KEY]: true, stack: '', cause: null, data: {}, extra: 1 };
      // Act / Assert
      expect(isError(value)).toBe(true);
    });
  });

  describe('false cases - primitives', () => {
    it('should return false when value is null', () => {
      expect(isError(null)).toBe(false);
    });

    it('should return false when value is undefined', () => {
      expect(isError(undefined)).toBe(false);
    });

    it('should return false when value is a string', () => {
      expect(isError('hello')).toBe(false);
    });

    it('should return false when value is a number', () => {
      expect(isError(42)).toBe(false);
    });

    it('should return false when value is a boolean true', () => {
      expect(isError(true)).toBe(false);
    });

    it('should return false when value is a boolean false', () => {
      expect(isError(false)).toBe(false);
    });

    it('should return false when value is a symbol', () => {
      expect(isError(Symbol('s'))).toBe(false);
    });

    it('should return false when value is a bigint', () => {
      expect(isError(42n)).toBe(false);
    });

    it('should return false when value is a function', () => {
      expect(isError(() => {})).toBe(false);
    });
  });

  describe('false cases - objects', () => {
    it('should return false when value is an empty object', () => {
      expect(isError({})).toBe(false);
    });

    it('should return false when marker property is false', () => {
      expect(isError({ [DEFAULT_MARKER_KEY]: false })).toBe(false);
    });

    it('should return false when marker property is string "true"', () => {
      expect(isError({ [DEFAULT_MARKER_KEY]: 'true' })).toBe(false);
    });

    it('should return false when marker property is number 1', () => {
      expect(isError({ [DEFAULT_MARKER_KEY]: 1 })).toBe(false);
    });

    it('should return false when marker property is null', () => {
      expect(isError({ [DEFAULT_MARKER_KEY]: null })).toBe(false);
    });

    it('should return false when marker property is undefined', () => {
      expect(isError({ [DEFAULT_MARKER_KEY]: undefined })).toBe(false);
    });

    it('should return false when value is an array', () => {
      expect(isError([])).toBe(false);
    });

    it('should return false when value is a Date', () => {
      expect(isError(new Date())).toBe(false);
    });

    it('should return false when value is a RegExp', () => {
      expect(isError(/abc/)).toBe(false);
    });

    it('should return false when value is a Map', () => {
      expect(isError(new Map())).toBe(false);
    });

    it('should return false when value is an Error instance', () => {
      expect(isError(new globalThis.Error('x'))).toBe(false);
    });

    it('should return false when value is Object.create(null)', () => {
      expect(isError(Object.create(null))).toBe(false);
    });
  });

  describe('no-throw guarantee', () => {
    it('should not throw when value is a Proxy that throws on property access', () => {
      // Arrange
      const hostileProxy = new Proxy({}, {
        get() { throw new globalThis.Error('proxy trap'); },
        has() { throw new globalThis.Error('proxy trap'); },
      });
      // Act / Assert
      expect(() => isError(hostileProxy)).not.toThrow();
      expect(isError(hostileProxy)).toBe(false);
    });
  });

  describe('idempotency', () => {
    it('should return same result when called multiple times on same value', () => {
      // Arrange
      const errValue = { [DEFAULT_MARKER_KEY]: true, stack: '', cause: null, data: {} };
      const plainValue = { foo: 'bar' };
      // Act / Assert
      for (let i = 0; i < 5; i++) {
        expect(isError(errValue)).toBe(true);
        expect(isError(plainValue)).toBe(false);
      }
    });
  });

  describe('marker key configuration', () => {
    afterEach(() => {
      setMarkerKey(DEFAULT_MARKER_KEY);
    });

    it('should detect object with updated marker key after setMarkerKey', () => {
      // Arrange
      setMarkerKey('__custom__');
      const value = { __custom__: true, stack: '', cause: null, data: {} };
      // Act / Assert
      expect(isError(value)).toBe(true);
    });

    it('should not detect object with old marker key after setMarkerKey', () => {
      // Arrange
      setMarkerKey('__custom__');
      const value = { [DEFAULT_MARKER_KEY]: true, stack: '', cause: null, data: {} };
      // Act / Assert
      expect(isError(value)).toBe(false);
    });
  });
});
