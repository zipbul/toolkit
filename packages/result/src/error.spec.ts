import { afterEach, describe, expect, it } from 'bun:test';

import { DEFAULT_MARKER_KEY, getMarkerKey, setMarkerKey } from './constants';
import { error } from './error';

// F-2에서 사용: stack getter가 throw하는 Error 서브클래스
// JSC(Bun)에서 Error 생성자가 own 'stack' property를 설정할 수 있으므로 defineProperty로 강제 오버라이드
function makeThrowingStackError(): globalThis.Error {
  const e = new globalThis.Error('x');
  Object.defineProperty(e, 'stack', { get() { throw new globalThis.Error('stack trap'); } });
  return e;
}

describe('error', () => {
  describe('happy path', () => {
    it('should return object with marker property set to true when cause is an Error', () => {
      // Arrange
      const cause = new globalThis.Error('x');
      // Act
      const result = error(cause);
      // Assert
      expect((result as Record<string, unknown>)[getMarkerKey()]).toBe(true);
    });

    it('should return object with marker property set to true when cause is a string', () => {
      // Arrange / Act
      const result = error('msg');
      // Assert
      expect((result as Record<string, unknown>)[getMarkerKey()]).toBe(true);
    });

    it('should set data to provided object when data argument is given', () => {
      // Arrange
      const cause = new globalThis.Error('x');
      // Act
      const result = error(cause, { code: 'A' });
      // Assert
      expect(result.data.code).toBe('A');
    });

    it('should set data to empty object when data argument is omitted', () => {
      // Arrange
      const cause = new globalThis.Error('x');
      // Act
      const result = error(cause);
      // Assert
      expect(result.data).toEqual({});
    });
  });

  describe('cause preservation', () => {
    it('should preserve Error instance as cause by reference', () => {
      // Arrange
      const e = new globalThis.Error('x');
      // Act / Assert
      expect(error(e).cause).toBe(e);
    });

    it('should preserve string as cause', () => {
      // Arrange / Act / Assert
      expect(error('hello').cause).toBe('hello');
    });

    it('should preserve null as cause', () => {
      // Arrange / Act / Assert
      expect(error(null).cause).toBeNull();
    });

    it('should preserve undefined as cause', () => {
      // Arrange / Act / Assert
      expect(error(undefined).cause).toBeUndefined();
    });

    it('should preserve number as cause', () => {
      // Arrange / Act / Assert
      expect(error(42).cause).toBe(42);
    });

    it('should preserve symbol as cause', () => {
      // Arrange
      const s = Symbol('test');
      // Act / Assert
      expect(error(s).cause).toBe(s);
    });

    it('should preserve object as cause by reference', () => {
      // Arrange
      const o = { val: 1 };
      // Act / Assert
      expect(error(o).cause).toBe(o);
    });

    it('should preserve bigint as cause', () => {
      // Arrange / Act / Assert
      expect(error(42n).cause).toBe(42n);
    });

    it('should preserve boolean as cause', () => {
      // Arrange / Act / Assert
      expect(error(false).cause).toBe(false);
    });
  });

  describe('stack selection', () => {
    it('should use Error.stack when cause is Error with non-empty stack', () => {
      // Arrange
      const e = new globalThis.Error('x');
      // Act / Assert
      expect(error(e).stack).toBe(e.stack);
    });

    it('should capture new stack when cause is Error with empty string stack', () => {
      // Arrange
      const e = new globalThis.Error('x');
      e.stack = '';
      // Act
      const result = error(e);
      // Assert
      expect(result.stack).not.toBe('');
      expect(typeof result.stack).toBe('string');
    });

    it('should capture new stack when cause is Error with undefined stack', () => {
      // Arrange
      const e = new globalThis.Error('x');
      Object.defineProperty(e, 'stack', { value: undefined, configurable: true });
      // Act
      const result = error(e);
      // Assert
      expect(typeof result.stack).toBe('string');
    });

    it('should capture new stack when cause is a string', () => {
      // Arrange / Act
      const result = error('x');
      // Assert
      expect(typeof result.stack).toBe('string');
      expect(result.stack.length).toBeGreaterThan(0);
    });

    it('should capture new stack when cause is null', () => {
      // Arrange / Act / Assert
      expect(typeof error(null).stack).toBe('string');
    });

    it('should capture new stack when cause is a plain object', () => {
      // Arrange / Act / Assert
      expect(typeof error({}).stack).toBe('string');
    });

    it('should always return string type for stack', () => {
      // Arrange
      const causes: unknown[] = [
        new globalThis.Error('e'),
        'string',
        null,
        undefined,
        42,
        {},
      ];
      // Act / Assert
      for (const cause of causes) {
        expect(typeof error(cause).stack).toBe('string');
      }
    });
  });

  describe('freeze', () => {
    it('should return a frozen object', () => {
      // Arrange / Act
      const result = error(new globalThis.Error('x'));
      // Assert
      expect(Object.isFrozen(result)).toBe(true);
    });

    it('should throw TypeError when assigning to marker property', () => {
      // Arrange
      const err = error(new globalThis.Error('x'));
      // Act / Assert
      expect(() => {
        (err as Record<string, unknown>)[getMarkerKey()] = false;
      }).toThrow(TypeError);
    });

    it('should throw TypeError when assigning to cause', () => {
      // Arrange
      const err = error(new globalThis.Error('x'));
      // Act / Assert
      expect(() => {
        (err as Record<string, unknown>)['cause'] = null;
      }).toThrow(TypeError);
    });

    it('should throw TypeError when assigning to stack', () => {
      // Arrange
      const err = error(new globalThis.Error('x'));
      // Act / Assert
      expect(() => {
        (err as Record<string, unknown>)['stack'] = '';
      }).toThrow(TypeError);
    });

    it('should throw TypeError when assigning to data', () => {
      // Arrange
      const err = error(new globalThis.Error('x'));
      // Act / Assert
      expect(() => {
        (err as Record<string, unknown>)['data'] = {};
      }).toThrow(TypeError);
    });

    it('should throw TypeError when adding new property', () => {
      // Arrange
      const err = error(new globalThis.Error('x'));
      // Act / Assert
      expect(() => {
        (err as Record<string, unknown>)['newProp'] = 1;
      }).toThrow(TypeError);
    });

    it('should not deep-freeze data object', () => {
      // Arrange
      const d = { x: 1 };
      const e = error(null, d);
      // Act
      d.x = 2;
      // Assert
      expect(e.data.x).toBe(2);
    });
  });

  describe('marker', () => {
    it('should set marker property to exactly boolean true not truthy value', () => {
      // Arrange / Act
      const result = error(new globalThis.Error('x'));
      // Assert
      expect((result as Record<string, unknown>)[getMarkerKey()]).toBe(true);
    });

    it('should have exactly four own properties', () => {
      // Arrange / Act
      const result = error(new globalThis.Error('x'));
      const keys = Object.keys(result as object);
      // Assert
      expect(keys.length).toBe(4);
      expect(keys).toContain(getMarkerKey());
      expect(keys).toContain('stack');
      expect(keys).toContain('cause');
      expect(keys).toContain('data');
    });
  });

  describe('no-throw guarantee', () => {
    it('should not throw when cause is a Proxy that throws on property access', () => {
      // Arrange
      const hostileProxy = new Proxy({}, {
        get() { throw new globalThis.Error('proxy trap'); },
        has() { throw new globalThis.Error('proxy trap'); },
      });
      // Act / Assert
      expect(() => error(hostileProxy)).not.toThrow();
      const result = error(hostileProxy);
      expect((result as Record<string, unknown>)[getMarkerKey()]).toBe(true);
    });

    it('should not throw when cause is Error subclass with getter stack that throws', () => {
      // Arrange
      const throwingStackErr = makeThrowingStackError();
      // Act / Assert
      expect(() => error(throwingStackErr)).not.toThrow();
      const result = error(throwingStackErr);
      expect(typeof result.stack).toBe('string');
    });
  });

  describe('marker key configuration', () => {
    afterEach(() => {
      setMarkerKey(DEFAULT_MARKER_KEY);
    });

    it('should use default marker key when no custom key is set', () => {
      // Arrange
      const cause = new globalThis.Error('x');
      // Act
      const result = error(cause);
      // Assert
      expect((result as Record<string, unknown>)[DEFAULT_MARKER_KEY]).toBe(true);
    });

    it('should use updated marker key after setMarkerKey is called', () => {
      // Arrange
      setMarkerKey('__custom__');
      const cause = new globalThis.Error('x');
      // Act
      const result = error(cause);
      // Assert
      expect((result as Record<string, unknown>)['__custom__']).toBe(true);
      expect((result as Record<string, unknown>)[DEFAULT_MARKER_KEY]).toBeUndefined();
    });
  });
});
