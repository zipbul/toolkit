import { HttpHeader } from '@zipbul/shared';

import { LIMITS } from '../constants';
import { HelmetErrorReason } from '../enums';
import type { ViolationDetail } from '../interfaces';
import type { ResolvedCacheControlOptions } from '../types';

import type { HeaderEntry } from '../header-entry';

// CR/LF/control chars must never appear in a Cache-Control value or any
// proxy in the path is at risk of header splitting / smuggling.
// eslint-disable-next-line no-control-regex
const CACHE_CONTROL_FORBIDDEN_RE = /[\x00-\x1f\x7f]/;

export function serializeCacheControl(opts: ResolvedCacheControlOptions): HeaderEntry[] {
  const out: HeaderEntry[] = [[HttpHeader.CacheControl, opts.value]];
  if (opts.pragma) out.push([HttpHeader.Pragma, 'no-cache']);
  if (opts.expires) out.push([HttpHeader.Expires, '0']);
  return out;
}

export function resolveCacheControl(
  input: boolean | { value?: string; pragma?: boolean; expires?: boolean } | undefined,
): ResolvedCacheControlOptions | undefined | false {
  if (input === undefined) return undefined;
  if (input === false) return false;
  if (input === true) {
    return Object.freeze({ value: 'no-store, max-age=0', pragma: false, expires: false });
  }
  return Object.freeze({
    value: input.value ?? 'no-store, max-age=0',
    pragma: input.pragma === true,
    expires: input.expires === true,
  });
}

/**
 * Validate the resolved Cache-Control header value at create-time so the
 * failure surfaces as a {@link HelmetError} (not a runtime `Headers.set`
 * exception when {@link Helmet#headers} is later called).
 */
export function validateCacheControl(
  resolved: ResolvedCacheControlOptions,
  path: string,
): ViolationDetail[] {
  const out: ViolationDetail[] = [];
  if (typeof resolved.value !== 'string' || resolved.value.length === 0) {
    out.push({
      reason: HelmetErrorReason.InvalidCacheControlValue,
      path: `${path}.value`,
      message: 'Cache-Control value must be a non-empty string',
    });
    return out;
  }
  if (resolved.value.length > LIMITS.headerValueBytes) {
    out.push({
      reason: HelmetErrorReason.InputTooLarge,
      path: `${path}.value`,
      message: `Cache-Control value exceeds ${LIMITS.headerValueBytes} chars`,
    });
  }
  if (CACHE_CONTROL_FORBIDDEN_RE.test(resolved.value)) {
    out.push({
      reason: HelmetErrorReason.ControlCharRejected,
      path: `${path}.value`,
      message: 'Cache-Control value contains forbidden control characters (header injection guard)',
    });
  }
  return out;
}
