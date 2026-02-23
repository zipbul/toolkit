import { describe, it, expect } from 'bun:test';
import * as stubs from './array';

const EXPECTED_EXPORTS = [
  'ArrayContains', 'ArrayNotContains', 'ArrayMinSize',
  'ArrayMaxSize', 'ArrayUnique', 'ArrayNotEmpty',
] as const;

describe('stubs/array', () => {
  it('should export all 6 stub functions', () => {
    for (const name of EXPECTED_EXPORTS) {
      expect(typeof (stubs as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('should return a PropertyDecorator when called with valid args', () => {
    expect(typeof stubs.ArrayContains([1])).toBe('function');
    expect(typeof stubs.ArrayNotContains([1])).toBe('function');
    expect(typeof stubs.ArrayMinSize(0)).toBe('function');
    expect(typeof stubs.ArrayMaxSize(10)).toBe('function');
    expect(typeof stubs.ArrayUnique()).toBe('function');
    expect(typeof stubs.ArrayNotEmpty()).toBe('function');
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
