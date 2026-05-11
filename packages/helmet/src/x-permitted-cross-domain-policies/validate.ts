import { HelmetErrorReason } from '../enums';
import type { ViolationDetail } from '../interfaces';

const XPCDP_VALUES = new Set([
  'none',
  'master-only',
  'by-content-type',
  'by-ftp-filename',
  'all',
]);

export function validateXPermittedCrossDomainPolicies(
  value: string,
  path: string,
): ViolationDetail[] {
  if (!XPCDP_VALUES.has(value)) {
    return [
      {
        reason: HelmetErrorReason.InvalidXPermittedCrossDomainValue,
        path,
        message: 'invalid X-Permitted-Cross-Domain-Policies value',
      },
    ];
  }
  return [];
}
