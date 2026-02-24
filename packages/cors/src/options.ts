import { err } from '@zipbul/result';
import type { Result } from '@zipbul/result';
import safe from 'safe-regex2';

import { CORS_DEFAULT_METHODS, CORS_DEFAULT_OPTIONS_SUCCESS_STATUS } from './constants';
import { CorsErrorReason } from './enums';
import type { CorsError, CorsOptions } from './interfaces';
import type { ResolvedCorsOptions } from './types';

/**
 * Takes partial {@link CorsOptions} and fills in every missing field with a
 * sensible default, returning a fully populated {@link ResolvedCorsOptions}.
 *
 * You do not need to call this manually — {@link Cors.create} handles it for
 * you automatically.
 *
 * @param options - Optional CORS configuration. Pass nothing to use all defaults.
 * @returns A complete options object ready for validation and request handling.
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

function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

/**
 * Validates a fully resolved {@link ResolvedCorsOptions} object and returns
 * the first problem it finds, or `undefined` when everything looks good.
 *
 * Covers origins (blank strings, unsafe RegExp, empty arrays), methods,
 * allowed/exposed headers, the `credentials` + wildcard combination,
 * `maxAge`, and `optionsSuccessStatus`.
 *
 * You do not need to call this manually — {@link Cors.create} handles it
 * for you automatically.
 *
 * @param resolved - The fully resolved options object to validate.
 * @returns `undefined` when valid, or `Err<CorsError>` describing the first
 *   rule violation found.
 */
export function validateCorsOptions(resolved: ResolvedCorsOptions): Result<void, CorsError> {
  if (typeof resolved.origin === 'string' && resolved.origin !== '*' && isBlank(resolved.origin)) {
    return err<CorsError>({
      reason: CorsErrorReason.InvalidOrigin,
      message: 'origin must not be an empty or blank string (RFC 6454)',
    });
  }

  if (resolved.origin instanceof RegExp && !safe(resolved.origin)) {
    return err<CorsError>({
      reason: CorsErrorReason.UnsafeRegExp,
      message: 'origin RegExp is potentially unsafe (exponential backtracking / ReDoS)',
    });
  }

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

    const hasUnsafeRegExp = resolved.origin.some(entry => entry instanceof RegExp && !safe(entry));

    if (hasUnsafeRegExp) {
      return err<CorsError>({
        reason: CorsErrorReason.UnsafeRegExp,
        message: 'origin array contains an unsafe RegExp (exponential backtracking / ReDoS)',
      });
    }
  }

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

  if (resolved.allowedHeaders !== null && resolved.allowedHeaders.some(isBlank)) {
    return err<CorsError>({
      reason: CorsErrorReason.InvalidAllowedHeaders,
      message: 'allowedHeaders must not contain empty or blank string entries (RFC 9110 §5.6.2 token)',
    });
  }

  if (resolved.exposedHeaders !== null && resolved.exposedHeaders.some(isBlank)) {
    return err<CorsError>({
      reason: CorsErrorReason.InvalidExposedHeaders,
      message: 'exposedHeaders must not contain empty or blank string entries (RFC 9110 §5.6.2 token)',
    });
  }

  if (resolved.credentials === true && resolved.origin === '*') {
    return err<CorsError>({
      reason: CorsErrorReason.CredentialsWithWildcardOrigin,
      message: 'credentials:true cannot be used with wildcard origin (*) per Fetch Standard',
    });
  }

  if (resolved.maxAge !== null && (resolved.maxAge < 0 || !Number.isInteger(resolved.maxAge))) {
    return err<CorsError>({
      reason: CorsErrorReason.InvalidMaxAge,
      message: 'maxAge must be a non-negative integer (delta-seconds per RFC 9111)',
    });
  }

  if (!Number.isInteger(resolved.optionsSuccessStatus) || resolved.optionsSuccessStatus < 200 || resolved.optionsSuccessStatus > 299) {
    return err<CorsError>({
      reason: CorsErrorReason.InvalidStatusCode,
      message: 'optionsSuccessStatus must be a 2xx integer status code (200–299)',
    });
  }

  return undefined;
}
