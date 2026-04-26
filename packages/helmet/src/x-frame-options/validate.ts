import { HelmetErrorReason } from '../enums';
import type { ViolationDetail } from '../interfaces';
import type { XFrameOptionsValue } from '../types';

const XFO_VALUES = new Set<XFrameOptionsValue>(['deny', 'sameorigin', 'DENY', 'SAMEORIGIN']);

export function validateXFrameOptions(value: string, path: string): ViolationDetail[] {
  if (!XFO_VALUES.has(value as XFrameOptionsValue)) {
    return [
      {
        reason: HelmetErrorReason.InvalidXFrameOptionsValue,
        path,
        message: 'invalid X-Frame-Options value',
        remedy: "use 'deny' or 'sameorigin' (or uppercase variants for WAF compatibility)",
      },
    ];
  }
  return [];
}
