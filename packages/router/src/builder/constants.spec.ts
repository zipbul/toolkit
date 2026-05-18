/**
 * Unit specs for `constants.ts` — pin the regex patterns and char-code
 * values so a typo in a hot-path comparison surfaces as a single test
 * failure here instead of silent miss-matches downstream.
 */
import { describe, expect, it } from 'bun:test';

import { CC_COLON, CC_PLUS, CC_SLASH, CC_STAR, END_ANCHOR_PATTERN, START_ANCHOR_PATTERN } from './constants';

describe('regex anchor patterns', () => {
  it('START_ANCHOR_PATTERN matches a literal leading ^', () => {
    expect(START_ANCHOR_PATTERN.test('^abc')).toBe(true);
    expect(START_ANCHOR_PATTERN.test('abc')).toBe(false);
    expect(START_ANCHOR_PATTERN.test('a^')).toBe(false);
  });

  it('END_ANCHOR_PATTERN matches a literal trailing $', () => {
    expect(END_ANCHOR_PATTERN.test('abc$')).toBe(true);
    expect(END_ANCHOR_PATTERN.test('abc')).toBe(false);
    expect(END_ANCHOR_PATTERN.test('$abc')).toBe(false);
  });
});

describe('path-syntax char codes mirror ASCII', () => {
  it('CC_SLASH === 47 (forward slash)', () => {
    expect(CC_SLASH).toBe(47);
    expect('/'.charCodeAt(0)).toBe(CC_SLASH);
  });

  it('CC_STAR === 42 (asterisk)', () => {
    expect(CC_STAR).toBe(42);
    expect('*'.charCodeAt(0)).toBe(CC_STAR);
  });

  it('CC_PLUS === 43 (plus sign)', () => {
    expect(CC_PLUS).toBe(43);
    expect('+'.charCodeAt(0)).toBe(CC_PLUS);
  });

  it('CC_COLON === 58 (colon)', () => {
    expect(CC_COLON).toBe(58);
    expect(':'.charCodeAt(0)).toBe(CC_COLON);
  });
});
