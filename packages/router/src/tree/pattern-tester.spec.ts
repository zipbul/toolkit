import { describe, it, expect } from 'bun:test';

import { buildPatternTester, TESTER_FAIL, TESTER_PASS } from './pattern-tester';

describe('buildPatternTester', () => {
  // ── Shortcut patterns (digit) ──

  it('should return PASS for digit string with digit shortcut', () => {
    const tester = buildPatternTester('\\d+', /^\d+$/);

    expect(tester('123')).toBe(TESTER_PASS);
  });

  it('should return FAIL for non-digit string with digit shortcut', () => {
    const tester = buildPatternTester('\\d+', /^\d+$/);

    expect(tester('abc')).toBe(TESTER_FAIL);
  });

  it('should return FAIL for empty string with digit shortcut', () => {
    const tester = buildPatternTester('\\d+', /^\d+$/);

    expect(tester('')).toBe(TESTER_FAIL);
  });

  it('should match \\d{1,} as digit shortcut', () => {
    const tester = buildPatternTester('\\d{1,}', /^\d{1,}$/);

    expect(tester('99')).toBe(TESTER_PASS);
    expect(tester('abc')).toBe(TESTER_FAIL);
  });

  it('should match [0-9]+ as digit shortcut', () => {
    const tester = buildPatternTester('[0-9]+', /^[0-9]+$/);

    expect(tester('42')).toBe(TESTER_PASS);
    expect(tester('xx')).toBe(TESTER_FAIL);
  });

  it('should match [0-9]{1,} as digit shortcut', () => {
    const tester = buildPatternTester('[0-9]{1,}', /^[0-9]{1,}$/);

    expect(tester('7')).toBe(TESTER_PASS);
    expect(tester('')).toBe(TESTER_FAIL);
  });

  // ── Shortcut patterns (alpha) ──

  it('should return PASS for alpha string with alpha shortcut', () => {
    const tester = buildPatternTester('[a-zA-Z]+', /^[a-zA-Z]+$/);

    expect(tester('abc')).toBe(TESTER_PASS);
  });

  it('should return FAIL for digits with alpha shortcut', () => {
    const tester = buildPatternTester('[a-zA-Z]+', /^[a-zA-Z]+$/);

    expect(tester('123')).toBe(TESTER_FAIL);
  });

  it('should return FAIL for empty string with alpha shortcut', () => {
    const tester = buildPatternTester('[a-zA-Z]+', /^[a-zA-Z]+$/);

    expect(tester('')).toBe(TESTER_FAIL);
  });

  it('should match [A-Za-z]+ as alpha shortcut', () => {
    const tester = buildPatternTester('[A-Za-z]+', /^[A-Za-z]+$/);

    expect(tester('Hello')).toBe(TESTER_PASS);
    expect(tester('123')).toBe(TESTER_FAIL);
  });

  // ── Shortcut patterns (alphanumeric) ──

  it('should return PASS for alphanumeric with \\w+ shortcut', () => {
    const tester = buildPatternTester('\\w+', /^\w+$/);

    expect(tester('abc_123')).toBe(TESTER_PASS);
  });

  it('should return FAIL for empty string with \\w+ shortcut', () => {
    const tester = buildPatternTester('\\w+', /^\w+$/);

    expect(tester('')).toBe(TESTER_FAIL);
  });

  it('should reject special chars with \\w+ shortcut', () => {
    const tester = buildPatternTester('\\w+', /^\w+$/);

    expect(tester('abc@def')).toBe(TESTER_FAIL);
  });

  it('should accept dash and underscore with alphanum dash shortcut', () => {
    const tester = buildPatternTester('[A-Za-z0-9_-]+', /^[A-Za-z0-9_-]+$/);

    expect(tester('foo-bar_baz')).toBe(TESTER_PASS);
  });

  it('should match \\w{1,} as alphanum shortcut', () => {
    const tester = buildPatternTester('\\w{1,}', /^\w{1,}$/);

    expect(tester('test')).toBe(TESTER_PASS);
    expect(tester('')).toBe(TESTER_FAIL);
  });

  // ── [^/]+ shortcut ──

  it('should return PASS for non-slash string with [^/]+ shortcut', () => {
    const tester = buildPatternTester('[^/]+', /^[^/]+$/);

    expect(tester('hello')).toBe(TESTER_PASS);
  });

  it('should return FAIL for empty string with [^/]+ shortcut', () => {
    const tester = buildPatternTester('[^/]+', /^[^/]+$/);

    expect(tester('')).toBe(TESTER_FAIL);
  });

  it('should return FAIL for value containing slash with [^/]+ shortcut', () => {
    const tester = buildPatternTester('[^/]+', /^[^/]+$/);

    expect(tester('a/b')).toBe(TESTER_FAIL);
  });

  // ── Custom patterns (compiled.test()) ──

  it('should use compiled.test() for unknown custom pattern', () => {
    const tester = buildPatternTester('\\d{4}-\\d{2}-\\d{2}', /^\d{4}-\d{2}-\d{2}$/);

    expect(tester('2024-01-15')).toBe(TESTER_PASS);
    expect(tester('not-a-date')).toBe(TESTER_FAIL);
  });

  // (Dropped a unit test that exercised `buildPatternTester(undefined, …)`.
  // The production signature is `(source: string, compiled)` — callers
  // never pass undefined, so the prior shape was widening the type for a
  // case that didn't exist.)

  it('should use compiled.test() when source is empty string', () => {
    const tester = buildPatternTester('', /^.*$/);

    expect(tester('anything')).toBe(TESTER_PASS);
  });
});
