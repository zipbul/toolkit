import { afterEach, describe, expect, it } from 'bun:test';

import { DEFAULT_MARKER_KEY, getMarkerKey, setMarkerKey } from './constants';
import { err } from './err';
import { isErr } from './is-err';

describe('isErr', () => {
  afterEach(() => {
    setMarkerKey(DEFAULT_MARKER_KEY);
  });

  describe('true cases', () => {
    it('should return true for err() result', () => {
      // Arrange / Act
      const result = err();
      // Assert
      expect(isErr(result)).toBe(true);
    });

    it('should return true for err(data) result', () => {
      // Arrange / Act
      const result = err({ code: 'A' });
      // Assert
      expect(isErr(result)).toBe(true);
    });

    it('should return true for manually created object with marker true', () => {
      // Arrange
      const value = { [DEFAULT_MARKER_KEY]: true, stack: '', data: {} };
      // Act / Assert
      expect(isErr(value)).toBe(true);
    });

    it('should return true for frozen object with marker true', () => {
      // Arrange
      const value = Object.freeze({ [DEFAULT_MARKER_KEY]: true, stack: '', data: {} });
      // Act / Assert
      expect(isErr(value)).toBe(true);
    });

    it('should return true for object with extra properties', () => {
      // Arrange
      const value = { [DEFAULT_MARKER_KEY]: true, stack: '', data: {}, extra: 1 };
      // Act / Assert
      expect(isErr(value)).toBe(true);
    });
  });

  describe('false cases - primitives', () => {
    it('should return false for null', () => {
      expect(isErr(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isErr(undefined)).toBe(false);
    });

    it('should return false for string', () => {
      expect(isErr('hello')).toBe(false);
    });

    it('should return false for number', () => {
      expect(isErr(42)).toBe(false);
    });

    it('should return false for boolean true', () => {
      expect(isErr(true)).toBe(false);
    });

    it('should return false for boolean false', () => {
      expect(isErr(false)).toBe(false);
    });

    it('should return false for symbol', () => {
      expect(isErr(Symbol('s'))).toBe(false);
    });

    it('should return false for bigint', () => {
      expect(isErr(42n)).toBe(false);
    });

    it('should return false for function', () => {
      expect(isErr(() => {})).toBe(false);
    });
  });

  describe('false cases - objects', () => {
    it('should return false for empty object', () => {
      expect(isErr({})).toBe(false);
    });

    it('should return false for marker set to false', () => {
      expect(isErr({ [DEFAULT_MARKER_KEY]: false })).toBe(false);
    });

    it('should return false for marker set to string true', () => {
      expect(isErr({ [DEFAULT_MARKER_KEY]: 'true' })).toBe(false);
    });

    it('should return false for marker set to number 1', () => {
      expect(isErr({ [DEFAULT_MARKER_KEY]: 1 })).toBe(false);
    });

    it('should return false for empty array', () => {
      expect(isErr([])).toBe(false);
    });

    it('should return false for native Error instance', () => {
      expect(isErr(new Error('x'))).toBe(false);
    });

    it('should return false for Object.create(null) without marker', () => {
      expect(isErr(Object.create(null))).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should return true for object with only marker property', () => {
      // Arrange
      const value = { [DEFAULT_MARKER_KEY]: true };
      // Act / Assert
      expect(isErr(value)).toBe(true);
    });

    it('should return true for Object.create(null) with marker true', () => {
      // Arrange
      const value = Object.create(null);
      value[DEFAULT_MARKER_KEY] = true;
      // Act / Assert
      expect(isErr(value)).toBe(true);
    });

    it('should return false for boxed Boolean(true) as marker value', () => {
      // Arrange
      // eslint-disable-next-line no-new-wrappers
      const value = { [DEFAULT_MARKER_KEY]: new Boolean(true) };
      // Act / Assert
      expect(isErr(value)).toBe(false);
    });
  });

  describe('corner cases', () => {
    it('should return false for Proxy that throws on property access', () => {
      // Arrange
      const hostileProxy = new Proxy({}, {
        get() { throw new Error('proxy trap'); },
        has() { throw new Error('proxy trap'); },
      });
      // Act / Assert
      expect(() => isErr(hostileProxy)).not.toThrow();
      expect(isErr(hostileProxy)).toBe(false);
    });

    it('should return true for getter returning true as marker', () => {
      // Arrange
      const value = Object.defineProperty({}, DEFAULT_MARKER_KEY, {
        get: () => true,
        enumerable: true,
        configurable: true,
      });
      // Act / Assert
      expect(isErr(value)).toBe(true);
    });

    it('should detect object with updated marker key', () => {
      // Arrange
      setMarkerKey('__custom__');
      const value = { __custom__: true, stack: '', data: {} };
      // Act / Assert
      expect(isErr(value)).toBe(true);
    });

    it('should not detect object with old marker key', () => {
      // Arrange
      setMarkerKey('__custom__');
      const value = { [DEFAULT_MARKER_KEY]: true, stack: '', data: {} };
      // Act / Assert
      expect(isErr(value)).toBe(false);
    });
  });

  describe('idempotency', () => {
    it('should return same result when called multiple times on same value', () => {
      // Arrange
      const errValue = err({ code: 'A' });
      const plainValue = { foo: 'bar' };
      // Act / Assert
      for (let i = 0; i < 5; i++) {
        expect(isErr(errValue)).toBe(true);
        expect(isErr(plainValue)).toBe(false);
      }
    });
  });
});
