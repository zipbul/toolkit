import { describe, expect, it } from 'bun:test';
import { isErr } from '@zipbul/result';
import type { Err } from '@zipbul/result';

import { CookieErrorReason } from './enums';
import type { CookieErrorData } from './interfaces';
import { resolveCookieParserOptions, validateCookieParserOptions } from './options';

const VALID_SECRET = 'zt3oaxqd6dOCT4bNxEsuMoLxbpCnfOyiWBwS4vBWzxM';
const VALID_ENC_SECRET = '5qly1QnPB1M6tT3thbFxuaY6A7OXv2zS8_O3VTHTAQ8';

describe('resolveCookieParserOptions', () => {
  it('should return all defaults when no options provided', () => {
    const resolved = resolveCookieParserOptions();
    expect(resolved.secrets).toBeNull();
    expect(resolved.algorithm).toBe('sha256');
    expect(resolved.encryptionSecrets).toBeNull();
    expect(resolved.prefixValidation).toBe(true);
    expect(resolved.defaults.httpOnly).toBeNull();
    expect(resolved.defaults.secure).toBeNull();
    expect(resolved.defaults.sameSite).toBeNull();
    expect(resolved.defaults.path).toBeNull();
    expect(resolved.defaults.domain).toBeNull();
    expect(resolved.defaults.maxAge).toBeNull();
    expect(resolved.defaults.expires).toBeNull();
    expect(resolved.defaults.partitioned).toBeNull();
  });

  it('should return all defaults when empty options provided', () => {
    const resolved = resolveCookieParserOptions({});
    expect(resolved.secrets).toBeNull();
    expect(resolved.algorithm).toBe('sha256');
    expect(resolved.prefixValidation).toBe(true);
  });

  it('should resolve secrets when provided', () => {
    const resolved = resolveCookieParserOptions({ secrets: [VALID_SECRET, VALID_SECRET + '_alt'] });
    expect(resolved.secrets).toEqual([VALID_SECRET, VALID_SECRET + '_alt']);
  });

  it('should resolve algorithm when provided', () => {
    const resolved = resolveCookieParserOptions({ algorithm: 'sha512' });
    expect(resolved.algorithm).toBe('sha512');
  });

  it('should normalize encryptionSecret single string into array', () => {
    const resolved = resolveCookieParserOptions({ encryptionSecret: VALID_ENC_SECRET });
    expect(resolved.encryptionSecrets).toEqual([VALID_ENC_SECRET]);
  });

  it('should pass encryptionSecret array through unchanged', () => {
    const resolved = resolveCookieParserOptions({ encryptionSecret: [VALID_ENC_SECRET, VALID_ENC_SECRET + '_alt'] });
    expect(resolved.encryptionSecrets).toEqual([VALID_ENC_SECRET, VALID_ENC_SECRET + '_alt']);
  });

  it('should resolve prefixValidation when provided', () => {
    const resolved = resolveCookieParserOptions({ prefixValidation: true });
    expect(resolved.prefixValidation).toBe(true);
  });

  it('should resolve cookie defaults when provided', () => {
    const resolved = resolveCookieParserOptions({
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      domain: 'example.com',
      maxAge: 3600,
      expires: 1000,
      partitioned: true,
    });
    expect(resolved.defaults.httpOnly).toBe(true);
    expect(resolved.defaults.secure).toBe(true);
    expect(resolved.defaults.sameSite).toBe('strict');
    expect(resolved.defaults.path).toBe('/');
    expect(resolved.defaults.domain).toBe('example.com');
    expect(resolved.defaults.maxAge).toBe(3600);
    expect(resolved.defaults.expires).toBe(1000);
    expect(resolved.defaults.partitioned).toBe(true);
  });

  it('should resolve secure auto when provided', () => {
    const resolved = resolveCookieParserOptions({ secure: 'auto' });
    expect(resolved.defaults.secure).toBe('auto');
  });
});

