import { HelmetErrorReason } from '../enums';
import type { ViolationDetail } from '../interfaces';

const XDPC_VALUES = new Set(['on', 'off']);

export function validateXDnsPrefetchControl(value: string, path: string): ViolationDetail[] {
  if (!XDPC_VALUES.has(value)) {
    return [
      {
        reason: HelmetErrorReason.InvalidXDnsPrefetchValue,
        path,
        message: "X-DNS-Prefetch-Control must be 'on' or 'off'",
      },
    ];
  }
  return [];
}
