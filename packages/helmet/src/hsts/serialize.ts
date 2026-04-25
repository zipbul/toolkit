import { HttpHeader } from '@zipbul/shared';

import { HSTS_DEFAULT_MAX_AGE, HSTS_PRELOAD_MIN_MAX_AGE } from '../constants';
import { HelmetErrorReason } from '../enums';
import type { StrictTransportSecurityOptions, ViolationDetail } from '../interfaces';
import type { ResolvedHstsOptions } from '../types';

import type { HeaderEntry } from '../simple-headers/serialize';

export function resolveHsts(
  input: boolean | StrictTransportSecurityOptions | undefined,
): ResolvedHstsOptions | false {
  if (input === false) return false;
  if (input === undefined || input === true) {
    return Object.freeze({
      maxAge: HSTS_DEFAULT_MAX_AGE,
      includeSubDomains: true,
      preload: false,
    });
  }
  return Object.freeze({
    maxAge: input.maxAge ?? HSTS_DEFAULT_MAX_AGE,
    includeSubDomains: input.includeSubDomains !== false,
    preload: input.preload === true,
  });
}

export function validateHsts(resolved: ResolvedHstsOptions, path: string): ViolationDetail[] {
  const out: ViolationDetail[] = [];
  if (!Number.isInteger(resolved.maxAge) || resolved.maxAge < 0) {
    out.push({
      reason: HelmetErrorReason.HstsMaxAgeInvalid,
      path: `${path}.maxAge`,
      message: 'HSTS max-age must be a non-negative integer (delta-seconds, RFC 6797)',
    });
  }
  if (resolved.preload) {
    if (resolved.maxAge < HSTS_PRELOAD_MIN_MAX_AGE) {
      out.push({
        reason: HelmetErrorReason.HstsPreloadRequirementMissing,
        path: `${path}.preload`,
        message: `HSTS preload requires max-age >= ${HSTS_PRELOAD_MIN_MAX_AGE} (1 year, hstspreload.org)`,
      });
    }
    if (!resolved.includeSubDomains) {
      out.push({
        reason: HelmetErrorReason.HstsPreloadRequirementMissing,
        path: `${path}.preload`,
        message: 'HSTS preload requires includeSubDomains: true (hstspreload.org)',
      });
    }
  }
  return out;
}

export function serializeHsts(opts: ResolvedHstsOptions): HeaderEntry {
  let value = `max-age=${opts.maxAge}`;
  if (opts.includeSubDomains) value += '; includeSubDomains';
  if (opts.preload) value += '; preload';
  return [HttpHeader.StrictTransportSecurity, value];
}
