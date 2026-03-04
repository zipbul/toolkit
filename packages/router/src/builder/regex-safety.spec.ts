import { describe, it, expect } from 'bun:test';

import { assessRegexSafety } from './regex-safety';

const SAFE_CONFIG = {
  maxLength: 256,
  forbidBackreferences: true,
  forbidBacktrackingTokens: true,
};

describe('assessRegexSafety', () => {
  // ── Basic safe/unsafe ──

  it('should return safe=true for a simple safe pattern', () => {
    const result = assessRegexSafety('\\d+', SAFE_CONFIG);

    expect(result.safe).toBe(true);
  });

  it('should return safe=false when pattern exceeds maxLength', () => {
    const result = assessRegexSafety('a'.repeat(10), { ...SAFE_CONFIG, maxLength: 5 });

    expect(result.safe).toBe(false);
    expect(result.reason).toContain('exceeds limit');
  });

  // ── Backreferences ──

  it('should reject backreference when forbidBackreferences=true', () => {
    const result = assessRegexSafety('(\\w+)\\1', SAFE_CONFIG);

    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Backreferences');
  });

  it('should allow backreference when forbidBackreferences=false', () => {
    const result = assessRegexSafety('(\\w+)\\1', { ...SAFE_CONFIG, forbidBackreferences: false });

    expect(result.safe).toBe(true);
  });

  it('should reject named backreference', () => {
    const result = assessRegexSafety('(?<word>\\w+)\\k<word>', SAFE_CONFIG);

    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Backreferences');
  });

  // ── Nested unlimited quantifiers (* / +) ──

  it('should reject nested unlimited quantifiers (a+)+', () => {
    const result = assessRegexSafety('(a+)+', SAFE_CONFIG);

    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Nested unlimited');
  });

  it('should reject nested unlimited quantifiers (a*)*', () => {
    const result = assessRegexSafety('(a*)*', SAFE_CONFIG);

    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Nested unlimited');
  });

  it('should allow nested quantifiers when forbidBacktrackingTokens=false', () => {
    const result = assessRegexSafety('(a+)+', { ...SAFE_CONFIG, forbidBacktrackingTokens: false });

    expect(result.safe).toBe(true);
  });

  it('should allow single quantifier (not nested)', () => {
    const result = assessRegexSafety('a+b+', SAFE_CONFIG);

    expect(result.safe).toBe(true);
  });

  // ── Character class handling (skipCharClass) ──

  it('should treat character class as single atom', () => {
    const result = assessRegexSafety('[abc]+', SAFE_CONFIG);

    expect(result.safe).toBe(true);
  });

  it('should handle escape inside character class', () => {
    const result = assessRegexSafety('[a\\]b]+', SAFE_CONFIG);

    expect(result.safe).toBe(true);
  });

  it('should handle unclosed character class', () => {
    const result = assessRegexSafety('[abc', SAFE_CONFIG);

    expect(result.safe).toBe(true);
  });

  it('should handle character class with range', () => {
    const result = assessRegexSafety('[a-z]+[0-9]+', SAFE_CONFIG);

    expect(result.safe).toBe(true);
  });

  it('should detect nested unlimited through character class: ([a-z]+)*', () => {
    const result = assessRegexSafety('([a-z]+)*', SAFE_CONFIG);

    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Nested unlimited');
  });

  // ── Curly brace quantifiers ──

  it('should detect nested unlimited with {n,} quantifier: (a{1,})+', () => {
    const result = assessRegexSafety('(a{1,})+', SAFE_CONFIG);

    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Nested unlimited');
  });

  it('should detect consecutive unlimited curly braces: a{1,}{1,}', () => {
    const result = assessRegexSafety('a{1,}{1,}', SAFE_CONFIG);

    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Nested unlimited');
  });

  it('should treat {n} (fixed) quantifier as non-unlimited', () => {
    const result = assessRegexSafety('a{3}b+', SAFE_CONFIG);

    expect(result.safe).toBe(true);
  });

  it('should handle unclosed curly brace as literal', () => {
    const result = assessRegexSafety('a{b+', SAFE_CONFIG);

    expect(result.safe).toBe(true);
  });

  it('should detect {n,m} as unlimited quantifier', () => {
    const result = assessRegexSafety('(a{1,3})+', SAFE_CONFIG);

    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Nested unlimited');
  });

  it('should propagate unlimited through curly brace inside group to parent stack', () => {
    // (a{1,}) has hadUnlimited in the group; outer quantifier + triggers detection
    const result = assessRegexSafety('(a{1,})+', SAFE_CONFIG);

    expect(result.safe).toBe(false);
  });

  // ── Group nesting with stack propagation ──

  it('should propagate unlimited from inner group to parent group frame', () => {
    // ((a+)b) — inner group has unlimited, propagates hadUnlimited to outer frame
    const result = assessRegexSafety('((a+)b)', SAFE_CONFIG);

    expect(result.safe).toBe(true); // not nested — no second quantifier
  });

  it('should detect deeply nested unlimited: ((a+)+)', () => {
    const result = assessRegexSafety('((a+)+)', SAFE_CONFIG);

    expect(result.safe).toBe(false);
  });

  it('should detect triple nested with propagation: ((a+)+)+', () => {
    const result = assessRegexSafety('((a+)+)+', SAFE_CONFIG);

    expect(result.safe).toBe(false);
  });

  // ── Escape handling in main loop ──

  it('should skip escaped characters in main pattern', () => {
    const result = assessRegexSafety('\\(\\)+', SAFE_CONFIG);

    expect(result.safe).toBe(true);
  });

  it('should handle escaped quantifier chars', () => {
    const result = assessRegexSafety('a\\+b+', SAFE_CONFIG);

    expect(result.safe).toBe(true);
  });

  // ── Mixed scenarios ──

  it('should handle complex safe pattern: ^[a-z]{2,4}\\d+$', () => {
    const result = assessRegexSafety('^[a-z]{2,4}\\d+$', SAFE_CONFIG);

    expect(result.safe).toBe(true);
  });

  it('should handle empty pattern', () => {
    const result = assessRegexSafety('', SAFE_CONFIG);

    expect(result.safe).toBe(true);
  });

  it('should handle pattern with only a group: (a)', () => {
    const result = assessRegexSafety('(a)', SAFE_CONFIG);

    expect(result.safe).toBe(true);
  });

  it('should handle alternation inside group: (a|b)+', () => {
    const result = assessRegexSafety('(a|b)+', SAFE_CONFIG);

    expect(result.safe).toBe(true);
  });
});
