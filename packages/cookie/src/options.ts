import { err } from '@zipbul/result';
import type { Result } from '@zipbul/result';

import { CookieErrorReason } from './enums';
import type { CookieErrorData, CookieParserOptions } from './interfaces';
import type { ResolvedCookieDefaults, ResolvedCookieParserOptions } from './types';

const VALID_ALGORITHMS: ReadonlySet<string> = new Set(['sha256', 'sha384', 'sha512']);
const MIN_SECRET_LENGTH = 32;
const MIN_UNIQUE_CHARS = 8;

// Default public-suffix check: rejects only single-label domains (which are TLDs by definition).
// Comprehensive PSL detection requires the official Mozilla Public Suffix List (~10k entries, frequently updated)
// and is intentionally NOT bundled here — bundling a snapshot would silently rot. Callers needing full PSL
// coverage MUST supply `publicSuffixCheck` wired to a maintained source (e.g. `psl`, `tldts`,
// or a network-fetched PSL). RFC 6265 §5.3 step 6 / RFC 6265bis §5.7 enforcement is the application's responsibility.
export function defaultPublicSuffixCheck(domain: string): boolean {
  const normalized = domain.toLowerCase().replace(/^\.+|\.+$/g, '');
  if (normalized === '') return false;
  return !normalized.includes('.');
}

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
    priority: options?.priority ?? null,
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
    prefixValidation: options?.prefixValidation ?? true,
    publicSuffixCheck: options?.publicSuffixCheck ?? defaultPublicSuffixCheck,
    onEncrypt: options?.onEncrypt ?? null,
    defaults,
  };
}

function uniqueCharCount(s: string): number {
  return new Set(s).size;
}

function validateSecretStrength(secret: string, label: string): Result<void, CookieErrorData> {
  if (secret.trim().length === 0) {
    return err<CookieErrorData>({
      reason: label === 'encryptionSecret'
        ? CookieErrorReason.InvalidEncryptionSecret
        : CookieErrorReason.InvalidSecret,
      message: `each ${label} must be a non-blank string`,
    });
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    return err<CookieErrorData>({
      reason: CookieErrorReason.WeakSecret,
      message: `each ${label} must be at least ${MIN_SECRET_LENGTH} characters`,
    });
  }
  if (uniqueCharCount(secret) < MIN_UNIQUE_CHARS) {
    return err<CookieErrorData>({
      reason: CookieErrorReason.WeakSecret,
      message: `${label} entropy too low: needs at least ${MIN_UNIQUE_CHARS} distinct characters; supply high-entropy random data (NIST SP 800-132 §5.1 / NIST SP 800-38D §5.2.1.1)`,
    });
  }
  return undefined;
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
      const r = validateSecretStrength(secret, 'signing secret');
      if (r !== undefined) return r;
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
      const r = validateSecretStrength(secret, 'encryptionSecret');
      if (r !== undefined) return r;
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
