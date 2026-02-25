import { describe, it, expect } from 'bun:test';

import { ProcessorContext } from '../context';
import { resolveDotSegments } from './dot-segments';

describe('resolveDotSegments', () => {
  it('should remove single dot segments from the path', () => {
    const ctx = new ProcessorContext({});
    ctx.segments = ['a', '.', 'b'];
    resolveDotSegments(ctx);

    expect(ctx.segments).toEqual(['a', 'b']);
  });

  it('should resolve double dot by going up one level', () => {
    const ctx = new ProcessorContext({});
    ctx.segments = ['a', 'b', '..', 'c'];
    resolveDotSegments(ctx);

    expect(ctx.segments).toEqual(['a', 'c']);
  });

  it('should not underflow when double dot is at root level', () => {
    const ctx = new ProcessorContext({});
    ctx.segments = ['..', 'a'];
    resolveDotSegments(ctx);

    expect(ctx.segments).toEqual(['a']);
  });

  it('should resolve mixed dot types and normal segments correctly', () => {
    const ctx = new ProcessorContext({});
    ctx.segments = ['a', 'b', '.', '..', 'c'];
    resolveDotSegments(ctx);

    expect(ctx.segments).toEqual(['a', 'c']);
  });

  it('should treat URL-encoded %2e as single dot', () => {
    const ctx = new ProcessorContext({});
    ctx.segments = ['a', '%2e', 'b'];
    resolveDotSegments(ctx);

    expect(ctx.segments).toEqual(['a', 'b']);
  });

  it('should treat URL-encoded %2e%2e as double dot', () => {
    const ctx = new ProcessorContext({});
    ctx.segments = ['a', '%2e%2e', 'b'];
    resolveDotSegments(ctx);

    expect(ctx.segments).toEqual(['b']);
  });

  it('should handle alternating double dot and normal segments', () => {
    const ctx = new ProcessorContext({});
    ctx.segments = ['a', '..', 'b', '..', 'c'];
    resolveDotSegments(ctx);

    expect(ctx.segments).toEqual(['c']);
  });
});
