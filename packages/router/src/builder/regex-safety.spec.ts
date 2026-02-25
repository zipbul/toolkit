import { describe, it, expect } from 'bun:test';

import { assessRegexSafety } from './regex-safety';

describe('assessRegexSafety', () => {
  it('should return safe=true for a simple safe pattern', () => {
    const result = assessRegexSafety('\\d+', {
      maxLength: 256,
      forbidBackreferences: true,
      forbidBacktrackingTokens: true,
    });

    expect(result.safe).toBe(true);
  });

  it('should return safe=false when pattern exceeds maxLength', () => {
    const long = 'a'.repeat(10);
    const result = assessRegexSafety(long, {
      maxLength: 5,
      forbidBackreferences: true,
      forbidBacktrackingTokens: true,
    });

    expect(result.safe).toBe(false);
    expect(result.reason).toContain('exceeds limit');
  });

  it('should return safe=false when pattern contains backreference and forbidBackreferences=true', () => {
    const result = assessRegexSafety('(\\w+)\\1', {
      maxLength: 256,
      forbidBackreferences: true,
      forbidBacktrackingTokens: true,
    });

    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Backreferences');
  });

  it('should return safe=true for backreference when forbidBackreferences=false', () => {
    const result = assessRegexSafety('(\\w+)\\1', {
      maxLength: 256,
      forbidBackreferences: false,
      forbidBacktrackingTokens: true,
    });

    expect(result.safe).toBe(true);
  });

  it('should return safe=false for nested unlimited quantifiers when forbidBacktrackingTokens=true', () => {
    const result = assessRegexSafety('(a+)+', {
      maxLength: 256,
      forbidBackreferences: true,
      forbidBacktrackingTokens: true,
    });

    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Nested unlimited');
  });

  it('should return safe=true for nested quantifier when forbidBacktrackingTokens=false', () => {
    const result = assessRegexSafety('(a+)+', {
      maxLength: 256,
      forbidBackreferences: true,
      forbidBacktrackingTokens: false,
    });

    expect(result.safe).toBe(true);
  });
});