describe('validateCookieParserOptions', () => {
  it('should return undefined when options are valid', () => {
    const resolved = resolveCookieParserOptions({ secrets: [VALID_SECRET], encryptionSecret: VALID_ENC_SECRET });
    expect(validateCookieParserOptions(resolved)).toBeUndefined();
  });

  it('should return undefined when no options provided', () => {
    const resolved = resolveCookieParserOptions();
    expect(validateCookieParserOptions(resolved)).toBeUndefined();
  });

  it('should return EmptySecrets when secrets array is empty', () => {
    const resolved = resolveCookieParserOptions();
    resolved.secrets = [];
    const result = validateCookieParserOptions(resolved);
    expect(isErr(result)).toBe(true);
    expect((result as Err<CookieErrorData>).data.reason).toBe(CookieErrorReason.EmptySecrets);
  });

  it('should return InvalidSecret when a secret is blank', () => {
    const resolved = resolveCookieParserOptions();
    resolved.secrets = [VALID_SECRET, '  '];
    const result = validateCookieParserOptions(resolved);
    expect(isErr(result)).toBe(true);
    expect((result as Err<CookieErrorData>).data.reason).toBe(CookieErrorReason.InvalidSecret);
  });

  it('should return WeakSecret when a signing secret is shorter than 32 chars', () => {
    const resolved = resolveCookieParserOptions();
    resolved.secrets = ['short-secret'];
    const result = validateCookieParserOptions(resolved);
    expect(isErr(result)).toBe(true);
    expect((result as Err<CookieErrorData>).data.reason).toBe(CookieErrorReason.WeakSecret);
  });

  it('should return InvalidEncryptionSecret when encryptionSecret is blank', () => {
    const resolved = resolveCookieParserOptions();
    resolved.encryptionSecrets = ['  '];
    const result = validateCookieParserOptions(resolved);
    expect(isErr(result)).toBe(true);
    expect((result as Err<CookieErrorData>).data.reason).toBe(CookieErrorReason.InvalidEncryptionSecret);
  });

  it('should return InvalidEncryptionSecret when encryptionSecrets array is empty', () => {
    const resolved = resolveCookieParserOptions();
    resolved.encryptionSecrets = [];
    const result = validateCookieParserOptions(resolved);
    expect(isErr(result)).toBe(true);
    expect((result as Err<CookieErrorData>).data.reason).toBe(CookieErrorReason.InvalidEncryptionSecret);
  });

  it('should return WeakSecret when an encryptionSecret is shorter than 32 chars', () => {
    const resolved = resolveCookieParserOptions();
    resolved.encryptionSecrets = ['short-enc'];
    const result = validateCookieParserOptions(resolved);
    expect(isErr(result)).toBe(true);
    expect((result as Err<CookieErrorData>).data.reason).toBe(CookieErrorReason.WeakSecret);
  });

  it('should return InvalidAlgorithm when algorithm is unsupported', () => {
    const resolved = resolveCookieParserOptions();
    resolved.algorithm = 'md5' as any;
    const result = validateCookieParserOptions(resolved);
    expect(isErr(result)).toBe(true);
    expect((result as Err<CookieErrorData>).data.reason).toBe(CookieErrorReason.InvalidAlgorithm);
  });

  it('should accept sha384 algorithm', () => {
    const resolved = resolveCookieParserOptions({ algorithm: 'sha384' });
    expect(validateCookieParserOptions(resolved)).toBeUndefined();
  });

  it('should accept sha512 algorithm', () => {
    const resolved = resolveCookieParserOptions({ algorithm: 'sha512' });
    expect(validateCookieParserOptions(resolved)).toBeUndefined();
  });
});

describe('kdfSalt option (RFC 5869 §3.1)', () => {
  it('uses default salt when omitted', () => {
    const r = resolveCookieParserOptions();
    expect(r.kdfSalt).toBeInstanceOf(Uint8Array);
    expect(r.kdfSalt.length).toBeGreaterThanOrEqual(16);
  });
  it('accepts string salt', () => {
    const r = resolveCookieParserOptions({ kdfSalt: 'my-deployment-salt-2026__padding' });
    expect(new TextDecoder().decode(r.kdfSalt)).toBe('my-deployment-salt-2026__padding');
  });
  it('accepts Uint8Array salt', () => {
    const bytes = new Uint8Array(20).fill(7);
    const r = resolveCookieParserOptions({ kdfSalt: bytes });
    expect(r.kdfSalt).toBe(bytes);
  });
  it('rejects salt shorter than 16 bytes', () => {
    const r = validateCookieParserOptions(resolveCookieParserOptions({ kdfSalt: 'short' }));
    expect(r).toBeDefined();
    expect((r as Err<CookieErrorData>).data.message).toContain('16 bytes');
  });
});

describe('validateSecretStrength entropy floor (NIST SP 800-131A / OWASP)', () => {
  it('rejects 32-byte low-entropy secret "abcdefgh".repeat(4) (96 bits)', () => {
    const r = validateCookieParserOptions(resolveCookieParserOptions({ secrets: ['abcdefgh'.repeat(4)] }));
    expect(r).toBeDefined();
    const e = (r as Err<CookieErrorData>).data;
    expect(e.reason).toBe(CookieErrorReason.WeakSecret);
    expect(e.message).toContain('entropy too low');
  });
  it('rejects 32-byte secret of single repeated byte (0 bits)', () => {
    const r = validateCookieParserOptions(resolveCookieParserOptions({ secrets: ['x'.repeat(40)] }));
    expect(r).toBeDefined();
    expect((r as Err<CookieErrorData>).data.reason).toBe(CookieErrorReason.WeakSecret);
  });
  it('rejects 31-byte secret regardless of entropy', () => {
    const r = validateCookieParserOptions(resolveCookieParserOptions({ secrets: [VALID_SECRET.slice(0, 31)] }));
    expect(r).toBeDefined();
    const e = (r as Err<CookieErrorData>).data;
    expect(e.reason).toBe(CookieErrorReason.WeakSecret);
    expect(e.message).toContain('32 bytes');
  });
  it('counts UTF-8 bytes, not UTF-16 code units (32-byte ASCII vs 16 emoji + 16 ASCII)', () => {
    // 16 emoji = 64 UTF-8 bytes alone, easily over 32 bytes.
    const r = validateCookieParserOptions(resolveCookieParserOptions({ secrets: ['🔐'.repeat(16) + 'abcdefghijklmnop'] }));
    expect(r).toBeUndefined();
  });
  it('accepts uniform random base64url 32-byte secret', () => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const secret = Buffer.from(bytes).toString('base64url');
    const r = validateCookieParserOptions(resolveCookieParserOptions({ secrets: [secret] }));
    expect(r).toBeUndefined();
  });
  it('applies the same check to encryptionSecret', () => {
    const r = validateCookieParserOptions(resolveCookieParserOptions({ encryptionSecret: 'abcdefgh'.repeat(4) }));
    expect(r).toBeDefined();
    expect((r as Err<CookieErrorData>).data.reason).toBe(CookieErrorReason.WeakSecret);
  });
});
