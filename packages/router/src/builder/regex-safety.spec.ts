import { describe, it, expect } from 'bun:test';

import {
  assessRegexSafety,
  closeGroup,
  markTopFrameUnlimited,
  parseBracedQuantifier,
  type QuantifierFrame,
} from './regex-safety';

// Capturing groups `(...)`, named captures `(?<name>...)`, lookaround
// `(?=...)/(?!...)/(?<=...)/(?<!...)`, and inline-flag groups `(?i)/(?m)/(?s)`
// are all rejected by the group-construct whitelist. The structural
// hazard checks (backref, nested unlimited quantifier, overlapping
// alternation under repeat) run *after* the whitelist, so all fixtures
// that test them use `(?:...)` non-capturing groups.

describe('assessRegexSafety', () => {
  // ── Basic safe/unsafe ──

  it('should return safe=true for a simple safe pattern', () => {
    const result = assessRegexSafety('\\d+');

    expect(result.safe).toBe(true);
  });

  // ── Group construct whitelist ──

  it('rejects bare capturing group `(a)`', () => {
    const result = assessRegexSafety('(a)');

    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Capturing groups');
  });

  it('rejects named capture `(?<x>a)`', () => {
    const result = assessRegexSafety('(?<x>a)');

    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Named capture');
  });

  it('rejects lookahead `(?=a)`', () => {
    const result = assessRegexSafety('(?=a)');

    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Lookahead');
  });

  it('rejects negative lookahead `(?!a)`', () => {
    const result = assessRegexSafety('(?!a)');

    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Lookahead');
  });

  it('rejects lookbehind `(?<=a)`', () => {
    const result = assessRegexSafety('(?<=a)');

    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Lookbehind');
  });

  it('rejects negative lookbehind `(?<!a)`', () => {
    const result = assessRegexSafety('(?<!a)');

    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Lookbehind');
  });

  it('rejects inline flag `(?i)abc`', () => {
    const result = assessRegexSafety('(?i)abc');

    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Inline flag');
  });

  it('accepts non-capturing group `(?:a)`', () => {
    const result = assessRegexSafety('(?:a)');

    expect(result.safe).toBe(true);
  });

  // ── Backreferences ──

  it('should reject numeric backreference', () => {
    const result = assessRegexSafety('(?:\\w+)\\1');

    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Backreferences');
  });

  // ── Nested unlimited quantifiers (* / +) ──

  it('should reject nested unlimited quantifiers (?:a+)+', () => {
    const result = assessRegexSafety('(?:a+)+');

    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Nested unlimited');
  });

  it('should reject nested unlimited quantifiers (?:a*)*', () => {
    const result = assessRegexSafety('(?:a*)*');

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

  it('should detect nested unlimited through character class: (?:[a-z]+)*', () => {
    const result = assessRegexSafety('(?:[a-z]+)*');

    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Nested unlimited');
  });

  // ── Curly brace quantifiers ──

  it('should detect nested unlimited with {n,} quantifier: (?:a{1,})+', () => {
    const result = assessRegexSafety('(?:a{1,})+');

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
    const result = assessRegexSafety('(?:a{1,3})+');

    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Nested unlimited');
  });

  // ── Group nesting with stack propagation ──

  it('inner group with unlimited that has no outer quantifier is still safe', () => {
    const result = assessRegexSafety('(?:(?:a+)b)');

    expect(result.safe).toBe(true);
  });

  it('should detect deeply nested unlimited: (?:(?:a+)+)', () => {
    const result = assessRegexSafety('(?:(?:a+)+)');

    expect(result.safe).toBe(false);
  });

  it('should detect triple nested with propagation: (?:(?:a+)+)+', () => {
    const result = assessRegexSafety('(?:(?:a+)+)+');

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

  it('should handle non-capturing group with alternation: (?:a|b)+', () => {
    const result = assessRegexSafety('(?:a|b)+');

    expect(result.safe).toBe(true);
  });
});

// ─── Internal helpers (exported for test) ────────────────────────────

describe('parseBracedQuantifier', () => {
  it('returns unlimited=false for `{m}`', () => {
    expect(parseBracedQuantifier('a{3}', 1)).toEqual({ unlimited: false, closeIdx: 3 });
  });

  it('returns unlimited=true for `{m,n}`', () => {
    expect(parseBracedQuantifier('a{2,5}', 1)).toEqual({ unlimited: true, closeIdx: 5 });
  });

  it('returns unlimited=true for `{m,}` (open upper bound)', () => {
    expect(parseBracedQuantifier('a{2,}', 1)).toEqual({ unlimited: true, closeIdx: 4 });
  });

  it('returns null for unterminated brace', () => {
    expect(parseBracedQuantifier('a{2', 1)).toBeNull();
  });

  it('handles empty body `{}` as bounded', () => {
    expect(parseBracedQuantifier('a{}', 1)).toEqual({ unlimited: false, closeIdx: 2 });
  });
});

describe('markTopFrameUnlimited', () => {
  it('is a no-op on an empty stack', () => {
    const stack: QuantifierFrame[] = [];
    markTopFrameUnlimited(stack);
    expect(stack).toEqual([]);
  });

  it('marks the innermost frame as unlimited', () => {
    const outer: QuantifierFrame = { hadUnlimited: false };
    const inner: QuantifierFrame = { hadUnlimited: false };
    markTopFrameUnlimited([outer, inner]);
    expect(inner.hadUnlimited).toBe(true);
    expect(outer.hadUnlimited).toBe(false);
  });
});

describe('closeGroup', () => {
  it('returns false when the popped group had no unlimited quantifier', () => {
    const stack: QuantifierFrame[] = [{ hadUnlimited: false }];
    expect(closeGroup(stack)).toBe(false);
    expect(stack.length).toBe(0);
  });

  it('returns true and propagates `hadUnlimited` to the parent frame', () => {
    const parent: QuantifierFrame = { hadUnlimited: false };
    const child: QuantifierFrame = { hadUnlimited: true };
    const stack = [parent, child];

    expect(closeGroup(stack)).toBe(true);
    expect(parent.hadUnlimited).toBe(true);
    expect(stack).toEqual([parent]);
  });

  it('returns true at root depth without throwing (no parent to propagate to)', () => {
    const stack: QuantifierFrame[] = [{ hadUnlimited: true }];
    expect(closeGroup(stack)).toBe(true);
    expect(stack).toEqual([]);
  });
});
