import { HelmetErrorReason } from '../enums';
import type { ViolationDetail } from '../interfaces';

const XSS_VALUES = new Set(['0', '1; mode=block']);

export function validateXXssProtection(value: string, path: string): ViolationDetail[] {
  if (!XSS_VALUES.has(value)) {
    return [
      {
        reason: HelmetErrorReason.InvalidXXssProtectionValue,
        path,
        message: "X-XSS-Protection must be '0' or '1; mode=block'",
      },
    ];
  }
  return [];
}
