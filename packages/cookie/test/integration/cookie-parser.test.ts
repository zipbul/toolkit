import { describe, expect, it } from 'bun:test';
import { Cookie } from 'bun';

import { CookieParser, CookieError, CookieErrorReason } from '../../index';

describe('CookieParser Integration', () => {
  const SECRETS = ['primary-key-2024', 'legacy-key-2023'];
  const ENCRYPTION_SECRET = 'aes-256-gcm-secret-for-integration';

  describe('full outbound → inbound pipeline', () => {
    it('should sign+encrypt on outbound then decrypt+unsign on inbound and recover original', async () => {
      const cp = CookieParser.create({
        secrets: SECRETS,
        encryptionSecret: ENCRYPTION_SECRET,
      });
      const original = new Cookie('__Secure-session', 'uid=12345&role=admin', {
        secure: true,
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
        maxAge: 3600,
      });

      cp.validatePrefix(original);
      const signed = cp.sign(original);
      const encrypted = await cp.encrypt(signed);
      const header = cp.serialize(encrypted);

      expect(header).toContain('__Secure-session=');
      expect(header).not.toContain('uid=12345');

      const parsed = cp.parseOne(header);
      const decrypted = await cp.decrypt(parsed);
      const unsigned = await cp.unsign(decrypted);

      expect(unsigned.value).toBe('uid=12345&role=admin');
      expect(unsigned.name).toBe('__Secure-session');
    });

    it('should handle multiple cookies independently in a batch', async () => {
      const cp = CookieParser.create({
        secrets: SECRETS,
        encryptionSecret: ENCRYPTION_SECRET,
      });
      const cookies = [
        new Cookie('session', 'sess-abc'),
        new Cookie('prefs', 'dark-mode=true'),
        new Cookie('tracking', 'ref=google'),
      ];

      const headers = await Promise.all(
        cookies.map(async (c) => {
          const signed = cp.sign(c);
          const encrypted = await cp.encrypt(signed);
          return cp.serialize(encrypted);
        }),
      );

      for (let i = 0; i < headers.length; i++) {
        const h = headers[i]!;
        const parsed = cp.parseOne(h);
        const decrypted = await cp.decrypt(parsed);
        const unsigned = await cp.unsign(decrypted);
        expect(unsigned.value).toBe(cookies[i]!.value);
        expect(unsigned.name).toBe(cookies[i]!.name);
      }
    });
  });

  describe('key rotation', () => {
    it('should unsign cookie signed with old key after rotation', async () => {
      const cpOld = CookieParser.create({ secrets: ['old-secret-2023'] });
      const signed = cpOld.sign(new Cookie('token', 'jwt-payload'));

      const cpNew = CookieParser.create({
        secrets: ['new-secret-2024', 'old-secret-2023'],
      });
      const unsigned = await cpNew.unsign(signed);
      expect(unsigned.value).toBe('jwt-payload');
    });

    it('should sign with new key and only new parser can verify', async () => {
      const cpNew = CookieParser.create({
        secrets: ['new-secret-2024', 'old-secret-2023'],
      });
      const signed = cpNew.sign(new Cookie('token', 'data'));

      const cpNewOnly = CookieParser.create({ secrets: ['new-secret-2024'] });
      expect((await cpNewOnly.unsign(signed)).value).toBe('data');

      const cpOldOnly = CookieParser.create({ secrets: ['old-secret-2023'] });
      let caught: unknown;
      try {
        await cpOldOnly.unsign(signed);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(
        CookieErrorReason.SignatureVerificationFailed,
      );
    });
  });

  describe('prefix validation with signing and encryption', () => {
    it('should validate __Host- cookie through full pipeline', async () => {
      const cp = CookieParser.create({ secrets: ['s'], encryptionSecret: 'e' });
      const cookie = new Cookie('__Host-id', 'val', { secure: true, path: '/' });

      cp.validatePrefix(cookie);
      const signed = cp.sign(cookie);
      const encrypted = await cp.encrypt(signed);
      const header = cp.serialize(encrypted);

      expect(header).toContain('__Host-id=');
      expect(header).toContain('Secure');
      expect(header).toContain('Path=/');
    });

    it('should reject __Host- with domain through pipeline', () => {
      const cp = CookieParser.create({ secrets: ['s'] });
      const cookie = new Cookie('__Host-bad', 'v', {
        secure: true,
        path: '/',
        domain: 'evil.com',
      });

      let caught: unknown;
      try {
        cp.validatePrefix(cookie);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(
        CookieErrorReason.HostPrefixForbidsDomain,
      );
    });
  });

  describe('cross-instance isolation', () => {
    it('should fail to decrypt cookie encrypted by different instance', async () => {
      const cpA = CookieParser.create({ encryptionSecret: 'instance-a-key' });
      const cpB = CookieParser.create({ encryptionSecret: 'instance-b-key' });

      const encrypted = await cpA.encrypt(new Cookie('session', 'secret'));

      let caught: unknown;
      try {
        await cpB.decrypt(encrypted);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(
        CookieErrorReason.DecryptionFailed,
      );
    });

    it('should fail to unsign cookie signed by different instance', async () => {
      const cpA = CookieParser.create({ secrets: ['key-a'] });
      const cpB = CookieParser.create({ secrets: ['key-b'] });

      const signed = cpA.sign(new Cookie('token', 'val'));

      let caught: unknown;
      try {
        await cpB.unsign(signed);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(
        CookieErrorReason.SignatureVerificationFailed,
      );
    });
  });

  describe('parse Cookie header then process each cookie', () => {
    it('should parse multi-cookie header and sign each individually', async () => {
      const cp = CookieParser.create({ secrets: ['s'] });
      const cookies = cp.parse('a=1; b=2; c=3');
      expect(cookies).toHaveLength(3);

      const signed = cookies.map((c) => cp.sign(c));
      for (const [i, s] of signed.entries()) {
        const unsigned = await cp.unsign(s);
        expect(unsigned.value).toBe(cookies[i]!.value);
      }
    });
  });

  describe('serialize → parseOne roundtrip preserves attributes', () => {
    it('should preserve secure, httpOnly, path, sameSite through roundtrip', () => {
      const cp = CookieParser.create();
      const original = new Cookie('sess', 'v', {
        secure: true,
        httpOnly: true,
        path: '/app',
        sameSite: 'lax',
      });
      const header = cp.serialize(original);
      const parsed = cp.parseOne(header);

      expect(parsed.name).toBe('sess');
      expect(parsed.value).toBe('v');
      expect(parsed.secure).toBe(true);
      expect(parsed.httpOnly).toBe(true);
      expect(parsed.path).toBe('/app');
      expect(parsed.sameSite).toBe('lax');
    });
  });

  describe('createCookie with defaults through full pipeline', () => {
    it('should apply defaults via createCookie then sign+encrypt+serialize', async () => {
      const cp = CookieParser.create({
        secrets: SECRETS,
        encryptionSecret: ENCRYPTION_SECRET,
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
        domain: 'example.com',
      });

      const cookie = cp.createCookie('session', 'user:42');
      expect(cookie.httpOnly).toBe(true);
      expect(cookie.secure).toBe(true);
      expect(cookie.sameSite).toBe('strict');
      expect(cookie.path).toBe('/');
      expect(cookie.domain).toBe('example.com');

      const signed = cp.sign(cookie);
      const encrypted = await cp.encrypt(signed);
      const header = cp.serialize(encrypted);

      expect(header).toContain('session=');
      expect(header).toContain('Secure');
      expect(header).toContain('HttpOnly');
      expect(header).toContain('Domain=example.com');
      expect(header).not.toContain('user:42');

      const parsed = cp.parseOne(header);
      const decrypted = await cp.decrypt(parsed);
      const unsigned = await cp.unsign(decrypted);
      expect(unsigned.value).toBe('user:42');
    });

    it('should allow per-cookie override in full pipeline', () => {
      const cp = CookieParser.create({
        secrets: ['s'],
        httpOnly: true,
        secure: true,
        path: '/',
      });

      const cookie = cp.createCookie('token', 'jwt', { path: '/api', secure: false });
      expect(cookie.path).toBe('/api');
      expect(cookie.secure).toBe(false);
      expect(cookie.httpOnly).toBe(true);

      const signed = cp.sign(cookie);
      const header = cp.serialize(signed);
      expect(header).toContain('Path=/api');
      expect(header).not.toContain('Secure');
      expect(header).toContain('HttpOnly');
    });
  });

  describe('secure auto with prefixValidation in pipeline', () => {
    it('should auto-resolve secure and validate __Secure- prefix on HTTPS', () => {
      const cp = CookieParser.create({
        secrets: ['s'],
        secure: 'auto',
        prefixValidation: true,
        httpOnly: true,
        path: '/',
      });

      const cookie = cp.createCookie('__Secure-session', 'data');
      const signed = cp.sign(cookie);
      const header = cp.serialize(signed, { isSecure: true });

      expect(header).toContain('__Secure-session=');
      expect(header).toContain('Secure');
      expect(header).toContain('HttpOnly');
    });

    it('should fail __Secure- prefix validation on HTTP', () => {
      const cp = CookieParser.create({
        secrets: ['s'],
        secure: 'auto',
        prefixValidation: true,
      });

      const cookie = cp.createCookie('__Secure-session', 'data');
      const signed = cp.sign(cookie);

      let caught: unknown;
      try {
        cp.serialize(signed, { isSecure: false });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(
        CookieErrorReason.SecurePrefixRequiresSecure,
      );
    });
  });

  describe('algorithm with full pipeline', () => {
    it('should sign with sha512 and complete full roundtrip', async () => {
      const cp = CookieParser.create({
        secrets: ['s'],
        encryptionSecret: 'e',
        algorithm: 'sha512',
      });

      const cookie = new Cookie('session', 'secret-data');
      const signed = cp.sign(cookie);
      const encrypted = await cp.encrypt(signed);
      const header = cp.serialize(encrypted);

      const parsed = cp.parseOne(header);
      const decrypted = await cp.decrypt(parsed);
      const unsigned = await cp.unsign(decrypted);
      expect(unsigned.value).toBe('secret-data');
    });
  });
});
