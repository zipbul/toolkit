import { describe, expect, it } from 'bun:test';
import { Cookie } from 'bun';
import { isErr } from '@zipbul/result';

import { CookieParser, CookieJar, CookieError, CookieErrorReason } from '../../index';

describe('CookieParser Integration', () => {
  const SECRETS = ['primary-key-2024-with-min-length__', 'legacy-key-2023-with-min-length___'];
  const ENCRYPTION_SECRET = 'aes-256-gcm-secret-for-integration';

  describe('CookieJar full roundtrip', () => {
    it('should set cookies via jar and read them back via another jar', async () => {
      const parser = CookieParser.create({
        secrets: SECRETS,
        encryptionSecret: ENCRYPTION_SECRET,
      });

      const outJar = new CookieJar(parser, '');
      outJar.set('session', 'uid=12345&role=admin');
      const headers = await outJar.getSetCookieHeaders();
      expect(headers).toHaveLength(1);
      expect(headers[0]).not.toContain('uid=12345');

      const cookieValue = headers[0]!.split('=').slice(1).join('=').split(';')[0]!;
      const inJar = new CookieJar(parser, `session=${cookieValue}`);
      const result = await inJar.get('session');
      expect(result).toBe('uid=12345&role=admin');
    });

    it('should handle multiple cookies independently in a jar', async () => {
      const parser = CookieParser.create({
        secrets: SECRETS,
        encryptionSecret: ENCRYPTION_SECRET,
      });

      const outJar = new CookieJar(parser, '');
      outJar.set('session', 'sess-abc');
      outJar.set('prefs', 'dark-mode=true');
      outJar.set('tracking', 'ref=google');
      const headers = await outJar.getSetCookieHeaders();
      expect(headers).toHaveLength(3);

      const cookieParts = headers.map((h) => {
        const name = h.split('=')[0]!;
        const value = h.split('=').slice(1).join('=').split(';')[0]!;
        return `${name}=${value}`;
      });

      const inJar = new CookieJar(parser, cookieParts.join('; '));
      expect(await inJar.get('session')).toBe('sess-abc');
      expect(await inJar.get('prefs')).toBe('dark-mode=true');
      expect(await inJar.get('tracking')).toBe('ref=google');
    });
  });

  describe('key rotation via jar', () => {
    it('should read cookie signed with old key after rotation', async () => {
      const parserOld = CookieParser.create({ secrets: ['old-signing-secret-2023__rotation_x'] });
      const outJar = new CookieJar(parserOld, '');
      outJar.set('token', 'jwt-payload');
      const headers = await outJar.getSetCookieHeaders();
      const cookieValue = headers[0]!.split('=').slice(1).join('=').split(';')[0]!;

      const parserNew = CookieParser.create({ secrets: ['new-signing-secret-2024__rotation_x', 'old-signing-secret-2023__rotation_x'] });
      const inJar = new CookieJar(parserNew, `token=${cookieValue}`);
      expect(await inJar.get('token')).toBe('jwt-payload');
    });

    it('should fail to read cookie signed with old key when old key removed', async () => {
      const parserOld = CookieParser.create({ secrets: ['old-signing-secret-2023__rotation_x'] });
      const outJar = new CookieJar(parserOld, '');
      outJar.set('token', 'data');
      const headers = await outJar.getSetCookieHeaders();
      const cookieValue = headers[0]!.split('=').slice(1).join('=').split(';')[0]!;

      const parserNew = CookieParser.create({ secrets: ['new-signing-secret-2024__rotation_x'] });
      const inJar = new CookieJar(parserNew, `token=${cookieValue}`);
      const result = await inJar.get('token');
      expect(isErr(result)).toBe(true);
    });
  });

  describe('cross-instance isolation via jar', () => {
    it('should fail to read cookie encrypted by different instance', async () => {
      const parserA = CookieParser.create({ encryptionSecret: 'key-a-with-minimum-required-length' });
      const outJar = new CookieJar(parserA, '');
      outJar.set('session', 'secret');
      const headers = await outJar.getSetCookieHeaders();
      const cookieValue = headers[0]!.split('=').slice(1).join('=').split(';')[0]!;

      const parserB = CookieParser.create({ encryptionSecret: 'key-b-with-minimum-required-length' });
      const inJar = new CookieJar(parserB, `session=${cookieValue}`);
      const result = await inJar.get('session');
      expect(isErr(result)).toBe(true);
    });
  });

  describe('jar with defaults', () => {
    it('should apply parser defaults in outbound headers', async () => {
      const parser = CookieParser.create({
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
        domain: 'example.com',
      });

      const jar = new CookieJar(parser, '');
      jar.set('session', 'data');
      const headers = await jar.getSetCookieHeaders();
      expect(headers[0]).toContain('HttpOnly');
      expect(headers[0]).toContain('Secure');
      expect(headers[0]).toContain('Domain=example.com');
      expect(headers[0]).toContain('Path=/');
    });
  });

  describe('jar delete', () => {
    it('should produce deletion header via jar', async () => {
      const parser = CookieParser.create();
      const jar = new CookieJar(parser, '');
      jar.delete('old-session');
      const headers = await jar.getSetCookieHeaders();
      expect(headers).toHaveLength(1);
      expect(headers[0]).toContain('old-session=');
      expect(headers[0]).toContain('Max-Age=0');
    });
  });

  describe('jar with secure auto', () => {
    it('should set Secure on HTTPS via serialize context', async () => {
      const parser = CookieParser.create({ secure: 'auto' });
      const jar = new CookieJar(parser, '');
      jar.set('session', 'data');

      const httpsHeaders = await jar.getSetCookieHeaders({ isSecure: true });
      expect(httpsHeaders[0]).toContain('Secure');

      const httpHeaders = await jar.getSetCookieHeaders({ isSecure: false });
      expect(httpHeaders[0]).not.toContain('Secure');
    });
  });

  describe('jar with algorithm', () => {
    it('should sign with sha512 and complete jar roundtrip', async () => {
      const parser = CookieParser.create({
        secrets: ['signing-key-primary-aaaaaaaaaaaaaaa'],
        encryptionSecret: 'encryption-key-extra-cccccccccccccc',
        algorithm: 'sha512',
      });

      const outJar = new CookieJar(parser, '');
      outJar.set('session', 'secret-data');
      const headers = await outJar.getSetCookieHeaders();
      const cookieValue = headers[0]!.split('=').slice(1).join('=').split(';')[0]!;

      const inJar = new CookieJar(parser, `session=${cookieValue}`);
      expect(await inJar.get('session')).toBe('secret-data');
    });
  });
});
