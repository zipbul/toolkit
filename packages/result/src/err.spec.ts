import { afterEach, describe, expect, it } from 'bun:test';

import { DEFAULT_MARKER_KEY, getMarkerKey, setMarkerKey } from './constants';
import { err } from './err';

describe('err', () => {
  afterEach(() => {
    setMarkerKey(DEFAULT_MARKER_KEY);
  });

  describe('happy path', () => {
    it('should return Err with marker set to true when called without arguments', () => {
      // Arrange / Act
      const result = err();
      // Assert
      expect((result as Record<string, unknown>)[getMarkerKey()]).toBe(true);
    });

    it('should return Err with object data when data argument is given', () => {
      // Arrange / Act
      const result = err({ code: 'A' });
      // Assert
      expect(result.data.code).toBe('A');
    });

    it('should return Err with string data when string is passed', () => {
      // Arrange / Act
      const result = err('msg');
      // Assert
      expect(result.data).toBe('msg');
    });

    it('should return Err with number data when number is passed', () => {
      // Arrange / Act
      const result = err(42);
      // Assert
      expect(result.data).toBe(42);
    });

    it('should have stack property as string', () => {
      // Arrange / Act
      const result = err();
      // Assert
      expect(typeof result.stack).toBe('string');
    });

    it('should have non-empty stack in normal environment', () => {
      // Arrange / Act
      const result = err();
      // Assert
      expect(result.stack.length).toBeGreaterThan(0);
    });
  });

  describe('no-throw guarantee', () => {
    it('should not throw when data is a hostile Proxy', () => {
      // Arrange
      const hostileProxy = new Proxy({}, {
        get() { throw new Error('proxy trap'); },
        has() { throw new Error('proxy trap'); },
      });
      // Act / Assert
      expect(() => err(hostileProxy)).not.toThrow();
      const result = err(hostileProxy);
      expect((result as Record<string, unknown>)[getMarkerKey()]).toBe(true);
    });

    it('should not throw when data is a circular reference object', () => {
      // Arrange
      const obj: Record<string, unknown> = {};
      obj.self = obj;
      // Act / Assert
      expect(() => err(obj)).not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should set data to undefined when called without arguments', () => {
      // Arrange / Act
      const result = err();
      // Assert
      expect(result.data).toBeUndefined();
    });

    it('should set data to empty string when empty string is passed', () => {
      // Arrange / Act
      const result = err('');
      // Assert
      expect(result.data).toBe('');
    });

    it('should set data to 0 when 0 is passed', () => {
      // Arrange / Act
      const result = err(0);
      // Assert
      expect(result.data).toBe(0);
    });

    it('should set data to false when false is passed', () => {
      // Arrange / Act
      const result = err(false);
      // Assert
      expect(result.data).toBe(false);
    });

    it('should have exactly 3 own properties: marker, stack, data', () => {
      // Arrange / Act
      const result = err();
      const keys = Object.keys(result as object);
      // Assert
      expect(keys.length).toBe(3);
      expect(keys).toContain(getMarkerKey());
      expect(keys).toContain('stack');
      expect(keys).toContain('data');
    });

    it('should set marker to exactly boolean true', () => {
      // Arrange / Act
      const result = err();
      // Assert
      expect((result as Record<string, unknown>)[getMarkerKey()]).toBe(true);
    });
  });

  describe('corner cases', () => {
    it('should use updated marker key after setMarkerKey', () => {
      // Arrange
      setMarkerKey('__custom__');
      // Act
      const result = err();
      // Assert
      expect((result as Record<string, unknown>)['__custom__']).toBe(true);
      expect((result as Record<string, unknown>)[DEFAULT_MARKER_KEY]).toBeUndefined();
    });

    it('should not include old marker key after setMarkerKey', () => {
      // Arrange
      setMarkerKey('__new__');
      // Act
      const result = err({ code: 'A' });
      // Assert
      expect(Object.keys(result as object)).not.toContain(DEFAULT_MARKER_KEY);
    });

    it('should return frozen object', () => {
      // Arrange / Act
      const result = err();
      // Assert
      expect(Object.isFrozen(result)).toBe(true);
    });

    it('should throw TypeError when assigning to data property', () => {
      // Arrange
      const result = err();
      // Act / Assert
      expect(() => {
        (result as Record<string, unknown>)['data'] = {};
      }).toThrow(TypeError);
    });

    it('should throw TypeError when assigning to stack property', () => {
      // Arrange
      const result = err();
      // Act / Assert
      expect(() => {
        (result as Record<string, unknown>)['stack'] = '';
      }).toThrow(TypeError);
    });

    it('should throw TypeError when adding new property', () => {
      // Arrange
      const result = err();
      // Act / Assert
      expect(() => {
        (result as Record<string, unknown>)['newProp'] = 1;
      }).toThrow(TypeError);
    });

    it('should not deep-freeze data', () => {
      // Arrange
      const d = { x: 1 };
      const result = err(d);
      // Act
      d.x = 2;
      // Assert
      expect(result.data.x).toBe(2);
    });

    it('should return independent objects for consecutive calls', () => {
      // Arrange / Act
      const r1 = err({ code: 'A' });
      const r2 = err({ code: 'A' });
      // Assert
      expect(r1).not.toBe(r2);
    });
  });

  describe('idempotency', () => {
    it('should return same structure for same arguments called twice', () => {
      // Arrange / Act
      const r1 = err({ code: 'A' });
      const r2 = err({ code: 'A' });
      // Assert
      expect(r1.data).toEqual(r2.data);
      expect(typeof r1.stack).toBe(typeof r2.stack);
      expect((r1 as Record<string, unknown>)[getMarkerKey()]).toBe(
        (r2 as Record<string, unknown>)[getMarkerKey()],
      );
    });

    it('should return different references for same arguments', () => {
      // Arrange / Act
      const r1 = err('test');
      const r2 = err('test');
      // Assert
      expect(r1).not.toBe(r2);
    });
  });
});
