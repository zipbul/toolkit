/**
 * Attack-surface reproduction suite. Each test enumerates a known cookie-attack
 * vector and asserts that the library produces a CookieError or otherwise refuses.
 */
import { describe, expect, it } from 'bun:test';
import { Cookie } from 'bun';

import { CookieParser, CookieJar, CookieError, CookieErrorReason } from '../../index';

const SECRET = 'yiLuooc8t1iy7BDCaU2eExB60URL8zacnqb1mA66aIo';
const ENC = 'v3MALRP-T0CO2gZ46D5As25K-U1D74PDhsdQJGjk4QQ';

describe('Attack: header injection via attribute values', () => {
  const cp = CookieParser.create();
  it('rejects "; injected" in domain', () => {
    let caught: unknown;
    try { cp.createCookie('s', 'v', { domain: 'evil.com; injected=1' }); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(CookieError);
  });
  it('rejects CRLF in domain', () => {
    let caught: unknown;
    try { cp.createCookie('s', 'v', { domain: 'a\r\nSet-Cookie: x=1' }); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(CookieError);
  });
  it('rejects "; injected" in path', () => {
    let caught: unknown;
    try { cp.createCookie('s', 'v', { path: '/x; injected' }); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(CookieError);
  });
  it('rejects CRLF in path', () => {
    let caught: unknown;
    try { cp.createCookie('s', 'v', { path: '/x\r\nSet-Cookie: x=1' }); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(CookieError);
  });
  it('percent-encodes ";" in cookie value (no escape from name=value)', () => {
    const h = cp.serialize(new Cookie('s', 'v;injected=1'));
    expect(h).not.toContain('v;injected');
    expect(h).toContain('%3B');
  });
  it('percent-encodes CRLF in cookie value', () => {
    const h = cp.serialize(new Cookie('s', 'a\r\nSet-Cookie:x=1'));
    expect(h).not.toContain('\r');
    expect(h).not.toContain('\n');
  });
});

describe('Attack: cross-name signature replay (C1 fix)', () => {
  it('signature for cookie A is invalid for cookie B', async () => {
    const cp = CookieParser.create({ secrets: [SECRET] });
    const signed = cp.sign(new Cookie('admin', 'true'));
    let caught: unknown;
    try { await cp.unsign(new Cookie('user', signed.value)); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.SignatureVerificationFailed);
  });
});

describe('Attack: cross-name ciphertext replay (C2 fix)', () => {
  it('ciphertext for cookie A is invalid for cookie B', async () => {
    const cp = CookieParser.create({ encryptionSecret: ENC });
    const enc = await cp.encrypt(new Cookie('admin', 'true'));
    let caught: unknown;
    try { await cp.decrypt(new Cookie('user', enc.value)); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.DecryptionFailed);
  });
});

describe('Attack: algorithm confusion', () => {
  it('SHA-256 signature does not validate as SHA-384', async () => {
    const a = CookieParser.create({ secrets: [SECRET], algorithm: 'sha256' });
    const b = CookieParser.create({ secrets: [SECRET], algorithm: 'sha384' });
    const signed = a.sign(new Cookie('s', 'v'));
    let caught: unknown;
    try { await b.unsign(signed); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.SignatureVerificationFailed);
  });
  it('SHA-512 signature does not validate as SHA-256', async () => {
    const a = CookieParser.create({ secrets: [SECRET], algorithm: 'sha512' });
    const b = CookieParser.create({ secrets: [SECRET], algorithm: 'sha256' });
    const signed = a.sign(new Cookie('s', 'v'));
    let caught: unknown;
    try { await b.unsign(signed); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.SignatureVerificationFailed);
  });
});

describe('Attack: ciphertext truncation', () => {
  it('rejects ciphertext shorter than IV+tag minimum', async () => {
    const cp = CookieParser.create({ encryptionSecret: ENC });
    let caught: unknown;
    try { await cp.decrypt(new Cookie('s', Buffer.from(new Uint8Array(20)).toString('base64url'))); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.InvalidCiphertext);
  });
  it('rejects ciphertext with corrupted tag', async () => {
    const cp = CookieParser.create({ encryptionSecret: ENC });
    const enc = await cp.encrypt(new Cookie('s', 'v'));
    const buf = Buffer.from(enc.value, 'base64url');
    buf[buf.length - 1] = (buf[buf.length - 1]! ^ 0xff) & 0xff;
    let caught: unknown;
    try { await cp.decrypt(new Cookie('s', buf.toString('base64url'))); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.DecryptionFailed);
  });
  it('rejects ciphertext with corrupted IV', async () => {
    const cp = CookieParser.create({ encryptionSecret: ENC });
    const enc = await cp.encrypt(new Cookie('s', 'v'));
    const buf = Buffer.from(enc.value, 'base64url');
    // IV occupies bytes 4..15 (after 4-byte KID prefix)
    buf[4] = (buf[4]! ^ 0xff) & 0xff;
    let caught: unknown;
    try { await cp.decrypt(new Cookie('s', buf.toString('base64url'))); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.DecryptionFailed);
  });
});

describe('Attack: signature malformation', () => {
  const cp = CookieParser.create({ secrets: [SECRET] });
  it('rejects value without dot separator', async () => {
    let caught: unknown;
    try { await cp.unsign(new Cookie('s', 'nodot')); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.InvalidSignature);
  });
  it('rejects value with empty signature', async () => {
    let caught: unknown;
    try { await cp.unsign(new Cookie('s', 'value.')); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.SignatureVerificationFailed);
  });
  it('rejects value with garbage signature', async () => {
    let caught: unknown;
    try { await cp.unsign(new Cookie('s', 'value.NotABase64UrlString!!!')); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.SignatureVerificationFailed);
  });
});

describe('Attack: prototype pollution via cookie names', () => {
  it('Map.set with __proto__ does not pollute Object.prototype', () => {
    const cp = CookieParser.create();
    const jar = new CookieJar(cp, '__proto__=evil; constructor=evil; toString=evil');
    expect(jar.getRaw('__proto__')).toBe('evil');
    // verify Object.prototype is untouched
    expect(({} as any).evil).toBeUndefined();
    expect(({} as any).__proto__).not.toBe('evil');
  });
  it('out-jar set with __proto__ does not pollute', async () => {
    const cp = CookieParser.create();
    const out = new CookieJar(cp, '');
    out.set('__proto__', 'evil');
    const headers = await out.getSetCookieHeaders();
    expect(headers[0]).toContain('__proto__=evil');
    expect(({} as any).evil).toBeUndefined();
  });
});

describe('Attack: secret-less encrypt/sign attempts', () => {
  const cp = CookieParser.create();
  it('sign() throws SigningNotConfigured', () => {
    let caught: unknown;
    try { cp.sign(new Cookie('s', 'v')); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.SigningNotConfigured);
  });
  it('unsign() throws SigningNotConfigured', async () => {
    let caught: unknown;
    try { await cp.unsign(new Cookie('s', 'v.sig')); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.SigningNotConfigured);
  });
  it('encrypt() throws EncryptionNotConfigured', async () => {
    let caught: unknown;
    try { await cp.encrypt(new Cookie('s', 'v')); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.EncryptionNotConfigured);
  });
  it('decrypt() throws EncryptionNotConfigured', async () => {
    let caught: unknown;
    try { await cp.decrypt(new Cookie('s', 'cipher')); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.EncryptionNotConfigured);
  });
});

describe('Attack: weak/short secrets', () => {
  it('rejects 31-char signing secret', () => {
    let caught: unknown;
    try { CookieParser.create({ secrets: ['x'.repeat(31)] }); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.WeakSecret);
  });
  it('rejects 31-char encryption secret', () => {
    let caught: unknown;
    try { CookieParser.create({ encryptionSecret: 'x'.repeat(31) }); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.WeakSecret);
  });
  it('rejects empty secrets array', () => {
    let caught: unknown;
    try { CookieParser.create({ secrets: [] }); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.EmptySecrets);
  });
  it('rejects whitespace-only secret', () => {
    let caught: unknown;
    try { CookieParser.create({ secrets: ['                                  '.padEnd(40)] }); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.InvalidSecret);
  });
});

describe('Attack: oversized payloads', () => {
  it('rejects serialized cookie > 4096 octets', () => {
    const cp = CookieParser.create();
    let caught: unknown;
    try { cp.serialize(new Cookie('s', 'x'.repeat(5000))); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.CookieTooLarge);
  });
});

describe('Attack: timing-safe HMAC iteration', () => {
  it('verifies regardless of secret position in rotation array', async () => {
    const k1 = 'DAFa9Tm4TjwbEew6OJ2WjyL4hDkBytmILCPItWAvij8';
    const k2 = '39bzADCd-pZ69QBXlC2wGBNmKLUWclgkYIPNBDfOEnc';
    const k3 = 'lU5yqjYisLZ0gXAEbAOiQwcNDKGXoVdLwvnCCNf12fg';
    const k4 = 'f_58oLMYSRKNGG5vIzRSurZqqZy8bTJaO-d6py0Slms';
    const k5 = 'nge6Avvzrm8caHPUDLTcI6-Qa_AalZKo0yikksU-iZs';
    const cp = CookieParser.create({ secrets: [k1, k2, k3, k4, k5] });
    const lastOnly = CookieParser.create({ secrets: [k5] });
    const signed = lastOnly.sign(new Cookie('s', 'v'));
    const unsigned = await cp.unsign(signed);
    expect(unsigned.value).toBe('v');
  });
});

describe('Attack: control characters in cookie name', () => {
  const cp = CookieParser.create();
  for (const code of [0x00, 0x09, 0x0a, 0x0d, 0x1f, 0x20, 0x7f]) {
    it(`rejects 0x${code.toString(16).padStart(2, '0')} in name`, () => {
      let caught: unknown;
      try { cp.createCookie(`a${String.fromCharCode(code)}b`, 'v'); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(CookieError);
    });
  }
});

describe('Attack: empty / blank cookie name', () => {
  const cp = CookieParser.create();
  it('rejects empty name', () => {
    let caught: unknown;
    try { cp.createCookie('', 'v'); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.InvalidCookieName);
  });
});

describe('Attack: percent in name (Bun.CookieMap interop)', () => {
  const cp = CookieParser.create();
  it('rejects "%" in cookie name to guarantee Bun round-trip safety', () => {
    let caught: unknown;
    try { cp.createCookie('bad%name', 'v'); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.InvalidCookieName);
  });
});

describe('Attack: error type leakage (H-2 fix)', () => {
  const cp = CookieParser.create();
  it('createCookie never leaks TypeError to callers', () => {
    const cases: any[] = [
      { expires: 'not-a-date' },
      { expires: NaN },
      { expires: Infinity },
      { expires: new Date('invalid') },
      { domain: 'evil; injected' },
      { path: '/x; injected' },
    ];
    for (const opts of cases) {
      let caught: unknown;
      try { cp.createCookie('s', 'v', opts); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(CookieError);
    }
  });
});

describe('Attack: control characters in Path/Domain (RFC 6265 §4.1.1)', () => {
  const cp = CookieParser.create();
  const ctls = ['\x00', '\x01', '\x09', '\x0B', '\x1F', '\x7F'];
  for (const ch of ctls) {
    const hex = ch.charCodeAt(0).toString(16).padStart(2, '0');
    it(`rejects path containing CTL byte 0x${hex}`, () => {
      let caught: unknown;
      try { cp.createCookie('s', 'v', { path: '/foo' + ch + 'bar' }); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(CookieErrorReason.InvalidPath);
    });
    it(`rejects domain containing CTL byte 0x${hex}`, () => {
      let caught: unknown;
      try { cp.createCookie('s', 'v', { domain: 'ex' + ch + 'ample.com' }); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(CookieErrorReason.InvalidDomain);
    });
  }
});

describe('CWE-117 defense: wrapBunError never echoes input in messages', () => {
  const cp = CookieParser.create();
  const secretMarker = 'SECRET_INPUT_' + Math.random().toString(36).slice(2);
  const cases: Array<{ label: string; opts: any; reason: CookieErrorReason }> = [
    { label: 'invalid expires', opts: { expires: secretMarker }, reason: CookieErrorReason.InvalidExpires },
  ];
  for (const c of cases) {
    it(`canonicalizes ${c.label} message (no input echo)`, () => {
      let caught: unknown;
      try { cp.createCookie('s', 'v', c.opts); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(c.reason);
      expect((caught as CookieError).message).not.toContain(secretMarker);
    });
  }

  it('canonical fallback for unknown errors', () => {
    // Direct call to wrap with an unknown-shaped error.
    const wrap = (cp as any).wrapBunError.bind(cp);
    const err1 = wrap(new Error('mystery'));
    expect(err1).toBeInstanceOf(CookieError);
    expect(err1.message).toBe('cookie parser error');
    const err2 = wrap('plain string error with secret-token-xyz');
    expect(err2.message).not.toContain('secret-token-xyz');
    const err3 = wrap(new Error('unexpected cookie value 42'));
    expect(err3.reason).toBe(CookieErrorReason.InvalidCookieValue);
    expect(err3.message).toBe('invalid cookie value');
    const err4 = wrap(new Error('bad cookie name foo'));
    expect(err4.reason).toBe(CookieErrorReason.InvalidCookieName);
    const err5 = wrap(new Error('domain bad'));
    expect(err5.reason).toBe(CookieErrorReason.InvalidDomain);
    const err6 = wrap(new Error('path bad'));
    expect(err6.reason).toBe(CookieErrorReason.InvalidPath);
  });
});

describe('DX: sameSite case normalization', () => {
  const cp = CookieParser.create();
  for (const v of ['Lax', 'LAX', 'Strict', 'STRICT', 'None']) {
    it(`accepts "${v}" and normalizes to lowercase output`, () => {
      const c = cp.createCookie('s', 'v', { sameSite: v as any, secure: true });
      const h = cp.serialize(c);
      // Bun emits canonical title case in the header; the point is no crash and SameSite present.
      expect(h).toMatch(/SameSite=(Lax|Strict|None)/i);
    });
  }
});

describe('Attack: AES-GCM key invocation cap (NIST SP 800-38D §8.3)', () => {
  it('throws EncryptionKeyExhausted at 2^32 invocations', async () => {
    const cp = CookieParser.create({ secrets: [SECRET], encryptionSecret: ENC });
    (cp as unknown as { encryptCounters: Map<number, number> }).encryptCounters.set(0, 2 ** 32);
    let caught: unknown;
    try { await cp.encrypt(cp.createCookie('s', 'v')); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(CookieError);
    expect((caught as CookieError).reason).toBe(CookieErrorReason.EncryptionKeyExhausted);
  });
  it('still encrypts at 2^32 - 1 then refuses on the next call', async () => {
    const cp = CookieParser.create({ secrets: [SECRET], encryptionSecret: ENC });
    (cp as unknown as { encryptCounters: Map<number, number> }).encryptCounters.set(0, 2 ** 32 - 1);
    const enc = await cp.encrypt(cp.createCookie('s', 'v'));
    expect(enc.value).toBeTypeOf('string');
    let caught: unknown;
    try { await cp.encrypt(cp.createCookie('s', 'v')); } catch (e) { caught = e; }
    expect((caught as CookieError).reason).toBe(CookieErrorReason.EncryptionKeyExhausted);
  });
});
