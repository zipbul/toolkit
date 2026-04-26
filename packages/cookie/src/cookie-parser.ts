import { Cookie } from 'bun';
import { isErr } from '@zipbul/result';

import { CookieErrorReason } from './enums';
import { CookieError, type CookieAttributes, type CookieParserOptions, type CookiePriority, type SerializeContext } from './interfaces';
import { resolveCookieParserOptions, validateCookieParserOptions } from './options';
import type { ResolvedCookieParserOptions } from './types';

const IV_LENGTH = 12;
const KID_LENGTH = 4;
const AUTH_TAG_BITS = 128;
const AUTH_TAG_BYTES = AUTH_TAG_BITS / 8;
const MIN_CIPHERTEXT_LENGTH = KID_LENGTH + IV_LENGTH + AUTH_TAG_BYTES;
const MAX_NAME_VALUE_OCTETS = 4096;
const MAX_ATTRIBUTE_OCTETS = 1024;
const MAX_HEADER_OCTETS = 8190;
const MAX_LIFETIME_SECONDS = 34560000;
const MAX_LIFETIME_MS = MAX_LIFETIME_SECONDS * 1000;
const NAME_VALUE_SEPARATOR = '\x00';

// Cookie name token per RFC 9110 §5.6.2 minus '%' (Bun.CookieMap percent-decodes inbound names; excluding '%' guarantees round-trip).
const INVALID_TOKEN_CHARS = /[^\x21\x23\x24\x26\x27\x2A\x2B\x2D\x2E\x30-\x39\x41-\x5A\x5E-\x7A\x7C\x7E]/;

// RFC 1034/1123 subdomain LDH rule. Allows optional leading dot (RFC 6265 §4.1.2.3 — UA strips).
const RFC1123_DOMAIN = /^\.?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

const PRIORITY_VALUES: ReadonlySet<CookiePriority> = new Set(['low', 'medium', 'high']);

const HKDF_INFO_HMAC = new TextEncoder().encode('@zipbul/cookie hmac v2');
const HKDF_INFO_AES = new TextEncoder().encode('@zipbul/cookie aes-gcm v2');
const HKDF_SALT = new TextEncoder().encode('@zipbul/cookie/2026');

const utf8 = new TextEncoder();

interface CookieMeta {
  explicit: Set<keyof CookieAttributes>;
  priority?: CookiePriority;
}

export class CookieParser {
  private readonly meta = new WeakMap<Cookie, CookieMeta>();
  private readonly hmacKeyPromises: Promise<{ key: CryptoKey; kid: Uint8Array }>[];
  private readonly aesKeyPromises: Promise<{ key: CryptoKey; kid: Uint8Array }>[];
  private readonly encryptCounters: Map<number, number>;

  private constructor(private readonly options: ResolvedCookieParserOptions) {
    this.hmacKeyPromises = options.secrets !== null
      ? options.secrets.map((s) => deriveHmacKey(s, this.hashName()))
      : [];
    this.aesKeyPromises = options.encryptionSecrets !== null
      ? options.encryptionSecrets.map((s) => deriveAesKey(s))
      : [];
    this.encryptCounters = new Map();
  }

  public static create(options?: CookieParserOptions): CookieParser {
    const resolved = resolveCookieParserOptions(options);
    const validation = validateCookieParserOptions(resolved);
    if (isErr(validation)) throw new CookieError(validation.data);
    return new CookieParser(resolved);
  }

  public get isSigningConfigured(): boolean {
    return this.options.secrets !== null;
  }

  public get isEncryptionConfigured(): boolean {
    return this.options.encryptionSecrets !== null;
  }

  public createCookie(name: string, value: string, options?: CookieAttributes): Cookie {
    this.assertValidName(name);
    this.assertNameValueSize(name, value);

    const explicit = new Set<keyof CookieAttributes>();
    if (options) {
      for (const k of Object.keys(options) as (keyof CookieAttributes)[]) {
        if (options[k] !== undefined) explicit.add(k);
      }
    }

    const merged = this.mergeAttributes(options);

    if (merged.maxAge != null) {
      this.assertValidMaxAge(merged.maxAge);
    }
    if (merged.expires !== undefined && merged.expires !== null) {
      this.assertValidExpires(merged.expires);
    }
    if (merged.domain != null) {
      this.assertValidDomain(merged.domain);
    }
    if (merged.path != null) {
      this.assertValidPath(merged.path);
    }
    if (merged.priority != null) {
      this.assertValidPriority(merged.priority);
    }
    this.assertAttributeSizes(merged);

    const priority = merged.priority;
    const bunOpts: Record<string, unknown> = { ...merged };
    delete bunOpts.priority;

    let cookie: Cookie;
    try {
      cookie = new Cookie(name, value, bunOpts);
    } catch (e) {
      throw this.wrapBunError(e);
    }

    this.meta.set(cookie, { explicit, priority });
    return cookie;
  }

