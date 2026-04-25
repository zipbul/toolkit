import { err } from '@zipbul/result';
import type { Result } from '@zipbul/result';

import { CookieErrorReason } from './enums';
import type { CookieErrorData, CookieParserOptions } from './interfaces';
import type { ResolvedCookieDefaults, ResolvedCookieParserOptions } from './types';

const VALID_ALGORITHMS: ReadonlySet<string> = new Set(['sha256', 'sha384', 'sha512']);
const MIN_SECRET_LENGTH = 32;

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

  const encryptionSecrets = options?.encryptionSecret == null
    ? null
    : Array.isArray(options.encryptionSecret)
      ? options.encryptionSecret
      : [options.encryptionSecret];

  return {
    secrets: options?.secrets ?? null,
    algorithm: options?.algorithm ?? 'sha256',
    encryptionSecrets,
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
      if (secret.length < MIN_SECRET_LENGTH) {
        return err<CookieErrorData>({
          reason: CookieErrorReason.WeakSecret,
          message: `each signing secret must be at least ${MIN_SECRET_LENGTH} characters of high-entropy random data (NIST SP 800-132)`,
        });
      }
    }
  }

  if (resolved.encryptionSecrets !== null) {
    if (resolved.encryptionSecrets.length === 0) {
      return err<CookieErrorData>({
        reason: CookieErrorReason.InvalidEncryptionSecret,
        message: 'encryptionSecret array must not be empty',
      });
    }
    for (const secret of resolved.encryptionSecrets) {
      if (secret.trim().length === 0) {
        return err<CookieErrorData>({
          reason: CookieErrorReason.InvalidEncryptionSecret,
          message: 'each encryptionSecret must be a non-blank string',
        });
      }
      if (secret.length < MIN_SECRET_LENGTH) {
        return err<CookieErrorData>({
          reason: CookieErrorReason.WeakSecret,
          message: `each encryptionSecret must be at least ${MIN_SECRET_LENGTH} characters of high-entropy random data (NIST SP 800-38D §5.2.1.1)`,
        });
      }
    }
  }

  if (!VALID_ALGORITHMS.has(resolved.algorithm)) {
    return err<CookieErrorData>({
      reason: CookieErrorReason.InvalidAlgorithm,
      message: 'algorithm must be one of: sha256, sha384, sha512',
    });
  }

  return undefined;
}
