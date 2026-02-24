import type { Result } from '@zipbul/result';
import type { RouterErrData } from '../../types';
import type { ProcessorContext } from '../context';

import { err } from '@zipbul/result';

export function validateSegments(ctx: ProcessorContext): Result<void, RouterErrData> {
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
      return err<RouterErrData>({
        kind: 'segment-limit',
        message: `Segment length exceeds limit: ${seg.substring(0, 20)}...`,
        segment: seg.substring(0, 40),
      });
    }

    const hasPct = seg.includes('%');

    if (hasPct) {
      ctx.segmentDecodeHints[i] = 1;

      if (failFast) {
        try {
          decodeURIComponent(seg);
        } catch (_e) {
          return err<RouterErrData>({
            kind: 'encoding',
            message: `Malformed percent encoded component: ${seg}`,
            segment: seg,
          });
        }
      }
    }
  }
}