  public serialize(cookie: Cookie, context?: SerializeContext): string {
    this.assertValidName(cookie.name);
    this.assertNameValueSize(cookie.name, cookie.value);

    const meta = this.meta.get(cookie);
    const explicit = meta?.explicit ?? new Set<keyof CookieAttributes>();
    const { defaults } = this.options;

    const target = this.applyDefaultsForSerialize(cookie, explicit, context);

    if (target.sameSite === 'none' && !target.secure) {
      throw new CookieError({
        reason: CookieErrorReason.SameSiteNoneRequiresSecure,
        message: 'SameSite=None cookies must have the Secure attribute',
      });
    }
    if (target.partitioned && !target.secure) {
      throw new CookieError({
        reason: CookieErrorReason.PartitionedRequiresSecure,
        message: 'Partitioned cookies must have the Secure attribute',
      });
    }
    if (target.maxAge != null) {
      this.assertValidMaxAge(target.maxAge);
      if (target.maxAge > MAX_LIFETIME_SECONDS) {
        throw new CookieError({
          reason: CookieErrorReason.MaxLifetimeExceeded,
          message: `Max-Age exceeds 400-day limit (${MAX_LIFETIME_SECONDS}s)`,
        });
      }
    }
    if (target.expires != null) {
      this.assertExpiresWithinLimit(target.expires);
    }
    if (target.domain != null) this.assertValidDomain(target.domain);
    if (target.path != null) this.assertValidPath(target.path);

    if (this.options.prefixValidation) {
      this.validatePrefix(target);
    }

    let header: string;
    try {
      header = target.serialize();
    } catch (e) {
      throw this.wrapBunError(e);
    }

    const priority = meta?.priority ?? (defaults.priority ?? null);
    if (priority !== null) {
      const cap = priority.charAt(0).toUpperCase() + priority.slice(1);
      header = `${header}; Priority=${cap}`;
    }

    if (Buffer.byteLength(header, 'utf8') > MAX_HEADER_OCTETS) {
      throw new CookieError({
        reason: CookieErrorReason.CookieTooLarge,
        message: `serialized cookie exceeds ${MAX_HEADER_OCTETS} bytes`,
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
    this.assertValidName(cookie.name);

    const data = utf8.encode(cookie.name + NAME_VALUE_SEPARATOR + cookie.value);
    const signed = this.signSync(data);
    return this.cloneWithValue(cookie, `${cookie.value}.${signed}`);
  }

  public async unsign(cookie: Cookie): Promise<Cookie> {
    if (this.options.secrets === null) {
      throw new CookieError({
        reason: CookieErrorReason.SigningNotConfigured,
        message: 'unsigning requires secrets to be configured',
      });
    }
    this.assertValidName(cookie.name);

    const dotIndex = cookie.value.lastIndexOf('.');
    if (dotIndex === -1) {
      throw new CookieError({
        reason: CookieErrorReason.InvalidSignature,
        message: 'signed cookie value must contain a dot separator',
      });
    }

    const value = cookie.value.slice(0, dotIndex);
    const signature = cookie.value.slice(dotIndex + 1);
    let sigBlob: Uint8Array;
    try {
      sigBlob = bufferFromB64Url(signature);
    } catch {
      throw new CookieError({
        reason: CookieErrorReason.SignatureVerificationFailed,
        message: 'cookie signature verification failed',
      });
    }
    if (sigBlob.length < KID_LENGTH + 1) {
      throw new CookieError({
        reason: CookieErrorReason.SignatureVerificationFailed,
        message: 'cookie signature verification failed',
      });
    }

    const sigKid = sigBlob.subarray(0, KID_LENGTH);
    const macBytes = sigBlob.subarray(KID_LENGTH);
    const dataBytes = utf8.encode(cookie.name + NAME_VALUE_SEPARATOR + value);

    // Strict KID matching: a cookie's signature MUST identify a configured key by its KID.
    // We still iterate every configured key (constant-time over the key set) and verify on KID match,
    // never short-circuiting, to avoid leaking which slot matched.
    let valid = false;
    for (const keyEntry of this.hmacKeyPromises) {
      const { key, kid } = await keyEntry;
      const kidMatches = constantTimeEqual(sigKid, kid);
      const ok = await crypto.subtle.verify('HMAC', key, macBytes as Uint8Array<ArrayBuffer>, dataBytes);
      valid = valid || (kidMatches && ok);
    }

    if (valid) {
      return this.cloneWithValue(cookie, value);
    }

    throw new CookieError({
      reason: CookieErrorReason.SignatureVerificationFailed,
      message: 'cookie signature verification failed',
    });
  }

  public async encrypt(cookie: Cookie): Promise<Cookie> {
    if (this.options.encryptionSecrets === null) {
      throw new CookieError({
        reason: CookieErrorReason.EncryptionNotConfigured,
        message: 'encryption requires encryptionSecret to be configured',
      });
    }
    this.assertValidName(cookie.name);

    const { key, kid } = await this.aesKeyPromises[0]!;
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const aad = utf8.encode(cookie.name);

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: aad, tagLength: AUTH_TAG_BITS },
      key,
      utf8.encode(cookie.value),
    );

    const ctBytes = new Uint8Array(ciphertext);
    const combined = new Uint8Array(KID_LENGTH + IV_LENGTH + ctBytes.length);
    combined.set(kid, 0);
    combined.set(iv, KID_LENGTH);
    combined.set(ctBytes, KID_LENGTH + IV_LENGTH);

    const next = (this.encryptCounters.get(0) ?? 0) + 1;
    this.encryptCounters.set(0, next);
    if (this.options.onEncrypt !== null) {
      try { this.options.onEncrypt({ keyIndex: 0, counter: next }); } catch { /* swallow */ }
    }

    return this.cloneWithValue(cookie, bufferToB64Url(combined));
  }

  public async decrypt(cookie: Cookie): Promise<Cookie> {
    if (this.options.encryptionSecrets === null) {
      throw new CookieError({
        reason: CookieErrorReason.EncryptionNotConfigured,
        message: 'decryption requires encryptionSecret to be configured',
      });
    }
    this.assertValidName(cookie.name);

    let combined: Uint8Array;
    try {
      combined = bufferFromB64Url(cookie.value);
    } catch {
      throw new CookieError({
        reason: CookieErrorReason.InvalidCiphertext,
        message: 'ciphertext is not valid base64url',
      });
    }
    if (combined.length < MIN_CIPHERTEXT_LENGTH) {
      throw new CookieError({
        reason: CookieErrorReason.InvalidCiphertext,
        message: 'ciphertext is too short to be valid',
      });
    }

    const ctKid = combined.subarray(0, KID_LENGTH);
    const iv = combined.subarray(KID_LENGTH, KID_LENGTH + IV_LENGTH);
    const ct = combined.subarray(KID_LENGTH + IV_LENGTH);
    const aad = utf8.encode(cookie.name);

    const matchedKeys: CryptoKey[] = [];
    const allKeys: CryptoKey[] = [];
    for (const entry of this.aesKeyPromises) {
      const { key, kid } = await entry;
      allKeys.push(key);
      if (constantTimeEqual(ctKid, kid)) matchedKeys.push(key);
    }

    const tryKeys = matchedKeys.length > 0 ? matchedKeys : allKeys;
    for (const key of tryKeys) {
      try {
        const plaintext = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: iv as Uint8Array<ArrayBuffer>, additionalData: aad, tagLength: AUTH_TAG_BITS },
          key,
          ct as Uint8Array<ArrayBuffer>,
        );
        return this.cloneWithValue(cookie, new TextDecoder().decode(plaintext));
      } catch { /* try next */ }
    }

