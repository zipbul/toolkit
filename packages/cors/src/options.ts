import { err } from '@zipbul/result';
import type { Result } from '@zipbul/result';
import safe from 'safe-regex2';

import { CORS_DEFAULT_METHODS, CORS_DEFAULT_OPTIONS_SUCCESS_STATUS } from './constants';
import { CorsErrorReason } from './enums';
import type { CorsError, CorsOptions } from './interfaces';
import type { ResolvedCorsOptions } from './types';

/**
 * Resolves partial {@link CorsOptions} into a fully populated
 * {@link ResolvedCorsOptions} by applying defaults via nullish coalescing.
 */
export function resolveCorsOptions(options?: CorsOptions): ResolvedCorsOptions {
  return {
    origin: options?.origin ?? '*',
    methods: options?.methods?.includes('*')
      ? ['*']
      : (options?.methods ?? CORS_DEFAULT_METHODS).map(m => m.toUpperCase()),
    allowedHeaders: options?.allowedHeaders ?? null,
    exposedHeaders: options?.exposedHeaders ?? null,
    credentials: options?.credentials ?? false,
    maxAge: options?.maxAge ?? null,
    preflightContinue: options?.preflightContinue ?? false,
    optionsSuccessStatus: options?.optionsSuccessStatus ?? CORS_DEFAULT_OPTIONS_SUCCESS_STATUS,
  };
}

/** Returns true when a string is empty or contains only whitespace (RFC 9110 §5.6.2 token). */
function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

/**
 * Validates resolved CORS options against rules derived from the Fetch Standard and RFC 9110.
 *
 * - V0a: `origin` must not be an empty/blank string (RFC 6454).
 * - V_regex: `origin` RegExp must be safe (no exponential backtracking / ReDoS).
 * - V0b: `origin` array must not be empty, and must not contain empty/blank string entries (RFC 6454).
 *          Array RegExp entries are also checked for ReDoS safety.
 * - V0c: `methods` must not be empty, and must not contain empty/blank string entries (RFC 9110 §5.6.2).
 * - V0d: `allowedHeaders` must not contain empty/blank string entries (RFC 9110 §5.6.2).
 * - V0e: `exposedHeaders` must not contain empty/blank string entries (RFC 9110 §5.6.2).
 * - V1:  `credentials:true` with wildcard origin is forbidden (Fetch Standard §3.3.5).
 * - V2:  `maxAge` must be a non-negative integer when set (RFC 9111 §1.2.1 delta-seconds).
 * - V3:  `optionsSuccessStatus` must be a 2xx integer (Fetch Standard).
 *
 * @returns `undefined` (void) if valid, or `Err<CorsError>` on the first violated rule.
 */
export function validateCorsOptions(resolved: ResolvedCorsOptions): Result<void, CorsError> {
  // V0a — origin: empty/blank string
  if (typeof resolved.origin === 'string' && resolved.origin !== '*' && isBlank(resolved.origin)) {
    return err<CorsError>({
      reason: CorsErrorReason.InvalidOrigin,
      message: 'origin must not be an empty or blank string (RFC 6454)',
    });
  }

  // V_regex — origin: single unsafe RegExp (ReDoS)
  if (resolved.origin instanceof RegExp && !safe(resolved.origin)) {
    return err<CorsError>({
      reason: CorsErrorReason.UnsafeRegExp,
      message: 'origin RegExp is potentially unsafe (exponential backtracking / ReDoS)',
    });
  }

  // V0b — origin: empty array or array containing empty/blank string entries
  if (Array.isArray(resolved.origin)) {
    if (resolved.origin.length === 0) {
      return err<CorsError>({
        reason: CorsErrorReason.InvalidOrigin,
        message: 'origin array must not be empty (RFC 6454)',
      });
    }

    const hasBlankEntry = resolved.origin.some(entry => typeof entry === 'string' && isBlank(entry));

    if (hasBlankEntry) {
      return err<CorsError>({
        reason: CorsErrorReason.InvalidOrigin,
        message: 'origin array must not contain empty or blank string entries (RFC 6454)',
      });
    }

    // V_regex — origin array: unsafe RegExp entries (ReDoS)
    const hasUnsafeRegExp = resolved.origin.some(entry => entry instanceof RegExp && !safe(entry));

    if (hasUnsafeRegExp) {
      return err<CorsError>({
        reason: CorsErrorReason.UnsafeRegExp,
        message: 'origin array contains an unsafe RegExp (exponential backtracking / ReDoS)',
      });
    }
  }

  // V0c — methods: empty array or blank entries
  if (resolved.methods.length === 0) {
    return err<CorsError>({
      reason: CorsErrorReason.InvalidMethods,
      message: 'methods must not be an empty array (RFC 9110 §5.6.2)',
    });
  }

  if (resolved.methods.some(isBlank)) {
    return err<CorsError>({
      reason: CorsErrorReason.InvalidMethods,
      message: 'methods must not contain empty or blank string entries (RFC 9110 §5.6.2 token)',
    });
  }

  // V0d — allowedHeaders: blank entries (empty array is allowed — explicit "deny all" policy)
  if (resolved.allowedHeaders !== null && resolved.allowedHeaders.some(isBlank)) {
    return err<CorsError>({
      reason: CorsErrorReason.InvalidAllowedHeaders,
      message: 'allowedHeaders must not contain empty or blank string entries (RFC 9110 §5.6.2 token)',
    });
  }

  // V0e — exposedHeaders: blank entries (empty array is allowed)
  if (resolved.exposedHeaders !== null && resolved.exposedHeaders.some(isBlank)) {
    return err<CorsError>({
      reason: CorsErrorReason.InvalidExposedHeaders,
      message: 'exposedHeaders must not contain empty or blank string entries (RFC 9110 §5.6.2 token)',
    });
  }

  // V1 — credentials:true with wildcard origin
  if (resolved.credentials === true && resolved.origin === '*') {
    return err<CorsError>({
      reason: CorsErrorReason.CredentialsWithWildcardOrigin,
      message: 'credentials:true cannot be used with wildcard origin (*) per Fetch Standard',
    });
  }

  // V2 — maxAge: non-negative integer
  if (resolved.maxAge !== null && (resolved.maxAge < 0 || !Number.isInteger(resolved.maxAge))) {
    return err<CorsError>({
      reason: CorsErrorReason.InvalidMaxAge,
      message: 'maxAge must be a non-negative integer (delta-seconds per RFC 9111)',
    });
  }

  // V3 — optionsSuccessStatus: 2xx integer
  if (!Number.isInteger(resolved.optionsSuccessStatus) || resolved.optionsSuccessStatus < 200 || resolved.optionsSuccessStatus > 299) {
    return err<CorsError>({
      reason: CorsErrorReason.InvalidStatusCode,
      message: 'optionsSuccessStatus must be a 2xx integer status code (200–299)',
    });
  }

  return undefined;
}
