import { describe, it, expect } from 'bun:test';

import { ProcessorContext } from './context';

describe('ProcessorContext', () => {
  it('should initialize path to empty string on construction', () => {
    const ctx = new ProcessorContext({ maxSegmentLength: 256 });

    expect(ctx.path).toBe('');
  });

  it('should initialize segments to empty array on construction', () => {
    const ctx = new ProcessorContext({});

    expect(ctx.segments).toEqual([]);
  });

  it('should set path to given value on reset', () => {
    const ctx = new ProcessorContext({});
    ctx.reset('/users/profile');

    expect(ctx.path).toBe('/users/profile');
  });

  it('should clear segments to empty array on reset', () => {
    const ctx = new ProcessorContext({});
    ctx.segments = ['users', 'profile'];
    ctx.reset('/new');

    expect(ctx.segments).toEqual([]);
  });

  it('should set segmentDecodeHints to undefined on reset', () => {
    const ctx = new ProcessorContext({});
    ctx.segmentDecodeHints = new Uint8Array([1, 0]);
    ctx.reset('/path');

    expect(ctx.segmentDecodeHints).toBeUndefined();
  });
});