    throw new CookieError({
      reason: CookieErrorReason.DecryptionFailed,
      message: 'cookie decryption failed',
    });
  }

  public validatePrefix(cookie: Cookie): void {
    this.assertValidName(cookie.name);
    const lower = cookie.name.toLowerCase();

    if (lower.startsWith('__host-')) {
      if (!cookie.secure) {
        throw new CookieError({
          reason: CookieErrorReason.HostPrefixRequiresSecure,
          message: '__Host- cookies must have the Secure attribute',
        });
      }
      if (cookie.domain != null && cookie.domain !== '') {
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

    if (lower.startsWith('__secure-')) {
      if (!cookie.secure) {
        throw new CookieError({
          reason: CookieErrorReason.SecurePrefixRequiresSecure,
          message: '__Secure- cookies must have the Secure attribute',
        });
      }
      return;
    }

    if (lower.startsWith('__http-') || lower.startsWith('__host-http-')) {
      if (!cookie.httpOnly) {
        throw new CookieError({
          reason: CookieErrorReason.HttpPrefixRequiresHttpOnly,
          message: '__Http- / __Host-Http- cookies must have the HttpOnly attribute',
        });
      }
    }
  }

  // --- internals ---

  private hashName(): 'SHA-256' | 'SHA-384' | 'SHA-512' {
    return `SHA-${this.options.algorithm.slice(3)}` as 'SHA-256' | 'SHA-384' | 'SHA-512';
  }

  private mergeAttributes(options?: CookieAttributes): CookieAttributes {
    const { defaults } = this.options;
    const merged: CookieAttributes = {};

    if (defaults.httpOnly !== null) merged.httpOnly = defaults.httpOnly;
    if (defaults.secure !== null && defaults.secure !== 'auto') merged.secure = defaults.secure;
    if (defaults.sameSite !== null) merged.sameSite = defaults.sameSite;
    if (defaults.path !== null) merged.path = defaults.path;
    if (defaults.domain !== null) merged.domain = defaults.domain;
    if (defaults.maxAge !== null) merged.maxAge = defaults.maxAge;
    if (defaults.expires !== null) merged.expires = defaults.expires;
    if (defaults.partitioned !== null) merged.partitioned = defaults.partitioned;
    if (defaults.priority !== null) merged.priority = defaults.priority;

    if (options) {
      for (const [key, val] of Object.entries(options)) {
        if (val === undefined || val === null) continue;
        (merged as Record<string, unknown>)[key] = val;
      }
    }

    return merged;
  }

  private applyDefaultsForSerialize(
    cookie: Cookie,
    explicit: Set<keyof CookieAttributes>,
    context?: SerializeContext,
  ): Cookie {
    const { defaults } = this.options;

    let resolvedSecure: boolean | undefined = undefined;
    if (defaults.secure === 'auto' && !explicit.has('secure')) {
      resolvedSecure = context?.isSecure ?? false;
    }

    const applyDomain = cookie.domain == null && defaults.domain !== null;
    const applyMaxAge = cookie.maxAge == null && defaults.maxAge !== null;
    const applyExpires = cookie.expires == null && defaults.expires !== null;
    const applySecure = resolvedSecure !== undefined;

    if (!applyDomain && !applyMaxAge && !applyExpires && !applySecure) {
      return cookie;
    }

    return new Cookie(cookie.name, cookie.value, {
      domain: applyDomain ? defaults.domain! : (cookie.domain ?? undefined),
      path: cookie.path ?? undefined,
      secure: applySecure ? resolvedSecure! : cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite ?? undefined,
      maxAge: applyMaxAge ? defaults.maxAge! : (cookie.maxAge ?? undefined),
      expires: applyExpires ? defaults.expires! : (cookie.expires ?? undefined),
      partitioned: cookie.partitioned,
    });
  }

  private signSync(data: Uint8Array): string {
    const secret = this.options.secrets![0]!;
    const hash = this.hashName();
    const derivedKey = deriveHmacKeyBytesSync(secret, hash);
    const algoName = hash.toLowerCase().replace('-', '') as 'sha256' | 'sha384' | 'sha512';
    const hasher = new Bun.CryptoHasher(algoName, derivedKey);
    hasher.update(data);
    const mac = hasher.digest();
    const kidHash = new Bun.CryptoHasher('sha256');
    kidHash.update(derivedKey);
    const kid = new Uint8Array(kidHash.digest()).subarray(0, KID_LENGTH);
    const blob = new Uint8Array(KID_LENGTH + mac.byteLength);
    blob.set(kid, 0);
    blob.set(new Uint8Array(mac), KID_LENGTH);
    return bufferToB64Url(blob);
  }

  private assertValidName(name: string): void {
    if (name.length === 0 || INVALID_TOKEN_CHARS.test(name)) {
      throw new CookieError({
        reason: CookieErrorReason.InvalidCookieName,
        message: 'cookie name must be a valid RFC 9110 token',
      });
    }
  }

  private assertNameValueSize(name: string, value: string): void {
    const bytes = Buffer.byteLength(name, 'utf8') + Buffer.byteLength(value, 'utf8');
    if (bytes > MAX_NAME_VALUE_OCTETS) {
      throw new CookieError({
        reason: CookieErrorReason.CookieTooLarge,
        message: `cookie name+value exceeds ${MAX_NAME_VALUE_OCTETS} octets (${bytes})`,
      });
    }
  }

  private assertAttributeSizes(merged: CookieAttributes): void {
    const check = (label: string, val: string | undefined) => {
      if (val === undefined) return;
      const len = Buffer.byteLength(val, 'utf8');
      if (len > MAX_ATTRIBUTE_OCTETS) {
        throw new CookieError({
          reason: CookieErrorReason.AttributeTooLarge,
          message: `${label} attribute exceeds ${MAX_ATTRIBUTE_OCTETS} octets (${len})`,
        });
      }
    };
    check('Domain', merged.domain);
    check('Path', merged.path);
    if (typeof merged.expires === 'string') check('Expires', merged.expires);
  }

  private assertValidMaxAge(maxAge: number): void {
    if (!Number.isInteger(maxAge)) {
      throw new CookieError({
        reason: CookieErrorReason.InvalidMaxAge,
        message: 'Max-Age must be a finite integer',
      });
    }
    if (maxAge > MAX_LIFETIME_SECONDS) {
      throw new CookieError({
        reason: CookieErrorReason.MaxLifetimeExceeded,
        message: `Max-Age exceeds 400-day limit (${MAX_LIFETIME_SECONDS}s)`,
      });
    }
  }

  private assertValidExpires(expires: number | Date | string): void {
    let ms: number;
    if (typeof expires === 'number') {
      ms = expires;
    } else if (expires instanceof Date) {
      ms = expires.getTime();
    } else {
      ms = Date.parse(expires);
    }
    if (!Number.isFinite(ms)) {
      throw new CookieError({
        reason: CookieErrorReason.InvalidExpires,
        message: 'expires must be a finite timestamp, Date, or RFC 7231 IMF-fixdate string',
      });
    }
    this.assertExpiresWithinLimit(expires);
  }

  private assertExpiresWithinLimit(expires: number | Date | string): void {
    let ms: number;
    if (typeof expires === 'number') ms = expires;
    else if (expires instanceof Date) ms = expires.getTime();
    else ms = Date.parse(expires);
    if (!Number.isFinite(ms)) return;
    const delta = ms - Date.now();
    if (delta > MAX_LIFETIME_MS) {
      throw new CookieError({
        reason: CookieErrorReason.MaxLifetimeExceeded,
        message: `Expires exceeds 400-day limit from now`,
      });
    }
  }

  private assertValidDomain(domain: string): void {
    if (domain.length === 0) {
      throw new CookieError({
        reason: CookieErrorReason.InvalidDomain,
        message: 'Domain attribute must not be an empty string',
      });
    }
    if (/[;\r\n]/.test(domain)) {
      throw new CookieError({
        reason: CookieErrorReason.InvalidDomain,
        message: 'Domain must not contain semicolons or newlines',
      });
    }
    if (!RFC1123_DOMAIN.test(domain)) {
      throw new CookieError({
        reason: CookieErrorReason.InvalidDomain,
        message: 'Domain must be a valid RFC 1123 subdomain (LDH rule)',
      });
    }
    const stripped = domain.replace(/^\.+/, '').toLowerCase();
    if (this.options.publicSuffixCheck(stripped)) {
      throw new CookieError({
        reason: CookieErrorReason.DomainPublicSuffix,
        message: 'Domain attribute must not be a public suffix',
      });
    }
  }

  private assertValidPath(path: string): void {
    if (/[;\r\n]/.test(path)) {
      throw new CookieError({
        reason: CookieErrorReason.InvalidPath,
        message: 'Path must not contain semicolons or newlines',
      });
    }
    if (path !== '' && !path.startsWith('/')) {
      throw new CookieError({
        reason: CookieErrorReason.InvalidPath,
        message: 'Path must start with "/"',
      });
    }
  }

  private assertValidPriority(p: string): void {
    if (!PRIORITY_VALUES.has(p as CookiePriority)) {
      throw new CookieError({
        reason: CookieErrorReason.InvalidPriority,
        message: 'priority must be one of: low, medium, high',
      });
    }
  }

  private wrapBunError(e: unknown): CookieError {
    if (e instanceof CookieError) return e;
    const message = e instanceof Error ? e.message : String(e);
    if (/cookie name/i.test(message)) {
      return new CookieError({ reason: CookieErrorReason.InvalidCookieName, message });
    }
    if (/expir/i.test(message)) {
      return new CookieError({ reason: CookieErrorReason.InvalidExpires, message });
    }
    if (/domain/i.test(message)) {
      return new CookieError({ reason: CookieErrorReason.InvalidDomain, message });
    }
    if (/path/i.test(message)) {
      return new CookieError({ reason: CookieErrorReason.InvalidPath, message });
    }
    if (/value/i.test(message)) {
      return new CookieError({ reason: CookieErrorReason.InvalidCookieValue, message });
    }
    return new CookieError({ reason: CookieErrorReason.CookieParserError, message });
  }

  private cloneWithValue(source: Cookie, newValue: string): Cookie {
    const { defaults } = this.options;
    const cloned = new Cookie(source.name, newValue, {
      domain: source.domain ?? defaults.domain ?? undefined,
      path: source.path ?? undefined,
      secure: source.secure,
      httpOnly: source.httpOnly,
      sameSite: source.sameSite ?? undefined,
      maxAge: source.maxAge ?? defaults.maxAge ?? undefined,
      expires: source.expires ?? defaults.expires ?? undefined,
      partitioned: source.partitioned,
    });
    const sourceMeta = this.meta.get(source);
    if (sourceMeta) this.meta.set(cloned, sourceMeta);
    return cloned;
  }
}

// --- key derivation ---

async function deriveHmacKey(secret: string, hash: 'SHA-256' | 'SHA-384' | 'SHA-512'): Promise<{ key: CryptoKey; kid: Uint8Array }> {
  const ikm = utf8.encode(secret);
  const baseKey = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash, salt: HKDF_SALT, info: HKDF_INFO_HMAC },
    baseKey,
    256,
  );
  const keyBytes = new Uint8Array(bits);
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash }, false, ['verify'],
  );
  const kid = await deriveKid(keyBytes);
  return { key, kid };
}

