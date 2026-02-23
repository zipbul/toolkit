import { describe, it, expect } from 'bun:test';
import * as stubs from './locales';

const EXPECTED_EXPORTS = [
  'IsMobilePhone', 'IsPostalCode', 'IsIdentityCard', 'IsPassportNumber',
] as const;

describe('stubs/locales', () => {
  it('should export all 4 stub functions', () => {
    for (const name of EXPECTED_EXPORTS) {
      expect(typeof (stubs as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('should return a PropertyDecorator when called with valid args', () => {
    expect(typeof stubs.IsMobilePhone('ko-KR')).toBe('function');
    expect(typeof stubs.IsPostalCode('KR')).toBe('function');
    expect(typeof stubs.IsIdentityCard('KR')).toBe('function');
    expect(typeof stubs.IsPassportNumber('KR')).toBe('function');
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
