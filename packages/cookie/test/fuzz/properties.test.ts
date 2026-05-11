/**
 * Property-based fuzz testing of CookieParser invariants.
 * Each property is checked over many random inputs via fast-check.
 */
import { describe, it } from 'bun:test';
import { Cookie } from 'bun';
import * as fc from 'fast-check';

import { CookieParser, CookieError, CookieErrorReason } from '../../index';

const RUNS = 200;

// RFC 9110 §5.6.2 tchar minus '%' (Bun.CookieMap percent-decodes — see cookie-parser.ts comment)
const tcharArr = "!#$&'*+-.^_`|~0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ".split('');
const validName: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...tcharArr), { minLength: 1, maxLength: 32 })
  .map((arr) => arr.join(''));
// Cookie value: ASCII printable except controls (Bun percent-encodes the rest)
const validValue: fc.Arbitrary<string> = fc
  .array(fc.integer({ min: 0x20, max: 0x7e }).map((c) => String.fromCharCode(c)), { minLength: 0, maxLength: 100 })
  .map((arr) => arr.join(''));
// Use full-byte uint8 arrays (32–64 bytes) base64url-encoded so the entropy floor
// (Shannon ≥ 128 bits) is always satisfied — single-character shrink targets like
// "!!!!..." are correctly rejected by the parser and would otherwise fail this property.
const secret32: fc.Arbitrary<string> = fc
  .uint8Array({ minLength: 32, maxLength: 64 })
  .map((bytes) => Buffer.from(bytes).toString('base64url'));

describe('Property: HMAC sign/unsign roundtrip', () => {
  it('any value signed then unsigned returns the original', async () => {
    await fc.assert(
      fc.asyncProperty(validName, validValue, secret32, async (name, value, secret) => {
        const cp = CookieParser.create({ secrets: [secret] });
        const signed = cp.sign(new Cookie(name, value));
        const unsigned = await cp.unsign(signed);
        return unsigned.value === value;
      }),
      { numRuns: RUNS },
    );
  });
});

describe('Property: AES-GCM encrypt/decrypt roundtrip', () => {
  it('any value encrypted then decrypted returns the original', async () => {
    await fc.assert(
      fc.asyncProperty(validName, validValue, secret32, async (name, value, secret) => {
        const cp = CookieParser.create({ encryptionSecret: secret });
        const enc = await cp.encrypt(new Cookie(name, value));
        const dec = await cp.decrypt(enc);
        return dec.value === value;
      }),
      { numRuns: RUNS },
    );
  });
});

describe('Property: encrypt produces unique ciphertext per call (IV randomness)', () => {
  it('two encrypts of identical input never collide', async () => {
    await fc.assert(
      fc.asyncProperty(validName, validValue, async (name, value) => {
        const cp = CookieParser.create({ encryptionSecret: 'yiLuooc8t1iy7BDCaU2eExB60URL8zacnqb1mA66aIo' });
        const a = await cp.encrypt(new Cookie(name, value));
        const b = await cp.encrypt(new Cookie(name, value));
        return a.value !== b.value;
      }),
      { numRuns: RUNS },
    );
  });
});

describe('Property: HMAC name-binding rejects cross-name replay', () => {
  it('signature for cookie A never validates under cookie B', async () => {
    await fc.assert(
      fc.asyncProperty(validName, validName, validValue, async (n1, n2, value) => {
        fc.pre(n1 !== n2);
        const cp = CookieParser.create({ secrets: ['yiLuooc8t1iy7BDCaU2eExB60URL8zacnqb1mA66aIo'] });
        const signed = cp.sign(new Cookie(n1, value));
        const replayed = new Cookie(n2, signed.value);
        let rejected = false;
        try { await cp.unsign(replayed); } catch (e) {
          rejected = e instanceof CookieError && e.reason === CookieErrorReason.SignatureVerificationFailed;
        }
        return rejected;
      }),
      { numRuns: RUNS },
    );
  });
});

describe('Property: AES-GCM AAD-binding rejects cross-name replay', () => {
  it('ciphertext for cookie A never decrypts under cookie B', async () => {
    await fc.assert(
      fc.asyncProperty(validName, validName, validValue, async (n1, n2, value) => {
        fc.pre(n1 !== n2);
        const cp = CookieParser.create({ encryptionSecret: 'yiLuooc8t1iy7BDCaU2eExB60URL8zacnqb1mA66aIo' });
        const enc = await cp.encrypt(new Cookie(n1, value));
        const replayed = new Cookie(n2, enc.value);
        let rejected = false;
        try { await cp.decrypt(replayed); } catch (e) {
          rejected = e instanceof CookieError && e.reason === CookieErrorReason.DecryptionFailed;
        }
        return rejected;
      }),
      { numRuns: RUNS },
    );
  });
});

describe('Property: ciphertext tampering always fails decryption', () => {
  it('flipping any byte after IV breaks decryption', async () => {
    await fc.assert(
      fc.asyncProperty(validName, validValue, fc.integer({ min: 0, max: 50 }), async (name, value, idx) => {
        const cp = CookieParser.create({ encryptionSecret: 'yiLuooc8t1iy7BDCaU2eExB60URL8zacnqb1mA66aIo' });
        const enc = await cp.encrypt(new Cookie(name, value));
        const buf = Buffer.from(enc.value, 'base64url');
        // Tamper byte after IV (12) + within bounds
        const target = 12 + (idx % Math.max(1, buf.length - 12));
        buf[target] = (buf[target]! ^ 0xff) & 0xff;
        const tampered = new Cookie(name, buf.toString('base64url'));
        let rejected = false;
        try { await cp.decrypt(tampered); } catch (e) {
          rejected = e instanceof CookieError;
        }
        return rejected;
      }),
      { numRuns: RUNS },
    );
  });
});

