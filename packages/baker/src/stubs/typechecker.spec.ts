import { describe, it, expect } from 'bun:test';
import * as stubs from './typechecker';

const EXPECTED_EXPORTS = [
  'IsString', 'IsNumber', 'IsBoolean', 'IsDate',
  'IsEnum', 'IsInt', 'IsArray', 'IsObject',
] as const;

describe('stubs/typechecker', () => {
  it('should export all 8 stub functions', () => {
    for (const name of EXPECTED_EXPORTS) {
      expect(typeof (stubs as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('should return a PropertyDecorator when called with valid args', () => {
    expect(typeof stubs.IsString()).toBe('function');
    expect(typeof stubs.IsNumber()).toBe('function');
    expect(typeof stubs.IsBoolean()).toBe('function');
    expect(typeof stubs.IsDate()).toBe('function');
    expect(typeof stubs.IsEnum({ A: 'a' })).toBe('function');
    expect(typeof stubs.IsInt()).toBe('function');
    expect(typeof stubs.IsArray()).toBe('function');
    expect(typeof stubs.IsObject()).toBe('function');
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
