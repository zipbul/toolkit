import { describe, expect, it } from 'bun:test';
import { isErr } from '@zipbul/result';
import type { Err } from '@zipbul/result';

import { CookieErrorReason } from './enums';
import { CookieError, type CookieErrorData } from './interfaces';
import { CookieParser } from './cookie-parser';
import { CookieJar } from './cookie-jar';

describe('CookieJar', () => {
  describe('has', () => {
    it('should return true when cookie exists', () => {
      const parser = CookieParser.create();
      const jar = new CookieJar(parser, 'session=abc; token=xyz');
      expect(jar.has('session')).toBe(true);
      expect(jar.has('token')).toBe(true);
    });

    it('should return false when cookie does not exist', () => {
      const parser = CookieParser.create();
      const jar = new CookieJar(parser, 'session=abc');
      expect(jar.has('missing')).toBe(false);
    });

    it('should return false for empty cookie header', () => {
      const parser = CookieParser.create();
      const jar = new CookieJar(parser, '');
      expect(jar.has('session')).toBe(false);
    });
  });

  describe('getRaw', () => {
    it('should return raw value without processing', () => {
      const parser = CookieParser.create({ secrets: ['signing-key-primary-aaaaaaaaaaaaaaa'], encryptionSecret: 'encryption-key-extra-cccccccccccccc' });
      const jar = new CookieJar(parser, 'session=raw-value; _ga=GA1.2.123');
      expect(jar.getRaw('session')).toBe('raw-value');
      expect(jar.getRaw('_ga')).toBe('GA1.2.123');
    });

    it('should return undefined when cookie does not exist', () => {
      const parser = CookieParser.create();
      const jar = new CookieJar(parser, '');
      expect(jar.getRaw('missing')).toBeUndefined();
    });
  });

  describe('get', () => {
    it('should return null when cookie does not exist', async () => {
      const parser = CookieParser.create();
      const jar = new CookieJar(parser, '');
      const result = await jar.get('missing');
      expect(result).toBeNull();
    });

    it('should return plain value when no signing or encryption configured', async () => {
      const parser = CookieParser.create();
      const jar = new CookieJar(parser, 'session=hello');
      const result = await jar.get('session');
      expect(result).toBe('hello');
    });

    it('should auto-unsign when signing configured', async () => {
      const parser = CookieParser.create({ secrets: ['signing-key-primary-aaaaaaaaaaaaaaa'] });
      const signed = parser.sign(new (await import('bun')).Cookie('session', 'data'));
      const jar = new CookieJar(parser, `session=${signed.value}`);
      const result = await jar.get('session');
      expect(result).toBe('data');
    });

    it('should auto-decrypt when encryption configured', async () => {
      const parser = CookieParser.create({ encryptionSecret: 'encryption-key-extra-cccccccccccccc' });
      const { Cookie } = await import('bun');
      const encrypted = await parser.encrypt(new Cookie('session', 'secret'));
      const jar = new CookieJar(parser, `session=${encrypted.value}`);
      const result = await jar.get('session');
      expect(result).toBe('secret');
    });

    it('should auto-decrypt then auto-unsign when both configured', async () => {
      const parser = CookieParser.create({ secrets: ['signing-key-primary-aaaaaaaaaaaaaaa'], encryptionSecret: 'encryption-key-extra-cccccccccccccc' });
      const { Cookie } = await import('bun');
      const cookie = new Cookie('session', 'user:42');
      const signed = parser.sign(cookie);
      const encrypted = await parser.encrypt(signed);
      const jar = new CookieJar(parser, `session=${encrypted.value}`);
      const result = await jar.get('session');
      expect(result).toBe('user:42');
    });

    it('should return Err when signature verification fails', async () => {
      const parser = CookieParser.create({ secrets: ['signing-key-primary-aaaaaaaaaaaaaaa'] });
      const jar = new CookieJar(parser, 'session=tampered.invalidsig');
      const result = await jar.get('session');
      expect(isErr(result)).toBe(true);
      expect((result as Err<CookieErrorData>).data.reason).toBe(
        CookieErrorReason.SignatureVerificationFailed,
      );
    });

    it('should return Err when decryption fails', async () => {
      const parser = CookieParser.create({ encryptionSecret: 'encryption-key-extra-cccccccccccccc' });
      const jar = new CookieJar(parser, 'session=notvalidciphertext_padded_enough_xxxxxxxx');
      const result = await jar.get('session');
      expect(isErr(result)).toBe(true);
    });

    it('should return null for empty cookie header', async () => {
      const parser = CookieParser.create({ secrets: ['signing-key-primary-aaaaaaaaaaaaaaa'] });
      const jar = new CookieJar(parser, '');
      const result = await jar.get('session');
      expect(result).toBeNull();
    });

    it('should handle multiple cookies and return correct one', async () => {
      const parser = CookieParser.create({ secrets: ['signing-key-primary-aaaaaaaaaaaaaaa'] });
      const { Cookie } = await import('bun');
      const signedA = parser.sign(new Cookie('a', 'val-a'));
      const signedB = parser.sign(new Cookie('b', 'val-b'));
      const jar = new CookieJar(parser, `a=${signedA.value}; b=${signedB.value}`);
      expect(await jar.get('a')).toBe('val-a');
      expect(await jar.get('b')).toBe('val-b');
      expect(await jar.get('c')).toBeNull();
    });
  });

  describe('set', () => {
    it('should queue cookie for outbound', async () => {
      const parser = CookieParser.create({ secrets: ['signing-key-primary-aaaaaaaaaaaaaaa'] });
      const jar = new CookieJar(parser, '');
      jar.set('session', 'user:42');
      const headers = await jar.getSetCookieHeaders();
      expect(headers).toHaveLength(1);
      expect(headers[0]).toContain('session=');
    });

    it('should apply parser defaults to set cookie', async () => {
      const parser = CookieParser.create({
        secrets: ['signing-key-primary-aaaaaaaaaaaaaaa'],
        httpOnly: true,
        secure: true,
        path: '/',
      });
      const jar = new CookieJar(parser, '');
      jar.set('session', 'data');
      const headers = await jar.getSetCookieHeaders();
      expect(headers[0]).toContain('HttpOnly');
      expect(headers[0]).toContain('Secure');
      expect(headers[0]).toContain('Path=/');
    });

    it('should allow per-cookie attribute overrides', async () => {
      const parser = CookieParser.create({ secrets: ['signing-key-primary-aaaaaaaaaaaaaaa'], path: '/' });
      const jar = new CookieJar(parser, '');
      jar.set('token', 'jwt', { path: '/api' });
      const headers = await jar.getSetCookieHeaders();
      expect(headers[0]).toContain('Path=/api');
    });

    it('should throw InvalidCookieName for invalid name', () => {
      const parser = CookieParser.create();
      const jar = new CookieJar(parser, '');
      let caught: unknown;
      try {
        jar.set('bad name', 'v');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(CookieErrorReason.InvalidCookieName);
    });

    it('should overwrite previously set cookie with same name', async () => {
      const parser = CookieParser.create();
      const jar = new CookieJar(parser, '');
      jar.set('session', 'first-signing-key__paddingpaddingpa');
      jar.set('session', 'second-signing-key__paddingpaddingp');
      const headers = await jar.getSetCookieHeaders();
      expect(headers).toHaveLength(1);
      expect(headers[0]).toContain('session=second');
    });
  });

  describe('delete', () => {
    it('should queue deletion cookie with maxAge 0', async () => {
      const parser = CookieParser.create();
      const jar = new CookieJar(parser, '');
      jar.delete('session');
      const headers = await jar.getSetCookieHeaders();
      expect(headers).toHaveLength(1);
      expect(headers[0]).toContain('session=');
      expect(headers[0]).toContain('Max-Age=0');
    });

    it('should not sign or encrypt deletion cookies', async () => {
      const parser = CookieParser.create({ secrets: ['signing-key-primary-aaaaaaaaaaaaaaa'], encryptionSecret: 'encryption-key-extra-cccccccccccccc' });
      const jar = new CookieJar(parser, '');
      jar.delete('session');
      const headers = await jar.getSetCookieHeaders();
      expect(headers).toHaveLength(1);
      expect(headers[0]).toContain('session=;');
    });

    it('should override previously set cookie with deletion', async () => {
      const parser = CookieParser.create();
      const jar = new CookieJar(parser, '');
      jar.set('session', 'data');
      jar.delete('session');
      const headers = await jar.getSetCookieHeaders();
      expect(headers).toHaveLength(1);
      expect(headers[0]).toContain('Max-Age=0');
    });
  });

  describe('getSetCookieHeaders', () => {
    it('should return empty array when no outbound cookies', async () => {
      const parser = CookieParser.create();
      const jar = new CookieJar(parser, 'session=data');
      const headers = await jar.getSetCookieHeaders();
      expect(headers).toHaveLength(0);
    });

    it('should auto-sign outbound cookies when signing configured', async () => {
      const parser = CookieParser.create({ secrets: ['signing-key-primary-aaaaaaaaaaaaaaa'] });
      const jar = new CookieJar(parser, '');
      jar.set('session', 'data');
      const headers = await jar.getSetCookieHeaders();
      expect(headers[0]).toContain('session=data.');
    });

    it('should auto-encrypt outbound cookies when encryption configured', async () => {
      const parser = CookieParser.create({ encryptionSecret: 'encryption-key-extra-cccccccccccccc' });
      const jar = new CookieJar(parser, '');
      jar.set('session', 'secret');
      const headers = await jar.getSetCookieHeaders();
      expect(headers[0]).not.toContain('secret');
    });

    it('should auto-sign then auto-encrypt when both configured', async () => {
      const parser = CookieParser.create({ secrets: ['signing-key-primary-aaaaaaaaaaaaaaa'], encryptionSecret: 'encryption-key-extra-cccccccccccccc' });
      const jar = new CookieJar(parser, '');
      jar.set('session', 'data');
      const headers = await jar.getSetCookieHeaders();
      expect(headers[0]).not.toContain('data');

      // Verify roundtrip through jar
      const jar2 = new CookieJar(parser, `session=${headers[0]!.split('=')[1]!.split(';')[0]}`);
      const result = await jar2.get('session');
      expect(result).toBe('data');
    });

    it('should pass serialize context for secure auto', async () => {
      const parser = CookieParser.create({ secure: 'auto' });
      const jar = new CookieJar(parser, '');
      jar.set('session', 'v');

      const httpsHeaders = await jar.getSetCookieHeaders({ isSecure: true });
      expect(httpsHeaders[0]).toContain('Secure');

      const httpHeaders = await jar.getSetCookieHeaders({ isSecure: false });
      expect(httpHeaders[0]).not.toContain('Secure');
    });

    it('should handle multiple set and delete in correct order', async () => {
      const parser = CookieParser.create();
      const jar = new CookieJar(parser, '');
      jar.set('a', '1');
      jar.set('b', '2');
      jar.delete('c');
      const headers = await jar.getSetCookieHeaders();
      expect(headers).toHaveLength(3);
    });
  });
});
