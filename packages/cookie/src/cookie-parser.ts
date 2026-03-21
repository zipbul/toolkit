import { Cookie } from 'bun';
import { isErr } from '@zipbul/result';

import { CookieErrorReason } from './enums';
import { CookieError, type CookieAttributes, type CookieParserOptions, type SerializeContext } from './interfaces';
import { resolveCookieParserOptions, validateCookieParserOptions } from './options';
import type { ResolvedCookieParserOptions } from './types';

const IV_LENGTH = 12;
const AUTH_TAG_BITS = 128;
const AUTH_TAG_BYTES = AUTH_TAG_BITS / 8;
const MIN_CIPHERTEXT_LENGTH = IV_LENGTH + AUTH_TAG_BYTES;
const MAX_COOKIE_SIZE = 4096;
const MAX_LIFETIME_SECONDS = 34560000; // RFC 6265bis §5.4: 400 days

// RFC 6265 §4.1.1 / RFC 9110 §5.6.2: cookie-name = token
// token = 1*tchar
// tchar = "!" / "#" / "$" / "%" / "&" / "'" / "*" / "+" / "-" / "." /
//         "^" / "_" / "`" / "|" / "~" / DIGIT / ALPHA
const INVALID_TOKEN_CHARS = /[^\x21\x23-\x27\x2A\x2B\x2D\x2E\x30-\x39\x41-\x5A\x5E-\x7A\x7C\x7E]/;

function deriveKey(secret: string): Uint8Array {
  const hash = new Bun.CryptoHasher('sha256');
  hash.update(secret);
  return hash.digest();
}

export class CookieParser {
  private readonly encryptionKey: Uint8Array | null;
  private encryptionKeyPromise: Promise<CryptoKey> | null = null;
  private readonly hmacKeyPromises = new Map<string, Promise<CryptoKey>>();

  private constructor(private readonly options: ResolvedCookieParserOptions) {
    this.encryptionKey = options.encryptionSecret !== null
      ? deriveKey(options.encryptionSecret)
      : null;
  }

  public static create(options?: CookieParserOptions): CookieParser {
    const resolved = resolveCookieParserOptions(options);
    const validation = validateCookieParserOptions(resolved);
    if (isErr(validation)) throw new CookieError(validation.data);
    return new CookieParser(resolved);
  }

  public parse(header: string): Cookie[] {
    if (header === '') return [];
    const map = new Bun.CookieMap(header);
    const result: Cookie[] = [];
    for (const [name, value] of map) {
      result.push(new Cookie(name, value));
    }
    return result;
  }

  public parseOne(header: string): Cookie {
    return Cookie.parse(header);
  }

  public createCookie(name: string, value: string, options?: CookieAttributes): Cookie {
    if (name.length === 0 || INVALID_TOKEN_CHARS.test(name)) {
      throw new CookieError({
        reason: CookieErrorReason.InvalidCookieName,
        message: 'cookie name must be a valid RFC 6265 token',
      });
    }

    const { defaults } = this.options;
    const merged: Record<string, unknown> = {};

    if (defaults.httpOnly !== null) merged.httpOnly = defaults.httpOnly;
    if (defaults.secure !== null && defaults.secure !== 'auto') merged.secure = defaults.secure;
    if (defaults.sameSite !== null) merged.sameSite = defaults.sameSite;
    if (defaults.path !== null) merged.path = defaults.path;
    if (defaults.domain !== null) merged.domain = defaults.domain;
    if (defaults.maxAge !== null) merged.maxAge = defaults.maxAge;
    if (defaults.expires !== null) merged.expires = defaults.expires;
    if (defaults.partitioned !== null) merged.partitioned = defaults.partitioned;

    if (options !== undefined) {
      for (const [key, val] of Object.entries(options)) {
        if (val !== undefined) {
          merged[key] = val;
        }
      }
    }

    return new Cookie(name, value, merged);
  }

