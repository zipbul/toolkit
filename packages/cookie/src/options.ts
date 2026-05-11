import { err } from '@zipbul/result';
import type { Result } from '@zipbul/result';

import { CookieErrorReason } from './enums';
import type { CookieErrorData, CookieParserOptions } from './interfaces';
import type { ResolvedCookieDefaults, ResolvedCookieParserOptions } from './types';

const VALID_ALGORITHMS: ReadonlySet<string> = new Set(['sha256', 'sha384', 'sha512']);
// Bytes (UTF-8), not UTF-16 code units. 32 bytes = 256 bits, the AES-256 / HMAC-SHA-256 key size.
const MIN_SECRET_BYTES = 32;
const MIN_KDF_SALT_BYTES = 16;
const DEFAULT_KDF_SALT = new TextEncoder().encode('@zipbul/cookie/2026');
// Shannon entropy lower bound (bits) over the secret's byte distribution.
// Random 32 bytes yield ~256 bits; uniform base64-32 yields ~190 bits.
// 'abcdefgh'.repeat(4) yields exactly 96 bits → rejected at 128.
const MIN_SECRET_ENTROPY_BITS = 128;

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

  let kdfSalt: Uint8Array = DEFAULT_KDF_SALT;
  if (options?.kdfSalt !== undefined) {
    kdfSalt = typeof options.kdfSalt === 'string'
      ? new TextEncoder().encode(options.kdfSalt)
      : options.kdfSalt;
  }

  return {
    secrets: options?.secrets ?? null,
    algorithm: options?.algorithm ?? 'sha256',
    encryptionSecrets,
    prefixValidation: options?.prefixValidation ?? true,
    onEncrypt: options?.onEncrypt ?? null,
    kdfSalt,
    defaults,
  };
}

// Shannon entropy of a byte string in bits: H = (-Σ p_i·log2(p_i)) × length.
// This is a lower-bound proxy for actual min-entropy. A secret that fails this check is
// definitely weak; passing does not prove cryptographic strength.
function shannonEntropyBits(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  const counts = new Uint32Array(256);
  for (let i = 0; i < bytes.length; i++) counts[bytes[i]!]! += 1;
  let h = 0;
  for (let i = 0; i < 256; i++) {
    const c = counts[i]!;
    if (c === 0) continue;
    const p = c / bytes.length;
    h -= p * Math.log2(p);
  }
  return h * bytes.length;
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
  const bytes = new TextEncoder().encode(secret);
  if (bytes.length < MIN_SECRET_BYTES) {
    return err<CookieErrorData>({
      reason: CookieErrorReason.WeakSecret,
      message: `each ${label} must be at least ${MIN_SECRET_BYTES} bytes (UTF-8); got ${bytes.length}`,
    });
  }
  const entropy = shannonEntropyBits(bytes);
  if (entropy < MIN_SECRET_ENTROPY_BITS) {
    return err<CookieErrorData>({
      reason: CookieErrorReason.WeakSecret,
      message: `${label} entropy too low: estimated ${entropy.toFixed(1)} bits, need ≥${MIN_SECRET_ENTROPY_BITS} bits (OWASP / NIST SP 800-131A). Supply uniform random bytes, e.g. Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url').`,
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

  if (resolved.kdfSalt.length < MIN_KDF_SALT_BYTES) {
    return err<CookieErrorData>({
      reason: CookieErrorReason.InvalidAttribute,
      message: `kdfSalt must be at least ${MIN_KDF_SALT_BYTES} bytes (RFC 5869 §3.1)`,
    });
  }

  return undefined;
}
