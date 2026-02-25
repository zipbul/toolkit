import { describe, it, expect } from 'bun:test';
import { isErr } from '@zipbul/result';

import { buildDecoder } from './decoder';

describe('buildDecoder', () => {
  // behavior = 'preserve'
  it('should return raw string as-is when behavior is preserve', () => {
    const decode = buildDecoder('preserve', false);

    expect(decode('hello%20world')).toBe('hello%20world');
  });

  it('should return raw string without decoding when behavior is preserve and no percent sign', () => {
    const decode = buildDecoder('preserve', false);

    expect(decode('plainpath')).toBe('plainpath');
  });

  // behavior = 'decode' (default)
  it('should decode percent-encoded characters when behavior is decode', () => {
    const decode = buildDecoder('decode', false);
    const result = decode('hello%20world');

    expect(isErr(result)).toBe(false);
    expect(result).toBe('hello world');
  });

  it('should return raw string when segment has no percent sign (fast path)', () => {
    const decode = buildDecoder('decode', false);

    expect(decode('plainpath')).toBe('plainpath');
  });

  it('should return raw string (not error) on invalid percent encoding when failFast is false', () => {
    const decode = buildDecoder('decode', false);
    const result = decode('%ZZ');

    expect(isErr(result)).toBe(false);
    expect(result).toBe('%ZZ');
  });

  it('should return Err(encoding) on invalid percent encoding when failFast is true', () => {
    const decode = buildDecoder('decode', true);
    const result = decode('%ZZ');

    expect(isErr(result)).toBe(true);
    expect((result as any).data.kind).toBe('encoding');
  });

  // behavior = 'reject'
  it('should return Err(encoded-slash) when segment contains %2F and behavior is reject', () => {
    const decode = buildDecoder('reject', false);
    const result = decode('path%2Fsegment');

    expect(isErr(result)).toBe(true);
    expect((result as any).data.kind).toBe('encoded-slash');
  });

  it('should return Err(encoded-slash) for lowercase %2f when behavior is reject', () => {
    const decode = buildDecoder('reject', false);
    const result = decode('path%2fsegment');

    expect(isErr(result)).toBe(true);
    expect((result as any).data.kind).toBe('encoded-slash');
  });

  it('should decode non-slash encoded chars when behavior is reject and no %2F present', () => {
    const decode = buildDecoder('reject', false);
    const result = decode('hello%20world');

    expect(isErr(result)).toBe(false);
    expect(result).toBe('hello world');
  });

  it('should return raw on bad encoding when behavior is reject and failFast is false', () => {
    const decode = buildDecoder('reject', false);
    const result = decode('%ZZ');

    expect(isErr(result)).toBe(false);
    expect(result).toBe('%ZZ');
  });

  it('should return Err(encoding) on bad encoding when behavior is reject and failFast is true', () => {
    const decode = buildDecoder('reject', true);
    const result = decode('%ZZ');

    expect(isErr(result)).toBe(true);
    expect((result as any).data.kind).toBe('encoding');
  });
});
