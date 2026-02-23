import { describe, it, expect } from 'bun:test';
import * as stubs from './common';

const EXPECTED_EXPORTS = [
  'IsDefined', 'IsOptional', 'ValidateIf', 'ValidateNested',
  'Equals', 'NotEquals', 'IsEmpty', 'IsNotEmpty', 'IsIn', 'IsNotIn',
] as const;

describe('stubs/common', () => {
  it('should export all 10 stub functions', () => {
    for (const name of EXPECTED_EXPORTS) {
      expect(typeof (stubs as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('should return a PropertyDecorator when called with valid args', () => {
    expect(typeof stubs.IsDefined()).toBe('function');
    expect(typeof stubs.IsOptional()).toBe('function');
    expect(typeof stubs.ValidateIf(() => true)).toBe('function');
    expect(typeof stubs.ValidateNested()).toBe('function');
    expect(typeof stubs.Equals('x')).toBe('function');
    expect(typeof stubs.NotEquals('x')).toBe('function');
    expect(typeof stubs.IsEmpty()).toBe('function');
    expect(typeof stubs.IsNotEmpty()).toBe('function');
    expect(typeof stubs.IsIn([1, 2])).toBe('function');
    expect(typeof stubs.IsNotIn([1, 2])).toBe('function');
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
