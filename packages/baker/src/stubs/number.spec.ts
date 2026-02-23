import { describe, it, expect } from 'bun:test';
import * as stubs from './number';

const EXPECTED_EXPORTS = [
  'Min', 'Max', 'IsPositive', 'IsNegative', 'IsDivisibleBy',
] as const;

describe('stubs/number', () => {
  it('should export all 5 stub functions', () => {
    for (const name of EXPECTED_EXPORTS) {
      expect(typeof (stubs as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('should return a PropertyDecorator when called with valid args', () => {
    expect(typeof stubs.Min(0)).toBe('function');
    expect(typeof stubs.Max(100)).toBe('function');
    expect(typeof stubs.IsPositive()).toBe('function');
    expect(typeof stubs.IsNegative()).toBe('function');
    expect(typeof stubs.IsDivisibleBy(2)).toBe('function');
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
