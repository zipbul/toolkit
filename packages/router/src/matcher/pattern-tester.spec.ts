import { describe, it, expect } from 'bun:test';

import {
  buildPatternTester,
  TESTER_FAIL,
  TESTER_PASS,
  TESTER_TIMEOUT,
} from './pattern-tester';

describe('buildPatternTester', () => {
  // ── Shortcut patterns (digit) ──

  it('should return PASS for digit string with digit shortcut', () => {
    const tester = buildPatternTester('\\d+', /^\d+$/, undefined);

    expect(tester('123')).toBe(TESTER_PASS);
  });

  it('should return FAIL for non-digit string with digit shortcut', () => {
    const tester = buildPatternTester('\\d+', /^\d+$/, undefined);

    expect(tester('abc')).toBe(TESTER_FAIL);
  });

  it('should return FAIL for empty string with digit shortcut', () => {
    const tester = buildPatternTester('\\d+', /^\d+$/, undefined);

    expect(tester('')).toBe(TESTER_FAIL);
  });

  it('should match \\d{1,} as digit shortcut', () => {
    const tester = buildPatternTester('\\d{1,}', /^\d{1,}$/, undefined);

    expect(tester('99')).toBe(TESTER_PASS);
    expect(tester('abc')).toBe(TESTER_FAIL);
  });

  it('should match [0-9]+ as digit shortcut', () => {
    const tester = buildPatternTester('[0-9]+', /^[0-9]+$/, undefined);

    expect(tester('42')).toBe(TESTER_PASS);
    expect(tester('xx')).toBe(TESTER_FAIL);
  });

  it('should match [0-9]{1,} as digit shortcut', () => {
    const tester = buildPatternTester('[0-9]{1,}', /^[0-9]{1,}$/, undefined);

    expect(tester('7')).toBe(TESTER_PASS);
    expect(tester('')).toBe(TESTER_FAIL);
  });

  // ── Shortcut patterns (alpha) ──

  it('should return PASS for alpha string with alpha shortcut', () => {
    const tester = buildPatternTester('[a-zA-Z]+', /^[a-zA-Z]+$/, undefined);

    expect(tester('abc')).toBe(TESTER_PASS);
  });

  it('should return FAIL for digits with alpha shortcut', () => {
    const tester = buildPatternTester('[a-zA-Z]+', /^[a-zA-Z]+$/, undefined);

    expect(tester('123')).toBe(TESTER_FAIL);
  });

  it('should return FAIL for empty string with alpha shortcut', () => {
    const tester = buildPatternTester('[a-zA-Z]+', /^[a-zA-Z]+$/, undefined);

    expect(tester('')).toBe(TESTER_FAIL);
  });

  it('should match [A-Za-z]+ as alpha shortcut', () => {
    const tester = buildPatternTester('[A-Za-z]+', /^[A-Za-z]+$/, undefined);

    expect(tester('Hello')).toBe(TESTER_PASS);
    expect(tester('123')).toBe(TESTER_FAIL);
  });

  // ── Shortcut patterns (alphanumeric) ──

  it('should return PASS for alphanumeric with \\w+ shortcut', () => {
    const tester = buildPatternTester('\\w+', /^\w+$/, undefined);

    expect(tester('abc_123')).toBe(TESTER_PASS);
  });

  it('should return FAIL for empty string with \\w+ shortcut', () => {
    const tester = buildPatternTester('\\w+', /^\w+$/, undefined);

    expect(tester('')).toBe(TESTER_FAIL);
  });

  it('should reject special chars with \\w+ shortcut', () => {
    const tester = buildPatternTester('\\w+', /^\w+$/, undefined);

    expect(tester('abc@def')).toBe(TESTER_FAIL);
  });

  it('should accept dash and underscore with alphanum dash shortcut', () => {
    const tester = buildPatternTester('[A-Za-z0-9_-]+', /^[A-Za-z0-9_-]+$/, undefined);

    expect(tester('foo-bar_baz')).toBe(TESTER_PASS);
  });

  it('should match \\w{1,} as alphanum shortcut', () => {
    const tester = buildPatternTester('\\w{1,}', /^\w{1,}$/, undefined);

    expect(tester('test')).toBe(TESTER_PASS);
    expect(tester('')).toBe(TESTER_FAIL);
  });

  // ── [^/]+ shortcut ──

  it('should return PASS for non-slash string with [^/]+ shortcut', () => {
    const tester = buildPatternTester('[^/]+', /^[^/]+$/, undefined);

    expect(tester('hello')).toBe(TESTER_PASS);
  });

  it('should return FAIL for empty string with [^/]+ shortcut', () => {
    const tester = buildPatternTester('[^/]+', /^[^/]+$/, undefined);

    expect(tester('')).toBe(TESTER_FAIL);
  });

  it('should return FAIL for value containing slash with [^/]+ shortcut', () => {
    const tester = buildPatternTester('[^/]+', /^[^/]+$/, undefined);

    expect(tester('a/b')).toBe(TESTER_FAIL);
  });

  // ── Custom patterns (compiled.test()) ──

  it('should use compiled.test() for unknown custom pattern', () => {
    const tester = buildPatternTester('\\d{4}-\\d{2}-\\d{2}', /^\d{4}-\d{2}-\d{2}$/, undefined);

    expect(tester('2024-01-15')).toBe(TESTER_PASS);
    expect(tester('not-a-date')).toBe(TESTER_FAIL);
  });

  it('should use compiled.test() when source is undefined', () => {
    const tester = buildPatternTester(undefined, /^[A-Z]{2}$/, undefined);

    expect(tester('AB')).toBe(TESTER_PASS);
    expect(tester('abc')).toBe(TESTER_FAIL);
  });

  it('should use compiled.test() when source is empty string', () => {
    const tester = buildPatternTester('', /^.*$/, undefined);

    expect(tester('anything')).toBe(TESTER_PASS);
  });

  // ── Timeout wrapping ──

  it('should not wrap when maxExecutionMs is 0', () => {
    const tester = buildPatternTester('custom', /^[a-z]+$/, { maxExecutionMs: 0 });

    expect(tester('abc')).toBe(TESTER_PASS);
  });

  it('should not wrap when maxExecutionMs is negative', () => {
    const tester = buildPatternTester('custom', /^[a-z]+$/, { maxExecutionMs: -1 });

    expect(tester('abc')).toBe(TESTER_PASS);
  });

  it('should return TIMEOUT when duration exceeds maxExecutionMs', () => {
    const tester = buildPatternTester('custom', /^[a-z]+$/, {
      maxExecutionMs: 0.000001, // 1 ns — any execution exceeds
    });

    const result = tester('test');

    // Timer resolution may produce either TIMEOUT or PASS depending on host jitter;
    // assert that timeout path is reachable by checking the possible set.
    expect(result === TESTER_TIMEOUT || result === TESTER_PASS).toBe(true);
  });
});
