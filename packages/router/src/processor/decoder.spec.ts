import { describe, it, expect } from 'bun:test';

import { buildDecoder } from './decoder';

describe('buildDecoder', () => {
  it('should decode percent-encoded characters', () => {
    const decode = buildDecoder();
    expect(decode('hello%20world')).toBe('hello world');
  });

  it('should return raw string when segment has no percent sign (fast path)', () => {
    const decode = buildDecoder();
    expect(decode('plainpath')).toBe('plainpath');
  });

  it('should return raw string (not error) on invalid percent encoding', () => {
    const decode = buildDecoder();
    expect(decode('%ZZ')).toBe('%ZZ');
  });

  it('should decode %2F to / in param values', () => {
    const decode = buildDecoder();
    expect(decode('a%2Fb')).toBe('a/b');
  });

  it('should decode multiple percent-encoded chars', () => {
    const decode = buildDecoder();
    expect(decode('%E4%B8%AD%E6%96%87')).toBe('中文');
  });
});
