import { describe, it, expect } from 'bun:test';
import * as stubs from './object';

const EXPECTED_EXPORTS = ['IsNotEmptyObject', 'IsInstance'] as const;

describe('stubs/object', () => {
  it('should export all 2 stub functions', () => {
    for (const name of EXPECTED_EXPORTS) {
      expect(typeof (stubs as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('should return a PropertyDecorator when called with valid args', () => {
    expect(typeof stubs.IsNotEmptyObject()).toBe('function');
    expect(typeof stubs.IsInstance(class {})).toBe('function');
  });

  it('should not throw when returned decorator is applied to a dummy target', () => {
    const target = {};
    const key = 'field';
    for (const name of EXPECTED_EXPORTS) {
      const decorator = (stubs as Record<string, (...args: any[]) => PropertyDecorator>)[name](undefined as any);
      expect(() => decorator(target, key)).not.toThrow();
    }
  });
});
