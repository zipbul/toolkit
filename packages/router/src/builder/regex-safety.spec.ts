import { describe, it, expect } from 'bun:test';

import { assessRegexSafety } from './regex-safety';

describe('assessRegexSafety', () => {
  // ── Basic safe/unsafe ──

  it('should return safe=true for a simple safe pattern', () => {
    const result = assessRegexSafety('\\d+');

    expect(result.safe).toBe(true);
  });

  // ── Backreferences ──

  it('should reject numeric backreference', () => {
    const result = assessRegexSafety('(\\w+)\\1');

    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Backreferences');
  });

  it('should reject named backreference', () => {
    const result = assessRegexSafety('(?<word>\\w+)\\k<word>');

    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Backreferences');
  });

  // ── Nested unlimited quantifiers (* / +) ──

  it('should reject nested unlimited quantifiers (a+)+', () => {
    const result = assessRegexSafety('(a+)+');

    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Nested unlimited');
  });

  it('should reject nested unlimited quantifiers (a*)*', () => {
    const result = assessRegexSafety('(a*)*');

    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Nested unlimited');
  });

  it('should allow single quantifier (not nested)', () => {
    const result = assessRegexSafety('a+b+');

    expect(result.safe).toBe(true);
  });

  // ── Character class handling (skipCharClass) ──

  it('should treat character class as single atom', () => {
    const result = assessRegexSafety('[abc]+');

    expect(result.safe).toBe(true);
  });

  it('should handle escape inside character class', () => {
    const result = assessRegexSafety('[a\\]b]+');

    expect(result.safe).toBe(true);
  });

  it('should handle unclosed character class', () => {
    const result = assessRegexSafety('[abc');

    expect(result.safe).toBe(true);
  });

  it('should handle character class with range', () => {
    const result = assessRegexSafety('[a-z]+[0-9]+');

    expect(result.safe).toBe(true);
  });

  it('should detect nested unlimited through character class: ([a-z]+)*', () => {
    const result = assessRegexSafety('([a-z]+)*');

    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Nested unlimited');
  });

  // ── Curly brace quantifiers ──

  it('should detect nested unlimited with {n,} quantifier: (a{1,})+', () => {
    const result = assessRegexSafety('(a{1,})+');

    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Nested unlimited');
  });

  it('should detect consecutive unlimited curly braces: a{1,}{1,}', () => {
    const result = assessRegexSafety('a{1,}{1,}');

    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Nested unlimited');
  });

  it('should treat {n} (fixed) quantifier as non-unlimited', () => {
    const result = assessRegexSafety('a{3}b+');

    expect(result.safe).toBe(true);
  });

  it('should handle unclosed curly brace as literal', () => {
    const result = assessRegexSafety('a{b+');

    expect(result.safe).toBe(true);
  });

  it('should detect {n,m} as unlimited quantifier', () => {
    const result = assessRegexSafety('(a{1,3})+');

    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Nested unlimited');
  });

  // ── Group nesting with stack propagation ──

  it('inner group with unlimited that has no outer quantifier is still safe', () => {
    const result = assessRegexSafety('((a+)b)');

    expect(result.safe).toBe(true);
  });

  it('should detect deeply nested unlimited: ((a+)+)', () => {
    const result = assessRegexSafety('((a+)+)');

    expect(result.safe).toBe(false);
  });

  it('should detect triple nested with propagation: ((a+)+)+', () => {
    const result = assessRegexSafety('((a+)+)+');

    expect(result.safe).toBe(false);
  });

  // ── Escape handling in main loop ──

  it('should skip escaped characters in main pattern', () => {
    const result = assessRegexSafety('\\(\\)+');

    expect(result.safe).toBe(true);
  });

  it('should handle escaped quantifier chars', () => {
    const result = assessRegexSafety('a\\+b+');

    expect(result.safe).toBe(true);
  });

  // ── Mixed scenarios ──

  it('should handle complex safe pattern: ^[a-z]{2,4}\\d+$', () => {
    const result = assessRegexSafety('^[a-z]{2,4}\\d+$');

    expect(result.safe).toBe(true);
  });

  it('should handle empty pattern', () => {
    const result = assessRegexSafety('');

    expect(result.safe).toBe(true);
  });

  it('should handle pattern with only a group: (a)', () => {
    const result = assessRegexSafety('(a)');

    expect(result.safe).toBe(true);
  });

  it('should handle alternation inside group: (a|b)+', () => {
    const result = assessRegexSafety('(a|b)+');

    expect(result.safe).toBe(true);
  });
});
