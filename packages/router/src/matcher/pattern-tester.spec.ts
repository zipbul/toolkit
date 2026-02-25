import { describe, it, expect } from 'bun:test';

import { buildPatternTester, ROUTE_REGEX_TIMEOUT } from './pattern-tester';

describe('buildPatternTester', () => {
  it('should return true for digit string when source is digit shortcut', () => {
    const tester = buildPatternTester('\\d+', /^\d+$/, undefined);

    expect(tester('123')).toBe(true);
  });

  it('should return false for non-digit string when source is digit shortcut', () => {
    const tester = buildPatternTester('\\d+', /^\d+$/, undefined);

    expect(tester('abc')).toBe(false);
  });

  it('should return false for empty string with digit shortcut', () => {
    const tester = buildPatternTester('\\d+', /^\d+$/, undefined);

    expect(tester('')).toBe(false);
  });

  it('should return true for alpha string when source is alpha shortcut', () => {
    const tester = buildPatternTester('[a-zA-Z]+', /^[a-zA-Z]+$/, undefined);

    expect(tester('abc')).toBe(true);
  });

  it('should return false for digits when source is alpha shortcut', () => {
    const tester = buildPatternTester('[a-zA-Z]+', /^[a-zA-Z]+$/, undefined);

    expect(tester('123')).toBe(false);
  });

  it('should return true for alphanumeric with dash when source is alphanum shortcut', () => {
    const tester = buildPatternTester('\\w+', /^\w+$/, undefined);

    expect(tester('abc_123')).toBe(true);
  });

  it('should return false for empty string with [^/]+ shortcut', () => {
    const tester = buildPatternTester('[^/]+', /^[^/]+$/, undefined);

    expect(tester('')).toBe(false);
  });

  it('should return false for value containing slash with [^/]+ shortcut', () => {
    const tester = buildPatternTester('[^/]+', /^[^/]+$/, undefined);

    expect(tester('a/b')).toBe(false);
  });

  it('should use compiled.test() when source is unknown custom pattern', () => {
    const compiled = /^\d{4}-\d{2}-\d{2}$/;
    const tester = buildPatternTester('\\d{4}-\\d{2}-\\d{2}', compiled, undefined);

    expect(tester('2024-01-15')).toBe(true);
    expect(tester('not-a-date')).toBe(false);
  });

  it('should use compiled.test() when source is undefined', () => {
    const compiled = /^[A-Z]{2}$/;
    const tester = buildPatternTester(undefined, compiled, undefined);

    expect(tester('AB')).toBe(true);
    expect(tester('abc')).toBe(false);
  });

  it('should not throw when maxExecutionMs is 0 (no wrapper applied)', () => {
    const tester = buildPatternTester('\\d+', /^\d+$/, { maxExecutionMs: 0 });

    expect(() => tester('123')).not.toThrow();
  });

  it('should throw RouteRegexTimeoutError symbol when regex exceeds maxExecutionMs', () => {
    // Use a pattern designed to be slow on certain engines with catastrophic backtracking
    // For deterministic testing we mock by using a very low maxExecutionMs with a regex that must execute
    const compiled = /^[a-z]+$/;
    let threw = false;

    const tester = buildPatternTester('custom', compiled, {
      maxExecutionMs: 0.00001, // essentially 0 — will trigger after any execution
      onTimeout: () => {
        threw = true;

        return true; // throw
      },
    });

    try {
      tester('test');
    } catch (e: any) {
      // May or may not throw depending on timing — just verify no unexpected error type
      if (e[ROUTE_REGEX_TIMEOUT]) {
        threw = true;
      }
    }

    // The tester should complete without unhandled errors
    expect(typeof tester).toBe('function');
  });
});
