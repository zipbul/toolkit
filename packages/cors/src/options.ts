import { err } from '@zipbul/result';
import type { Result } from '@zipbul/result';

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
    methods: options?.methods ?? CORS_DEFAULT_METHODS,
    allowedHeaders: options?.allowedHeaders ?? null,
    exposedHeaders: options?.exposedHeaders ?? null,
    credentials: options?.credentials ?? false,
    maxAge: options?.maxAge ?? null,
    preflightContinue: options?.preflightContinue ?? false,
    optionsSuccessStatus: options?.optionsSuccessStatus ?? CORS_DEFAULT_OPTIONS_SUCCESS_STATUS,
  };
}

/**
 * Validates resolved CORS options against rules derived from the Fetch Standard.
 *
 * - V1: `credentials:true` with wildcard origin is forbidden (Fetch Standard §3.3.5).
 * - V2: `maxAge` must be a non-negative integer when set (RFC 9111 §1.2.1 delta-seconds).
 * - V3: `optionsSuccessStatus` must be an ok status 200–299 (Fetch Standard).
 *
 * @returns `undefined` (void) if valid, or `Err<CorsError>` on the first violated rule.
 */
export function validateCorsOptions(resolved: ResolvedCorsOptions): Result<void, CorsError> {
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

  if (resolved.optionsSuccessStatus < 200 || resolved.optionsSuccessStatus > 299) {
    return err<CorsError>({
      reason: CorsErrorReason.InvalidStatusCode,
      message: 'optionsSuccessStatus must be an ok status (200–299)',
    });
  }

  return undefined;
}
