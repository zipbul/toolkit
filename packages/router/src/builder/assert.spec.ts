import { describe, it, expect } from 'bun:test';
import { assertDefined } from './assert';

describe('assertDefined', () => {
  it('should not throw when value is defined', () => {
    expect(() => assertDefined('hello', 'should not throw')).not.toThrow();
  });

  it('should throw with given message when value is undefined', () => {
    expect(() => assertDefined(undefined, 'invariant violated')).toThrow('invariant violated');
  });

  it('should not throw when value is 0 (falsy but defined)', () => {
    expect(() => assertDefined(0 as number | undefined, 'should not throw')).not.toThrow();
  });
});
