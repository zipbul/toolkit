import { describe, it, expect } from 'bun:test';
import { isErr } from '@zipbul/result';

import { ProcessorContext } from '../context';
import { validateSegments } from './validation';

describe('validateSegments', () => {
  it('should allocate segmentDecodeHints and return no error for valid segments', () => {
    const ctx = new ProcessorContext({ maxSegmentLength: 256 });
    ctx.segments = ['users', 'profile'];
    const result = validateSegments(ctx);

    expect(isErr(result)).toBe(false);
    expect(ctx.segmentDecodeHints).toBeInstanceOf(Uint8Array);
    expect(ctx.segmentDecodeHints!.length).toBe(2);
  });

  it('should set hint to 1 for a segment containing percent sign', () => {
    const ctx = new ProcessorContext({ maxSegmentLength: 256 });
    ctx.segments = ['hello%20world'];
    validateSegments(ctx);

    expect(ctx.segmentDecodeHints![0]).toBe(1);
  });

  it('should set hint to 0 for a segment without percent sign', () => {
    const ctx = new ProcessorContext({ maxSegmentLength: 256 });
    ctx.segments = ['cleanpath'];
    validateSegments(ctx);

    expect(ctx.segmentDecodeHints![0]).toBe(0);
  });

  it('should return Err when segment exceeds maxSegmentLength', () => {
    const ctx = new ProcessorContext({ maxSegmentLength: 5 });
    ctx.segments = ['toolongsegment'];
    const result = validateSegments(ctx);

    expect(isErr(result)).toBe(true);
    expect((result as any).data.kind).toBe('segment-limit');
  });

  it('should return Err when failFast=true and segment has invalid percent encoding', () => {
    const ctx = new ProcessorContext({ failFastOnBadEncoding: true });
    ctx.segments = ['%ZZ'];
    const result = validateSegments(ctx);

    expect(isErr(result)).toBe(true);
    expect((result as any).data.kind).toBe('encoding');
  });

  it('should return no error when failFast=false and segment has invalid percent encoding', () => {
    const ctx = new ProcessorContext({ failFastOnBadEncoding: false });
    ctx.segments = ['%ZZ'];
    const result = validateSegments(ctx);

    expect(isErr(result)).toBe(false);
  });

  it('should produce empty Uint8Array when segments array is empty', () => {
    const ctx = new ProcessorContext({});
    ctx.segments = [];
    validateSegments(ctx);

    expect(ctx.segmentDecodeHints).toBeInstanceOf(Uint8Array);
    expect(ctx.segmentDecodeHints!.length).toBe(0);
  });
});
