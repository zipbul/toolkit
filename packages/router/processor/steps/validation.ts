import type { ProcessorContext } from '../context';

export function validateSegments(ctx: ProcessorContext): void {
  const maxLen = ctx.config.maxSegmentLength ?? 256;
  const failFast = ctx.config.failFastOnBadEncoding ?? false;
  const segments = ctx.segments;

  ctx.segmentDecodeHints = new Uint8Array(segments.length);

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];

    if (seg === undefined) {
      continue;
    }

    if (seg.length > maxLen) {
      throw new Error(`Segment length exceeds limit: ${seg.substring(0, 20)}...`);
    }

    const hasPct = seg.includes('%');

    if (hasPct) {
      ctx.segmentDecodeHints[i] = 1;

      if (failFast) {
        try {
          decodeURIComponent(seg);
        } catch (_e) {
          throw new Error(`Malformed percent encoded component: ${seg}`);
        }
      }
    }
  }
}