async function deriveAesKey(secret: string): Promise<{ key: CryptoKey; kid: Uint8Array }> {
  const ikm = utf8.encode(secret);
  const baseKey = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: HKDF_INFO_AES },
    baseKey,
    256,
  );
  const keyBytes = new Uint8Array(bits);
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt'],
  );
  const kid = await deriveKid(keyBytes);
  return { key, kid };
}

async function deriveKid(keyBytes: Uint8Array): Promise<Uint8Array> {
  const h = await crypto.subtle.digest('SHA-256', keyBytes as Uint8Array<ArrayBuffer>);
  return new Uint8Array(h, 0, KID_LENGTH);
}

function deriveHmacKeyBytesSync(secret: string, hash: 'SHA-256' | 'SHA-384' | 'SHA-512'): Uint8Array {
  // Sync HKDF derivation that mirrors async deriveHmacKey output exactly.
  const prk = hkdfExtract(secret, HKDF_SALT, hash);
  return hkdfExpand(prk, HKDF_INFO_HMAC, 32, hash);
}

function hkdfExtract(ikm: string | Uint8Array, salt: Uint8Array, hash: 'SHA-256' | 'SHA-384' | 'SHA-512'): Uint8Array {
  const algoName = hash.toLowerCase().replace('-', '');
  const h = new Bun.CryptoHasher(algoName as 'sha256' | 'sha384' | 'sha512', salt);
  h.update(typeof ikm === 'string' ? utf8.encode(ikm) : ikm);
  return new Uint8Array(h.digest());
}

function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number, hash: 'SHA-256' | 'SHA-384' | 'SHA-512'): Uint8Array {
  const algoName = hash.toLowerCase().replace('-', '') as 'sha256' | 'sha384' | 'sha512';
  const hashLen = hash === 'SHA-256' ? 32 : hash === 'SHA-384' ? 48 : 64;
  const N = Math.ceil(length / hashLen);
  const out = new Uint8Array(N * hashLen);
  let prev = new Uint8Array(0);
  for (let i = 1; i <= N; i++) {
    const h = new Bun.CryptoHasher(algoName, prk);
    h.update(prev);
    h.update(info);
    h.update(new Uint8Array([i]));
    prev = new Uint8Array(h.digest());
    out.set(prev, (i - 1) * hashLen);
  }
  return out.subarray(0, length);
}

function bufferFromB64Url(s: string): Uint8Array<ArrayBuffer> {
  const buf = Buffer.from(s, 'base64url');
  const ab = new ArrayBuffer(buf.byteLength);
  const out = new Uint8Array(ab);
  out.set(buf);
  return out;
}

function bufferToB64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength).toString('base64url');
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
