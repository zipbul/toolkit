import { HelmetErrorReason } from '../enums';
import type { ViolationDetail } from '../interfaces';
import type { ReferrerPolicyToken } from '../types';

const REFERRER_POLICY_TOKENS = new Set<ReferrerPolicyToken>([
  'no-referrer',
  'no-referrer-when-downgrade',
  'origin',
  'origin-when-cross-origin',
  'same-origin',
  'strict-origin',
  'strict-origin-when-cross-origin',
  'unsafe-url',
]);

export function validateReferrerPolicy(
  tokens: readonly ReferrerPolicyToken[],
  path: string,
): ViolationDetail[] {
  const out: ViolationDetail[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === undefined || !REFERRER_POLICY_TOKENS.has(t)) {
      out.push({
        reason: HelmetErrorReason.InvalidReferrerPolicyToken,
        path: `${path}[${i}]`,
        message: 'invalid Referrer-Policy token',
        remedy:
          'use one of: no-referrer, no-referrer-when-downgrade, origin, origin-when-cross-origin, same-origin, strict-origin, strict-origin-when-cross-origin, unsafe-url',
      });
    }
  }
  return out;
}