  public serialize(cookie: Cookie, context?: SerializeContext): string {
    const { defaults } = this.options;

    const resolvedSecure = defaults.secure === 'auto'
      ? (context?.isSecure ?? false)
      : null;

    const applyDomain = cookie.domain == null && defaults.domain !== null;
    const applyMaxAge = cookie.maxAge == null && defaults.maxAge !== null;
    const applyExpires = cookie.expires == null && defaults.expires !== null;
    const applySecure = resolvedSecure !== null;

    let target = cookie;

    if (applyDomain || applyMaxAge || applyExpires || applySecure) {
      target = new Cookie(cookie.name, cookie.value, {
        domain: applyDomain ? defaults.domain! : (cookie.domain ?? undefined),
        path: cookie.path ?? undefined,
        secure: applySecure ? resolvedSecure : cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite ?? undefined,
        maxAge: applyMaxAge ? defaults.maxAge! : (cookie.maxAge ?? undefined),
        expires: applyExpires ? defaults.expires! : (cookie.expires ?? undefined),
        partitioned: cookie.partitioned,
      });
    }

    // RFC 6265bis + Fetch Standard: SameSite=None requires Secure
    if (target.sameSite === 'none' && !target.secure) {
      throw new CookieError({
        reason: CookieErrorReason.SameSiteNoneRequiresSecure,
        message: 'SameSite=None cookies must have the Secure attribute',
      });
    }

    // RFC 6265bis §5.4: max lifetime SHOULD NOT exceed 400 days
    if (target.maxAge != null && target.maxAge > MAX_LIFETIME_SECONDS) {
      throw new CookieError({
        reason: CookieErrorReason.MaxLifetimeExceeded,
        message: `Max-Age exceeds 400-day limit (${MAX_LIFETIME_SECONDS}s)`,
      });
    }

    if (this.options.prefixValidation) {
      this.validatePrefix(target);
    }

    const header = target.serialize();

    if (header.length > MAX_COOKIE_SIZE) {
      throw new CookieError({
        reason: CookieErrorReason.CookieTooLarge,
        message: `serialized cookie exceeds ${MAX_COOKIE_SIZE} bytes (${header.length})`,
      });
    }

    return header;
  }

  public sign(cookie: Cookie): Cookie {
    if (this.options.secrets === null) {
      throw new CookieError({
        reason: CookieErrorReason.SigningNotConfigured,
        message: 'signing requires secrets to be configured',
      });
    }
    const hasher = new Bun.CryptoHasher(this.options.algorithm, this.options.secrets[0]!);
    hasher.update(cookie.value);
    const hmac = hasher.digest('base64url');
    return this.cloneCookieWithDefaults(cookie, `${cookie.value}.${hmac}`);
  }

  public async unsign(cookie: Cookie): Promise<Cookie> {
    if (this.options.secrets === null) {
      throw new CookieError({
        reason: CookieErrorReason.SigningNotConfigured,
        message: 'unsigning requires secrets to be configured',
      });
    }

    const dotIndex = cookie.value.lastIndexOf('.');
    if (dotIndex === -1) {
      throw new CookieError({
        reason: CookieErrorReason.InvalidSignature,
        message: 'signed cookie value must contain a dot separator',
      });
    }

    const value = cookie.value.slice(0, dotIndex);
    const signature = cookie.value.slice(dotIndex + 1);
    const sigBytes = Buffer.from(signature, 'base64url');
    const dataBytes = new TextEncoder().encode(value);

    for (const secret of this.options.secrets) {
      const key = await this.getHmacKey(secret);
      const isValid = await crypto.subtle.verify('HMAC', key, sigBytes, dataBytes);
      if (isValid) {
        return this.cloneCookieWithDefaults(cookie, value);
      }
    }

    throw new CookieError({
      reason: CookieErrorReason.SignatureVerificationFailed,
      message: 'cookie signature verification failed',
    });
  }

