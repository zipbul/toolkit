import { describe, it, expect } from 'bun:test';

import { decoder } from './decoder';

describe('decoder', () => {
  it('should decode percent-encoded characters', () => {
    expect(decoder('hello%20world')).toBe('hello world');
  });

  it('should return raw string when segment has no percent sign (fast path)', () => {
    expect(decoder('plainpath')).toBe('plainpath');
  });

  it('should throw on invalid percent encoding (caller responsibility)', () => {
    expect(() => decoder('%ZZ')).toThrow();
  });

  it('should decode %2F to / in param values', () => {
    expect(decoder('a%2Fb')).toBe('a/b');
  });

  it('should decode multiple percent-encoded chars', () => {
    expect(decoder('%E4%B8%AD%E6%96%87')).toBe('中文');
  });
});
