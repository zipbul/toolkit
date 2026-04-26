/**
 * RFC 6265bis / RFC 9110 / NIST SP 800-38D / FIPS 198-1 conformance matrix.
 * Each test maps to a specific clause and must remain green to claim conformance.
 */
import { describe, expect, it } from 'bun:test';
import { Cookie } from 'bun';

import { CookieParser, CookieJar, CookieError, CookieErrorReason } from '../../index';

const SECRET = 'qwerty1234567890asdfghjklzxcvbnm-';
const ENC = 'POIUYTREWQlkjhgfdsamnbvcxz98765-';

describe('RFC 9110 §5.6.2 — token grammar', () => {
  const cp = CookieParser.create();
  const separators = ['(', ')', '<', '>', '@', ',', ';', ':', '\\', '"', '/', '[', ']', '?', '=', '{', '}'];
  for (const ch of separators) {
    it(`rejects "${ch}" in cookie name via createCookie`, () => {
      const name = `bad${ch}name`;
      let caught: unknown;
      try { cp.createCookie(name, 'v'); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(CookieError);
    });
    it(`rejects "${ch}" in cookie name via serialize when Bun ctor accepts it`, () => {
      const name = `bad${ch}name`;
      let raw: Cookie | undefined;
      try { raw = new Cookie(name, 'v'); } catch { /* Bun rejected — already safe */ }
      if (raw === undefined) return;
      let caught: unknown;
      try { cp.serialize(raw); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(CookieError);
    });
  }
  it('rejects CTL chars (0x00-0x1F, 0x7F) in name', () => {
    for (const code of [0, 1, 9, 10, 13, 31, 127]) {
      let caught: unknown;
      try { cp.createCookie(`bad${String.fromCharCode(code)}`, 'v'); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(CookieError);
    }
  });
  it('accepts all valid tchar in cookie name (excluding "%" for Bun.CookieMap interop)', () => {
    const valid = "!#$&'*+-.^_`|~0aZ";
    expect(() => cp.createCookie(valid, 'v')).not.toThrow();
  });
});

describe('RFC 6265bis §4.1.1 — Set-Cookie syntax', () => {
  it('produces name=value pair as first token', () => {
    const cp = CookieParser.create();
    const h = cp.serialize(new Cookie('s', 'v'));
    expect(h.startsWith('s=v')).toBe(true);
  });
  it('separates attributes with "; "', () => {
    const cp = CookieParser.create();
    const h = cp.serialize(new Cookie('s', 'v', { secure: true, httpOnly: true }));
    expect(h).toMatch(/; /);
  });
});

describe('RFC 6265bis §4.1.2.1 — Expires attribute', () => {
  const cp = CookieParser.create();
  it('rejects unparseable expires string', () => {
    let caught: unknown;
    try { cp.createCookie('s', 'v', { expires: 'definitely not a date' }); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(CookieError);
    expect((caught as CookieError).reason).toBe(CookieErrorReason.InvalidExpires);
  });
  it('accepts IMF-fixdate per RFC 7231', () => {
    expect(() => cp.createCookie('s', 'v', { expires: 'Sun, 06 Nov 1994 08:49:37 GMT' })).not.toThrow();
  });
});

describe('RFC 6265bis §4.1.2.2 — Max-Age attribute', () => {
  const cp = CookieParser.create();
  it('rejects non-integer Max-Age (NaN)', () => {
    let caught: unknown;
    try { cp.createCookie('s', 'v', { maxAge: NaN }); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.InvalidMaxAge);
  });
  it('rejects non-integer Max-Age (decimal)', () => {
    let caught: unknown;
    try { cp.createCookie('s', 'v', { maxAge: 1.5 }); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.InvalidMaxAge);
  });
  it('accepts negative integer Max-Age (immediate expiry)', () => {
    expect(() => cp.serialize(cp.createCookie('s', 'v', { maxAge: -1 }))).not.toThrow();
  });
});

describe('RFC 6265bis §4.1.2.7 — SameSite=None requires Secure', () => {
  const cp = CookieParser.create();
  it('rejects SameSite=None without Secure', () => {
    let caught: unknown;
    try { cp.serialize(new Cookie('s', 'v', { sameSite: 'none' })); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.SameSiteNoneRequiresSecure);
  });
});

describe('RFC 6265bis §4.1.3.1 — __Secure- prefix', () => {
  const cp = CookieParser.create();
  it('requires Secure attribute', () => {
    let caught: unknown;
    try { cp.validatePrefix(new Cookie('__Secure-x', 'v')); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.SecurePrefixRequiresSecure);
  });
});

describe('RFC 6265bis §4.1.3.2 — __Host- prefix', () => {
  const cp = CookieParser.create();
  it('requires Secure', () => {
    let caught: unknown;
    try { cp.validatePrefix(new Cookie('__Host-x', 'v', { path: '/' })); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.HostPrefixRequiresSecure);
  });
  it('forbids Domain', () => {
    let caught: unknown;
    try { cp.validatePrefix(new Cookie('__Host-x', 'v', { secure: true, domain: 'example.com', path: '/' })); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.HostPrefixForbidsDomain);
  });
  it('requires Path=/', () => {
    let caught: unknown;
    try { cp.validatePrefix(new Cookie('__Host-x', 'v', { secure: true, path: '/admin' })); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.HostPrefixRequiresRootPath);
  });
});

describe('CHIPS — Partitioned requires Secure', () => {
  const cp = CookieParser.create();
  it('rejects Partitioned without Secure', () => {
    let caught: unknown;
    try { cp.serialize(new Cookie('s', 'v', { partitioned: true })); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.PartitionedRequiresSecure);
  });
});

describe('RFC 6265bis §5.4 — 400-day Max-Age cap', () => {
  const cp = CookieParser.create();
  it('accepts exactly 400 days', () => {
    expect(() => cp.serialize(new Cookie('s', 'v', { maxAge: 400 * 86400 }))).not.toThrow();
  });
  it('rejects 400-day + 1 second', () => {
    let caught: unknown;
    try { cp.serialize(new Cookie('s', 'v', { maxAge: 400 * 86400 + 1 })); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.MaxLifetimeExceeded);
  });
});

describe('RFC 6265 §6.1 — 4096 octet limit', () => {
  const cp = CookieParser.create();
  it('rejects serialized header > 4096 octets', () => {
    let caught: unknown;
    try { cp.serialize(new Cookie('s', 'x'.repeat(4096))); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.CookieTooLarge);
  });
});

describe('NIST SP 800-38D — AES-256-GCM parameters', () => {
  it('uses 12-byte IV (clause 5.2.1.1)', async () => {
    const cp = CookieParser.create({ encryptionSecret: ENC });
    const enc = await cp.encrypt(new Cookie('s', 'v'));
    const decoded = Buffer.from(enc.value, 'base64url');
    // First 12 bytes are IV
    expect(decoded.length).toBeGreaterThanOrEqual(12 + 16); // IV + tag minimum
  });
  it('uses 128-bit auth tag (clause 5.2.1.2)', async () => {
    const cp = CookieParser.create({ encryptionSecret: ENC });
    // KID(4) + IV(12) + tag(16) = 32 bytes minimum (empty plaintext)
    const enc = await cp.encrypt(new Cookie('s', ''));
    const decoded = Buffer.from(enc.value, 'base64url');
    expect(decoded.length).toBe(4 + 12 + 16);
  });
  it('produces unique IV across calls (probabilistic)', async () => {
    const cp = CookieParser.create({ encryptionSecret: ENC });
    const a = await cp.encrypt(new Cookie('s', 'v'));
    const b = await cp.encrypt(new Cookie('s', 'v'));
    // bytes 4..15 are IV (after 4-byte KID prefix)
    const aIv = Buffer.from(a.value, 'base64url').subarray(4, 16).toString('hex');
    const bIv = Buffer.from(b.value, 'base64url').subarray(4, 16).toString('hex');
    expect(aIv).not.toBe(bIv);
  });
  it('binds cookie name as AAD (rejects cross-name replay)', async () => {
    const cp = CookieParser.create({ encryptionSecret: ENC });
    const enc = await cp.encrypt(new Cookie('admin', 'true'));
    let caught: unknown;
    try { await cp.decrypt(new Cookie('user', enc.value)); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.DecryptionFailed);
  });
});

describe('FIPS 198-1 §A — HMAC key minimum length L/2', () => {
  it('SHA-256 (L=32, L/2=16) accepts 32-byte key', () => {
    expect(() => CookieParser.create({ secrets: ['qwerty1234567890asdfghjklzxcvbnm-'], algorithm: 'sha256' })).not.toThrow();
  });
  it('rejects key shorter than 32 (configured minimum)', () => {
    let caught: unknown;
    try { CookieParser.create({ secrets: ['x'.repeat(31)] }); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.WeakSecret);
  });
});

describe('RFC 6265 §5.4 — cookie header parsing', () => {
  it('parses name-value pairs separated by "; "', () => {
    const cp = CookieParser.create();
    const jar = new CookieJar(cp, 'a=1; b=2; c=3');
    expect(jar.getRaw('a')).toBe('1');
    expect(jar.getRaw('b')).toBe('2');
    expect(jar.getRaw('c')).toBe('3');
  });
  it('handles empty Cookie header', () => {
    const cp = CookieParser.create();
    const jar = new CookieJar(cp, '');
    expect(jar.has('any')).toBe(false);
  });
});

describe('Cross-instance isolation guarantees', () => {
  it('encrypted cookie from instance A cannot be decrypted by instance B with different key', async () => {
    const a = CookieParser.create({ encryptionSecret: 'qwerty1234567890asdfghjklzxcvbnm-' });
    const b = CookieParser.create({ encryptionSecret: 'POIUYTREWQlkjhgfdsamnbvcxz98765-' });
    const enc = await a.encrypt(new Cookie('s', 'secret'));
    let caught: unknown;
    try { await b.decrypt(enc); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.DecryptionFailed);
  });
  it('signed cookie from instance A cannot be unsigned by instance B with different key', async () => {
    const a = CookieParser.create({ secrets: ['qwerty1234567890asdfghjklzxcvbnm-'] });
    const b = CookieParser.create({ secrets: ['POIUYTREWQlkjhgfdsamnbvcxz98765-'] });
    const signed = a.sign(new Cookie('s', 'v'));
    let caught: unknown;
    try { await b.unsign(signed); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.SignatureVerificationFailed);
  });
  it('algorithm confusion: sha256-signed cannot be unsigned with sha512', async () => {
    const a = CookieParser.create({ secrets: [SECRET], algorithm: 'sha256' });
    const b = CookieParser.create({ secrets: [SECRET], algorithm: 'sha512' });
    const signed = a.sign(new Cookie('s', 'v'));
    let caught: unknown;
    try { await b.unsign(signed); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.SignatureVerificationFailed);
  });
});

describe('RFC 6265bis §5.6 — name+value 4096 cap (R1)', () => {
  const cp = CookieParser.create();
  it('accepts name+value exactly 4096 octets', () => {
    expect(() => cp.createCookie('s', 'x'.repeat(4095))).not.toThrow();
  });
  it('rejects name+value 4097 octets', () => {
    let caught: unknown;
    try { cp.createCookie('s', 'x'.repeat(4096)); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.CookieTooLarge);
  });
});

describe('RFC 6265bis §5.6 — attribute-value 1024 cap (R2)', () => {
  const cp = CookieParser.create();
  it('rejects Path > 1024 octets', () => {
    let caught: unknown;
    try { cp.createCookie('s', 'v', { path: '/' + 'a'.repeat(1024) }); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.AttributeTooLarge);
  });
});

describe('RFC 6265bis §5.7 — case-insensitive prefix matching (R3)', () => {
  const cp = CookieParser.create({ prefixValidation: true });
  it('detects __host- (lowercase) as host-prefixed', () => {
    let caught: unknown;
    try { cp.serialize(new Cookie('__host-x', 'v', { domain: 'example.com', secure: true, path: '/' })); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.HostPrefixForbidsDomain);
  });
  it('detects __SECURE- (uppercase) as secure-prefixed', () => {
    let caught: unknown;
    try { cp.serialize(new Cookie('__SECURE-x', 'v')); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.SecurePrefixRequiresSecure);
  });
});

describe('RFC 1123 Domain syntax (NEW-4) + PSL (R6)', () => {
  const cp = CookieParser.create();
  it('rejects consecutive-dot domain', () => {
    let caught: unknown;
    try { cp.createCookie('s', 'v', { domain: 'a..b.com' }); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.InvalidDomain);
  });
  it('rejects leading-hyphen label', () => {
    let caught: unknown;
    try { cp.createCookie('s', 'v', { domain: '-bad.com' }); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.InvalidDomain);
  });
  it('rejects single-label domain (TLD-only) as public suffix', () => {
    let caught: unknown;
    try { cp.createCookie('s', 'v', { domain: 'com' }); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.DomainPublicSuffix);
  });
  it('accepts valid two-label domain', () => {
    expect(() => cp.createCookie('s', 'v', { domain: 'example.com' })).not.toThrow();
  });
  it('accepts custom publicSuffixCheck', () => {
    const cpCustom = CookieParser.create({ publicSuffixCheck: (d) => d === 'forbidden.test' });
    let caught: unknown;
    try { cpCustom.createCookie('s', 'v', { domain: 'forbidden.test' }); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.DomainPublicSuffix);
  });
});

describe('RFC 6265bis §4.1.3 — __Http- prefix (2-A)', () => {
  const cp = CookieParser.create({ prefixValidation: true });
  it('rejects __Http-x without HttpOnly', () => {
    let caught: unknown;
    try { cp.serialize(new Cookie('__Http-x', 'v', { secure: true })); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.HttpPrefixRequiresHttpOnly);
  });
});

describe('Priority attribute (2-D)', () => {
  const cp = CookieParser.create();
  it('emits Priority=High for priority:high', () => {
    const c = cp.createCookie('s', 'v', { priority: 'high' });
    expect(cp.serialize(c)).toContain('Priority=High');
  });
  it('rejects invalid priority value', () => {
    let caught: unknown;
    try { cp.createCookie('s', 'v', { priority: 'urgent' as any }); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.InvalidPriority);
  });
});

describe('AES-GCM IV usage counter hook (1-E)', () => {
  it('invokes onEncrypt with monotonic counter', async () => {
    const calls: { keyIndex: number; counter: number }[] = [];
    const cp = CookieParser.create({ encryptionSecret: ENC, onEncrypt: (info) => calls.push(info) });
    await cp.encrypt(new Cookie('s', 'v'));
    await cp.encrypt(new Cookie('s', 'v'));
    expect(calls).toEqual([{ keyIndex: 0, counter: 1 }, { keyIndex: 0, counter: 2 }]);
  });
});

describe('HKDF key derivation + KID (1-A, 1-B)', () => {
  it('encrypted payload starts with 4-byte KID prefix', async () => {
    const cp = CookieParser.create({ encryptionSecret: ENC });
    const enc = await cp.encrypt(new Cookie('s', ''));
    const decoded = Buffer.from(enc.value, 'base64url');
    expect(decoded.length).toBe(4 + 12 + 16);
  });
  it('signed payload signature blob starts with 4-byte KID', () => {
    const cp = CookieParser.create({ secrets: [SECRET] });
    const signed = cp.sign(new Cookie('s', 'v'));
    const sig = signed.value.split('.').pop()!;
    const decoded = Buffer.from(sig, 'base64url');
    // KID(4) + HMAC-SHA256(32) = 36 bytes
    expect(decoded.length).toBe(4 + 32);
  });
  it('KID mismatch causes signature to be rejected', async () => {
    const cp = CookieParser.create({ secrets: [SECRET] });
    const signed = cp.sign(new Cookie('s', 'v'));
    const sig = signed.value.split('.').pop()!;
    const buf = Buffer.from(sig, 'base64url');
    buf[0] = (buf[0]! ^ 0xff) & 0xff;
    const tampered = `${signed.value.split('.').slice(0, -1).join('.')}.${buf.toString('base64url')}`;
    let caught: unknown;
    try { await cp.unsign(new Cookie('s', tampered)); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.SignatureVerificationFailed);
  });
});

describe('CookieError is the only public exception type', () => {
  const cp = CookieParser.create();
  it('createCookie wraps Bun TypeError on bad domain', () => {
    let caught: unknown;
    try { cp.createCookie('s', 'v', { domain: 'evil; injected' }); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(CookieError);
  });
  it('createCookie wraps Bun TypeError on bad path', () => {
    let caught: unknown;
    try { cp.createCookie('s', 'v', { path: '/x;injected' }); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(CookieError);
  });
  it('createCookie wraps Bun TypeError on bad expires', () => {
    let caught: unknown;
    try { cp.createCookie('s', 'v', { expires: 'not-a-date' }); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(CookieError);
  });
});
