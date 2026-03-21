import { err } from '@zipbul/result';
import type { Result } from '@zipbul/result';

import { CookieErrorReason } from './enums';
import type { CookieErrorData, CookieParserOptions } from './interfaces';
import type { ResolvedCookieDefaults, ResolvedCookieParserOptions } from './types';

const VALID_ALGORITHMS: ReadonlySet<string> = new Set(['sha256', 'sha384', 'sha512']);

export function resolveCookieParserOptions(options?: CookieParserOptions): ResolvedCookieParserOptions {
  const defaults: ResolvedCookieDefaults = {
    httpOnly: options?.httpOnly ?? null,
    secure: options?.secure ?? null,
    sameSite: options?.sameSite ?? null,
    path: options?.path ?? null,
    domain: options?.domain ?? null,
    maxAge: options?.maxAge ?? null,
    expires: options?.expires ?? null,
    partitioned: options?.partitioned ?? null,
  };

  return {
    secrets: options?.secrets ?? null,
    algorithm: options?.algorithm ?? 'sha256',
    encryptionSecret: options?.encryptionSecret ?? null,
    prefixValidation: options?.prefixValidation ?? false,
    defaults,
  };
}

export function validateCookieParserOptions(
  resolved: ResolvedCookieParserOptions,
): Result<void, CookieErrorData> {
  if (resolved.secrets !== null) {
    if (resolved.secrets.length === 0) {
      return err<CookieErrorData>({
        reason: CookieErrorReason.EmptySecrets,
        message: 'secrets array must not be empty',
      });
    }
    for (const secret of resolved.secrets) {
      if (secret.trim().length === 0) {
        return err<CookieErrorData>({
          reason: CookieErrorReason.InvalidSecret,
          message: 'each secret must be a non-blank string',
        });
      }
    }
  }

  if (resolved.encryptionSecret !== null && resolved.encryptionSecret.trim().length === 0) {
    return err<CookieErrorData>({
      reason: CookieErrorReason.InvalidEncryptionSecret,
      message: 'encryptionSecret must be a non-blank string',
    });
  }

  if (!VALID_ALGORITHMS.has(resolved.algorithm)) {
    return err<CookieErrorData>({
      reason: CookieErrorReason.InvalidAlgorithm,
      message: 'algorithm must be one of: sha256, sha384, sha512',
    });
  }
}
