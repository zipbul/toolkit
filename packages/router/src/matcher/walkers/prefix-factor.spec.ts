import { describe, expect, it } from 'bun:test';

import { consumeFixedPrefix, scanSegmentEnd } from './prefix-factor';

describe('consumeFixedPrefix', () => {
  it('returns the position after every prefix segment is consumed', () => {
    expect(consumeFixedPrefix(['users'], 1, '/users/42', 1, 9)).toBe(7);
  });

  it('returns -1 on prefix mismatch', () => {
    expect(consumeFixedPrefix(['users'], 1, '/admin', 1, 6)).toBe(-1);
  });

  it('returns -1 when a prefix segment overruns the URL', () => {
    expect(consumeFixedPrefix(['users'], 1, '/u', 1, 2)).toBe(-1);
  });

  it('handles a zero-length prefix array as a no-op', () => {
    expect(consumeFixedPrefix([], 0, '/x', 5, 2)).toBe(5);
  });
});

describe('scanSegmentEnd', () => {
  it('returns the index of the next `/`', () => {
    expect(scanSegmentEnd('/a/b/c', 1, 6)).toBe(2);
  });

  it('returns `len` when no `/` is found before end-of-URL', () => {
    expect(scanSegmentEnd('/abc', 1, 4)).toBe(4);
  });

  it('returns `pos` for an empty segment when `pos` already points at `/`', () => {
    expect(scanSegmentEnd('/a//b', 2, 5)).toBe(2);
  });
});