describe('Property: HMAC tampering always fails verification', () => {
  it('flipping any character after the dot breaks verification', async () => {
    await fc.assert(
      fc.asyncProperty(validName, validValue, fc.integer({ min: 0, max: 40 }), async (name, value, idx) => {
        const cp = CookieParser.create({ secrets: ['yiLuooc8t1iy7BDCaU2eExB60URL8zacnqb1mA66aIo'] });
        const signed = cp.sign(new Cookie(name, value));
        const dot = signed.value.lastIndexOf('.');
        const sig = signed.value.slice(dot + 1);
        if (sig.length === 0) return true;
        const i = idx % sig.length;
        const flipped = sig.slice(0, i) + (sig[i] === 'A' ? 'B' : 'A') + sig.slice(i + 1);
        const tampered = new Cookie(name, signed.value.slice(0, dot + 1) + flipped);
        let rejected = false;
        try { await cp.unsign(tampered); } catch (e) {
          rejected = e instanceof CookieError && e.reason === CookieErrorReason.SignatureVerificationFailed;
        }
        return rejected;
      }),
      { numRuns: RUNS },
    );
  });
});

describe('Property: invalid name is rejected at every entry point', () => {
  const separators = ['(', ')', '<', '>', '@', ',', ';', ':', '\\', '"', '/', '[', ']', '?', '=', '{', '}'];
  it('every entry point throws CookieError for separators in name', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...separators), validName, async (sep, base) => {
        const bad = base + sep + 'x';
        const cp = CookieParser.create({ secrets: ['yiLuooc8t1iy7BDCaU2eExB60URL8zacnqb1mA66aIo'], encryptionSecret: 'v3MALRP-T0CO2gZ46D5As25K-U1D74PDhsdQJGjk4QQ' });
        const checks = [
          () => cp.createCookie(bad, 'v'),
          () => { const c = (() => { try { return new Cookie(bad, 'v'); } catch { return null; } })(); return c ? cp.serialize(c) : (() => { throw new CookieError({ reason: CookieErrorReason.InvalidCookieName, message: 'rejected at ctor' }); })(); },
          () => { const c = (() => { try { return new Cookie(bad, 'v'); } catch { return null; } })(); return c ? cp.sign(c) : (() => { throw new CookieError({ reason: CookieErrorReason.InvalidCookieName, message: 'rejected at ctor' }); })(); },
        ];
        for (const fn of checks) {
          let caught: unknown;
          try { await fn(); } catch (e) { caught = e; }
          if (!(caught instanceof CookieError)) return false;
        }
        return true;
      }),
      { numRuns: RUNS },
    );
  });
});

describe('Property: jar set/get roundtrip preserves arbitrary value', () => {
  it('setting then getting returns the original value', async () => {
    const { CookieJar } = await import('../../src/cookie-jar');
    await fc.assert(
      fc.asyncProperty(validName, validValue, async (name, value) => {
        const cp = CookieParser.create({ secrets: ['yiLuooc8t1iy7BDCaU2eExB60URL8zacnqb1mA66aIo'], encryptionSecret: 'v3MALRP-T0CO2gZ46D5As25K-U1D74PDhsdQJGjk4QQ' });
        const out = new CookieJar(cp, '');
        out.set(name, value);
        const headers = await out.getSetCookieHeaders();
        const cookieValue = headers[0]!.split('=').slice(1).join('=').split(';')[0]!;
        const inJar = new CookieJar(cp, `${name}=${cookieValue}`);
        const got = await inJar.get(name);
        return got === value;
      }),
      { numRuns: RUNS },
    );
  });
});

describe('Property: 4096-octet boundary is honored', () => {
  it('any header > 4096 octets is rejected', async () => {
    const cp = CookieParser.create();
    await fc.assert(
      fc.property(fc.integer({ min: 4097, max: 8192 }), (size) => {
        let caught: unknown;
        try { cp.serialize(new Cookie('s', 'x'.repeat(size))); } catch (e) { caught = e; }
        return caught instanceof CookieError && (caught as CookieError).reason === CookieErrorReason.CookieTooLarge;
      }),
      { numRuns: 50 },
    );
  });
});

describe('Property: key rotation invariants', () => {
  it('cookie signed by any key in the rotation array verifies', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(secret32, { minLength: 2, maxLength: 5 }),
        fc.integer({ min: 0, max: 4 }),
        validName,
        validValue,
        async (keys, signerIdx, name, value) => {
          const idx = signerIdx % keys.length;
          const signer = CookieParser.create({ secrets: [keys[idx]!] });
          const verifier = CookieParser.create({ secrets: keys });
          const signed = signer.sign(new Cookie(name, value));
          const unsigned = await verifier.unsign(signed);
          return unsigned.value === value;
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('cookie encrypted by any key in rotation array decrypts', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(secret32, { minLength: 2, maxLength: 4 }),
        fc.integer({ min: 0, max: 3 }),
        validName,
        validValue,
        async (keys, encIdx, name, value) => {
          const idx = encIdx % keys.length;
          const encryptor = CookieParser.create({ encryptionSecret: keys[idx]! });
          const decryptor = CookieParser.create({ encryptionSecret: keys });
          const enc = await encryptor.encrypt(new Cookie(name, value));
          const dec = await decryptor.decrypt(enc);
          return dec.value === value;
        },
      ),
      { numRuns: 100 },
    );
  });
});
