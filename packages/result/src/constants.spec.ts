import { afterEach, describe, expect, it } from 'bun:test';

import { DEFAULT_MARKER_KEY, getMarkerKey, setMarkerKey } from './constants';

describe('constants', () => {
  afterEach(() => {
    setMarkerKey(DEFAULT_MARKER_KEY);
  });

  describe('DEFAULT_MARKER_KEY', () => {
    it('should be a non-empty string', () => {
      // Arrange / Act / Assert
      expect(typeof DEFAULT_MARKER_KEY).toBe('string');
      expect(DEFAULT_MARKER_KEY.length).toBeGreaterThan(0);
    });

    it('should not contain zipbul case-insensitively', () => {
      // Arrange / Act / Assert
      expect(DEFAULT_MARKER_KEY.toLowerCase().includes('zipbul')).toBe(false);
    });
  });

  describe('getMarkerKey', () => {
    it('should return DEFAULT_MARKER_KEY when no custom key has been set', () => {
      // Arrange — afterEach ensures default is restored
      // Act
      const key = getMarkerKey();
      // Assert
      expect(key).toBe(DEFAULT_MARKER_KEY);
    });

    it('should return updated key after setMarkerKey is called', () => {
      // Arrange
      setMarkerKey('__test__');
      // Act
      const key = getMarkerKey();
      // Assert
      expect(key).toBe('__test__');
    });
  });

  describe('setMarkerKey', () => {
    it('should throw TypeError when setting empty string', () => {
      // Arrange / Act / Assert
      expect(() => setMarkerKey('')).toThrow(TypeError);
    });

    it('should accept any non-empty string', () => {
      // Arrange
      setMarkerKey('x');
      // Act
      const key = getMarkerKey();
      // Assert
      expect(key).toBe('x');
    });

    it('should restore default after setMarkerKey with DEFAULT_MARKER_KEY', () => {
      // Arrange
      setMarkerKey('__custom__');
      // Act
      setMarkerKey(DEFAULT_MARKER_KEY);
      // Assert
      expect(getMarkerKey()).toBe(DEFAULT_MARKER_KEY);
    });
  });
});
