import { describe, it, expect } from 'bun:test';

import { normalizeParamPatternSource } from './pattern-utils';

describe('normalizeParamPatternSource', () => {
  it('returns clean pattern unchanged when no anchors are present', () => {
    expect(normalizeParamPatternSource('\\d+')).toBe('\\d+');
  });

  it('strips leading ^ anchor silently', () => {
    expect(normalizeParamPatternSource('^\\d+')).toBe('\\d+');
  });

  it('strips trailing $ anchor silently', () => {
    expect(normalizeParamPatternSource('\\d+$')).toBe('\\d+');
  });

  it('strips both anchors silently', () => {
    expect(normalizeParamPatternSource('^\\d+$')).toBe('\\d+');
  });

  it('normalizes pattern with only anchors to .*', () => {
    expect(normalizeParamPatternSource('^$')).toBe('.*');
  });

  it('falls back to .* on whitespace-only input (defensive)', () => {
    expect(normalizeParamPatternSource('   ')).toBe('.*');
  });
});