  public async encrypt(cookie: Cookie): Promise<Cookie> {
    if (this.encryptionKey === null) {
      throw new CookieError({
        reason: CookieErrorReason.EncryptionNotConfigured,
        message: 'encryption requires encryptionSecret to be configured',
      });
    }

    const key = await this.getEncryptionKey();
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, tagLength: AUTH_TAG_BITS },
      key,
      new TextEncoder().encode(cookie.value),
    );

    const combined = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), IV_LENGTH);

    return this.cloneCookieWithDefaults(
      cookie,
      Buffer.from(combined).toString('base64url'),
    );
  }

  public async decrypt(cookie: Cookie): Promise<Cookie> {
    if (this.encryptionKey === null) {
      throw new CookieError({
        reason: CookieErrorReason.EncryptionNotConfigured,
        message: 'decryption requires encryptionSecret to be configured',
      });
    }

    const combined = Buffer.from(cookie.value, 'base64url');
    if (combined.length < MIN_CIPHERTEXT_LENGTH) {
      throw new CookieError({
        reason: CookieErrorReason.InvalidCiphertext,
        message: 'ciphertext is too short to be valid',
      });
    }

    const key = await this.getEncryptionKey();

    try {
      const plaintext = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: combined.subarray(0, IV_LENGTH),
          tagLength: AUTH_TAG_BITS,
        },
        key,
        combined.subarray(IV_LENGTH),
      );

      return this.cloneCookieWithDefaults(
        cookie,
        new TextDecoder().decode(plaintext),
      );
    } catch {
      throw new CookieError({
        reason: CookieErrorReason.DecryptionFailed,
        message: 'cookie decryption failed',
      });
    }
  }

  public validatePrefix(cookie: Cookie): void {
    const { name } = cookie;

    if (name.startsWith('__Host-')) {
      if (!cookie.secure) {
        throw new CookieError({
          reason: CookieErrorReason.HostPrefixRequiresSecure,
          message: '__Host- cookies must have the Secure attribute',
        });
      }
      if (cookie.domain) {
        throw new CookieError({
          reason: CookieErrorReason.HostPrefixForbidsDomain,
          message: '__Host- cookies must not have a Domain attribute',
        });
      }
      if (cookie.path !== '/') {
        throw new CookieError({
          reason: CookieErrorReason.HostPrefixRequiresRootPath,
          message: '__Host- cookies must have Path=/',
        });
      }
      return;
    }

    if (name.startsWith('__Secure-')) {
      if (!cookie.secure) {
        throw new CookieError({
          reason: CookieErrorReason.SecurePrefixRequiresSecure,
          message: '__Secure- cookies must have the Secure attribute',
        });
      }
    }
  }

  private getEncryptionKey(): Promise<CryptoKey> {
    if (this.encryptionKeyPromise === null) {
      this.encryptionKeyPromise = crypto.subtle.importKey(
        'raw',
        this.encryptionKey!.buffer as ArrayBuffer,
        'AES-GCM',
        false,
        ['encrypt', 'decrypt'],
      );
    }
    return this.encryptionKeyPromise;
  }

  private getHmacKey(secret: string): Promise<CryptoKey> {
    let promise = this.hmacKeyPromises.get(secret);
    if (promise === undefined) {
      const keyData = new TextEncoder().encode(secret);
      promise = crypto.subtle.importKey(
        'raw',
        keyData.buffer as ArrayBuffer,
        { name: 'HMAC', hash: `SHA-${this.options.algorithm.slice(3)}` },
        false,
        ['verify'],
      );
      this.hmacKeyPromises.set(secret, promise);
    }
    return promise;
  }

  private cloneCookieWithDefaults(source: Cookie, newValue: string): Cookie {
    const { defaults } = this.options;
    return new Cookie(source.name, newValue, {
      domain: source.domain ?? defaults.domain ?? undefined,
      path: source.path ?? undefined,
      secure: source.secure,
      httpOnly: source.httpOnly,
      sameSite: source.sameSite ?? undefined,
      maxAge: source.maxAge ?? defaults.maxAge ?? undefined,
      expires: source.expires ?? defaults.expires ?? undefined,
      partitioned: source.partitioned,
    });
  }
}
