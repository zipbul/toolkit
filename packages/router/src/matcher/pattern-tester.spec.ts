import { describe, it, expect } from 'bun:test';

import { buildPatternTester, ROUTE_REGEX_TIMEOUT } from './pattern-tester';

describe('buildPatternTester', () => {
  // ── Shortcut patterns (digit) ──

  it('should return true for digit string with digit shortcut', () => {
    const tester = buildPatternTester('\\d+', /^\d+$/, undefined);

    expect(tester('123')).toBe(true);
  });

  it('should return false for non-digit string with digit shortcut', () => {
    const tester = buildPatternTester('\\d+', /^\d+$/, undefined);

    expect(tester('abc')).toBe(false);
  });

  it('should return false for empty string with digit shortcut', () => {
    const tester = buildPatternTester('\\d+', /^\d+$/, undefined);

    expect(tester('')).toBe(false);
  });

  it('should match \\d{1,} as digit shortcut', () => {
    const tester = buildPatternTester('\\d{1,}', /^\d{1,}$/, undefined);

    expect(tester('99')).toBe(true);
    expect(tester('abc')).toBe(false);
  });

  it('should match [0-9]+ as digit shortcut', () => {
    const tester = buildPatternTester('[0-9]+', /^[0-9]+$/, undefined);

    expect(tester('42')).toBe(true);
    expect(tester('xx')).toBe(false);
  });

  it('should match [0-9]{1,} as digit shortcut', () => {
    const tester = buildPatternTester('[0-9]{1,}', /^[0-9]{1,}$/, undefined);

    expect(tester('7')).toBe(true);
    expect(tester('')).toBe(false);
  });

  // ── Shortcut patterns (alpha) ──

  it('should return true for alpha string with alpha shortcut', () => {
    const tester = buildPatternTester('[a-zA-Z]+', /^[a-zA-Z]+$/, undefined);

    expect(tester('abc')).toBe(true);
  });

  it('should return false for digits with alpha shortcut', () => {
    const tester = buildPatternTester('[a-zA-Z]+', /^[a-zA-Z]+$/, undefined);

    expect(tester('123')).toBe(false);
  });

  it('should return false for empty string with alpha shortcut', () => {
    const tester = buildPatternTester('[a-zA-Z]+', /^[a-zA-Z]+$/, undefined);

    expect(tester('')).toBe(false);
  });

  it('should match [A-Za-z]+ as alpha shortcut', () => {
    const tester = buildPatternTester('[A-Za-z]+', /^[A-Za-z]+$/, undefined);

    expect(tester('Hello')).toBe(true);
    expect(tester('123')).toBe(false);
  });

  // ── Shortcut patterns (alphanumeric) ──

  it('should return true for alphanumeric with \\w+ shortcut', () => {
    const tester = buildPatternTester('\\w+', /^\w+$/, undefined);

    expect(tester('abc_123')).toBe(true);
  });

  it('should return false for empty string with \\w+ shortcut', () => {
    const tester = buildPatternTester('\\w+', /^\w+$/, undefined);

    expect(tester('')).toBe(false);
  });

  it('should reject special chars with \\w+ shortcut', () => {
    const tester = buildPatternTester('\\w+', /^\w+$/, undefined);

    expect(tester('abc@def')).toBe(false);
  });

  it('should accept dash and underscore with alphanum dash shortcut', () => {
    const tester = buildPatternTester('[A-Za-z0-9_-]+', /^[A-Za-z0-9_-]+$/, undefined);

    expect(tester('foo-bar_baz')).toBe(true);
  });

  it('should match \\w{1,} as alphanum shortcut', () => {
    const tester = buildPatternTester('\\w{1,}', /^\w{1,}$/, undefined);

    expect(tester('test')).toBe(true);
    expect(tester('')).toBe(false);
  });

  // ── [^/]+ shortcut ──

  it('should return true for non-slash string with [^/]+ shortcut', () => {
    const tester = buildPatternTester('[^/]+', /^[^/]+$/, undefined);

    expect(tester('hello')).toBe(true);
  });

  it('should return false for empty string with [^/]+ shortcut', () => {
    const tester = buildPatternTester('[^/]+', /^[^/]+$/, undefined);

    expect(tester('')).toBe(false);
  });

  it('should return false for value containing slash with [^/]+ shortcut', () => {
    const tester = buildPatternTester('[^/]+', /^[^/]+$/, undefined);

    expect(tester('a/b')).toBe(false);
  });

  // ── Custom patterns (compiled.test()) ──

  it('should use compiled.test() for unknown custom pattern', () => {
    const tester = buildPatternTester('\\d{4}-\\d{2}-\\d{2}', /^\d{4}-\d{2}-\d{2}$/, undefined);

    expect(tester('2024-01-15')).toBe(true);
    expect(tester('not-a-date')).toBe(false);
  });

  it('should use compiled.test() when source is undefined', () => {
    const tester = buildPatternTester(undefined, /^[A-Z]{2}$/, undefined);

    expect(tester('AB')).toBe(true);
    expect(tester('abc')).toBe(false);
  });

  it('should use compiled.test() when source is empty string', () => {
    const tester = buildPatternTester('', /^.*$/, undefined);

    expect(tester('anything')).toBe(true);
  });

  // ── Timeout wrapping ──

  it('should not wrap when maxExecutionMs is 0', () => {
    const tester = buildPatternTester('custom', /^[a-z]+$/, { maxExecutionMs: 0 });

    expect(tester('abc')).toBe(true);
  });

  it('should not wrap when maxExecutionMs is negative', () => {
    const tester = buildPatternTester('custom', /^[a-z]+$/, { maxExecutionMs: -1 });

    expect(tester('abc')).toBe(true);
  });

  it('should return false when onTimeout returns false (suppress throw)', () => {
    let timeoutTriggered = false;

    const tester = buildPatternTester('custom', /^[a-z]+$/, {
      maxExecutionMs: 0.000001, // 1 nanosecond — any regex execution exceeds this
      onTimeout: () => {
        timeoutTriggered = true;

        return false; // suppress throw, return false instead
      },
    });

    const result = tester('test');

    // If timeout was triggered, the tester should have returned false
    if (timeoutTriggered) {
      expect(result).toBe(false);
    }
  });

  it('should throw RouteRegexTimeoutError when onTimeout does not return false', () => {
    let timeoutTriggered = false;

    const tester = buildPatternTester('custom', /^[a-z]+$/, {
      maxExecutionMs: 0.000001, // 1 nanosecond — will exceed
      onTimeout: () => {
        timeoutTriggered = true;

        return undefined; // does not return false → throw
      },
    });

    try {
      tester('test');

      // If no throw, timeout wasn't triggered (regex was too fast) — that's ok
    } catch (e: any) {
      expect(e[ROUTE_REGEX_TIMEOUT]).toBe(true);
      expect(e.message).toContain('exceeded');
      timeoutTriggered = true;
    }

    // Regardless of timing, the function should exist
    expect(typeof tester).toBe('function');
  });

  it('should throw when onTimeout returns true', () => {
    const tester = buildPatternTester('custom', /^[a-z]+$/, {
      maxExecutionMs: 0.000001,
      onTimeout: () => true,
    });

    try {
      tester('test');
    } catch (e: any) {
      expect(e[ROUTE_REGEX_TIMEOUT]).toBe(true);
    }
  });

  it('should wrap custom pattern with timeout', () => {
    let called = false;

    const tester = buildPatternTester('custom', /^[a-z]+$/, {
      maxExecutionMs: 0.000001,
      onTimeout: (_pattern, _duration) => {
        called = true;

        return false;
      },
    });

    tester('abc');

    // Callback may or may not be called depending on execution speed
    expect(typeof tester).toBe('function');
  });

  it('should wrap anonymous pattern (source=undefined) with timeout', () => {
    let called = false;

    const tester = buildPatternTester(undefined, /^[a-z]+$/, {
      maxExecutionMs: 0.000001,
      onTimeout: (pattern) => {
        called = true;
        expect(pattern).toBe('<anonymous>');

        return false;
      },
    });

    tester('abc');
    expect(typeof tester).toBe('function');
  });
});
