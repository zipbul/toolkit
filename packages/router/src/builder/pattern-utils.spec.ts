import { describe, it, expect } from 'bun:test';

import { normalizeParamPatternSource } from './pattern-utils';

describe('normalizeParamPatternSource', () => {
  it('returns clean pattern unchanged when no anchors are present', () => {
    expect(normalizeParamPatternSource('\\d+')).toBe('\\d+');
  });

  it('rejects leading ^ anchor', () => {
    const result = normalizeParamPatternSource('^\\d+');
    expect(typeof result).toBe('object');
    if (typeof result !== 'string') expect(result.reason).toBe('anchor');
  });

  it('rejects trailing $ anchor', () => {
    const result = normalizeParamPatternSource('\\d+$');
    expect(typeof result).toBe('object');
    if (typeof result !== 'string') expect(result.reason).toBe('anchor');
  });

  it('rejects both anchors', () => {
    const result = normalizeParamPatternSource('^\\d+$');
    expect(typeof result).toBe('object');
    if (typeof result !== 'string') expect(result.reason).toBe('anchor');
  });

  it('rejects pattern with only anchors', () => {
    const result = normalizeParamPatternSource('^$');
    expect(typeof result).toBe('object');
  });

  it('trims surrounding whitespace from acceptable patterns', () => {
    expect(normalizeParamPatternSource('  \\d+  ')).toBe('\\d+');
  });
});
