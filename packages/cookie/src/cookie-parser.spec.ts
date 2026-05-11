import { describe, expect, it } from 'bun:test';
import { Cookie } from 'bun';

import { CookieErrorReason } from './enums';
import { CookieError } from './interfaces';
import { CookieParser } from './cookie-parser';

describe('CookieParser', () => {
  describe('create', () => {
    it('should create instance without signing or encryption when no options', () => {
      const cp = CookieParser.create();
      expect(cp).toBeInstanceOf(CookieParser);
    });

    it('should create instance with signing when secrets provided', () => {
      const cp = CookieParser.create({ secrets: ['Zt0tEdS1HGYL9uL1XCdYAK7jcXMwVoTJcVWgM6ZgAC8'] });
      expect(cp).toBeInstanceOf(CookieParser);
    });

    it('should create instance with encryption when encryptionSecret provided', () => {
      const cp = CookieParser.create({ encryptionSecret: '7jsSFQIsrYMx7njVC74raAcw-YrfDSdVdSJwq1t1xMA' });
      expect(cp).toBeInstanceOf(CookieParser);
    });

    it('should create instance with both when secrets and encryptionSecret provided', () => {
      const cp = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'], encryptionSecret: '9v7BAwKpXHWZnoKZIHV2XWch22HvF8bleOM6t4nc-A4' });
      expect(cp).toBeInstanceOf(CookieParser);
    });

    it('should throw EmptySecrets when secrets array is empty', () => {
      let caught: unknown;
      try {
        CookieParser.create({ secrets: [] });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(CookieErrorReason.EmptySecrets);
    });

    it('should throw InvalidSecret when a secret is blank', () => {
      let caught: unknown;
      try {
        CookieParser.create({ secrets: ['FG-Qz_XD9uOM7e9O6mp_sZjsXPCrVik4ofHYTGagT3k', '  '] });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(CookieErrorReason.InvalidSecret);
    });

    it('should throw InvalidEncryptionSecret when encryptionSecret is blank', () => {
      let caught: unknown;
      try {
        CookieParser.create({ encryptionSecret: '  ' });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(
        CookieErrorReason.InvalidEncryptionSecret,
      );
    });

    it('should throw InvalidEncryptionSecret when secrets valid but encryptionSecret blank', () => {
      let caught: unknown;
      try {
        CookieParser.create({ secrets: ['FG-Qz_XD9uOM7e9O6mp_sZjsXPCrVik4ofHYTGagT3k'], encryptionSecret: '' });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(
        CookieErrorReason.InvalidEncryptionSecret,
      );
    });

    it('should create instance without signing or encryption when options is empty object', () => {
      const cp = CookieParser.create({});
      expect(cp).toBeInstanceOf(CookieParser);
    });
  });

  describe('serialize', () => {
    it('should return Set-Cookie header string when serializing Cookie', () => {
      const cp = CookieParser.create();
      const cookie = new Cookie('session', 'abc', { path: '/', secure: true });
      const header = cp.serialize(cookie);
      expect(header).toContain('session=abc');
      expect(header).toContain('Secure');
    });

    it('should produce consistent result when serialize then parse roundtrip', () => {
      const cp = CookieParser.create();
      const original = new Cookie('token', 'xyz', { path: '/', httpOnly: true });
      const header = cp.serialize(original);
      const parsed = Cookie.parse(header);
      expect(parsed.name).toBe('token');
      expect(parsed.value).toBe('xyz');
      expect(parsed.path).toBe('/');
      expect(parsed.httpOnly).toBe(true);
    });
  });

  describe('sign', () => {
    it('should return Cookie with signed value when signing', () => {
      const cp = CookieParser.create({ secrets: ['uLplyRvLnHhzccmlgR32eWltxxck4zA03xyJ40ik4DQ'] });
      const cookie = new Cookie('session', 'hello');
      const signed = cp.sign(cookie);
      expect(signed.name).toBe('session');
      expect(signed.value).toContain('hello.');
      expect(signed.value).not.toBe('hello');
    });

    it('should preserve cookie name and attributes when signing', () => {
      const cp = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'] });
      const cookie = new Cookie('token', 'val', {
        path: '/api',
        secure: true,
        httpOnly: true,
      });
      const signed = cp.sign(cookie);
      expect(signed.name).toBe('token');
      expect(signed.path).toBe('/api');
      expect(signed.secure).toBe(true);
      expect(signed.httpOnly).toBe(true);
    });

    it('should throw SigningNotConfigured when signing without secrets', () => {
      const cp = CookieParser.create();
      let caught: unknown;
      try {
        cp.sign(new Cookie('n', 'v'));
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(
        CookieErrorReason.SigningNotConfigured,
      );
    });

    it('should return Cookie with .hmac format when signing empty value', () => {
      const cp = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'] });
      const signed = cp.sign(new Cookie('n', ''));
      expect(signed.value).toMatch(/^\..+/);
    });

    it('should return same result when signing same cookie twice', () => {
      const cp = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'] });
      const cookie = new Cookie('n', 'v');
      const a = cp.sign(cookie);
      const b = cp.sign(cookie);
      expect(a.value).toBe(b.value);
    });
  });

  describe('unsign', () => {
    it('should return Cookie with original value when unsigning', async () => {
      const cp = CookieParser.create({ secrets: ['5LXB_5T8ke-OM3lbaSCxmSh5MLRfX-xzgfeqiC0XU-4'] });
      const signed = cp.sign(new Cookie('n', 'hello'));
      const unsigned = await cp.unsign(signed);
      expect(unsigned.name).toBe('n');
      expect(unsigned.value).toBe('hello');
    });

    it('should succeed with second secret when unsigning with key rotation', async () => {
      const cpOld = CookieParser.create({ secrets: ['c-BonY3Jbzq2IWbz7U92BtJtQVDGl9wnoudjt9RkihY'] });
      const signed = cpOld.sign(new Cookie('n', 'data'));
      const cpNew = CookieParser.create({ secrets: ['xM8Em3o_YBlUuk66TuXhAUgxC2E4fMk-OAOUl4KV02A', 'c-BonY3Jbzq2IWbz7U92BtJtQVDGl9wnoudjt9RkihY'] });
      const unsigned = await cpNew.unsign(signed);
      expect(unsigned.value).toBe('data');
    });

    it('should throw SigningNotConfigured when unsigning without secrets', async () => {
      const cp = CookieParser.create();
      let caught: unknown;
      try {
        await cp.unsign(new Cookie('n', 'v.sig'));
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(
        CookieErrorReason.SigningNotConfigured,
      );
    });

    it('should throw InvalidSignature when unsigning value without dot', async () => {
      const cp = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'] });
      let caught: unknown;
      try {
        await cp.unsign(new Cookie('n', 'nodot'));
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(
        CookieErrorReason.InvalidSignature,
      );
    });

    it('should throw SignatureVerificationFailed when unsigning with wrong hmac', async () => {
      const cp = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'] });
      let caught: unknown;
      try {
        await cp.unsign(new Cookie('n', 'value.wronghmac'));
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(
        CookieErrorReason.SignatureVerificationFailed,
      );
    });

    it('should throw SignatureVerificationFailed when value was tampered', async () => {
      const cp = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'] });
      const signed = cp.sign(new Cookie('n', 'original'));
      const tampered = new Cookie(
        'n',
        'tampered' + signed.value.slice(signed.value.lastIndexOf('.')),
      );
      let caught: unknown;
      try {
        await cp.unsign(tampered);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(
        CookieErrorReason.SignatureVerificationFailed,
      );
    });

    it('should split at last dot when unsigning value with multiple dots', async () => {
      const cp = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'] });
      const cookie = new Cookie('n', 'a.b.c');
      const signed = cp.sign(cookie);
      const unsigned = await cp.unsign(signed);
      expect(unsigned.value).toBe('a.b.c');
    });

    it('should return original value when sign then unsign roundtrip', async () => {
      const cp = CookieParser.create({ secrets: ['_cxDYhedJoI3pyfq0QbajZaiG-_F-pAASJH65k7wr6w'] });
      const original = new Cookie('session', 'user:42', { path: '/', secure: true });
      const signed = cp.sign(original);
      const unsigned = await cp.unsign(signed);
      expect(unsigned.value).toBe('user:42');
      expect(unsigned.name).toBe('session');
    });
  });

  describe('encrypt', () => {
    it('should return Cookie with encrypted value when encrypting', async () => {
      const cp = CookieParser.create({ encryptionSecret: 'Jxfcxvq26bQMrza3M9GXKSy-1jSPeLw4mUhtCiEv3aY' });
      const cookie = new Cookie('session', 'secret-data');
      const encrypted = await cp.encrypt(cookie);
      expect(encrypted.name).toBe('session');
      expect(encrypted.value).not.toBe('secret-data');
      expect(encrypted.value.length).toBeGreaterThan(0);
    });

    it('should preserve cookie name and attributes when encrypting', async () => {
      const cp = CookieParser.create({ encryptionSecret: '9v7BAwKpXHWZnoKZIHV2XWch22HvF8bleOM6t4nc-A4' });
      const cookie = new Cookie('token', 'val', {
        path: '/api',
        secure: true,
        httpOnly: true,
      });
      const encrypted = await cp.encrypt(cookie);
      expect(encrypted.name).toBe('token');
      expect(encrypted.path).toBe('/api');
      expect(encrypted.secure).toBe(true);
      expect(encrypted.httpOnly).toBe(true);
    });

    it('should throw EncryptionNotConfigured when encrypting without secret', async () => {
      const cp = CookieParser.create();
      let caught: unknown;
      try {
        await cp.encrypt(new Cookie('n', 'v'));
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(
        CookieErrorReason.EncryptionNotConfigured,
      );
    });

    it('should return different ciphertexts when encrypting same cookie twice', async () => {
      const cp = CookieParser.create({ encryptionSecret: '9v7BAwKpXHWZnoKZIHV2XWch22HvF8bleOM6t4nc-A4' });
      const cookie = new Cookie('n', 'same-value');
      const a = await cp.encrypt(cookie);
      const b = await cp.encrypt(cookie);
      expect(a.value).not.toBe(b.value);
    });
  });

  describe('decrypt', () => {
    it('should return Cookie with original value when decrypting', async () => {
      const cp = CookieParser.create({ encryptionSecret: 'mrL_P-ipSo5gJWyLB1fpKzLvXpDQhWd127WUIjVkE0Q' });
      const encrypted = await cp.encrypt(new Cookie('n', 'plaintext'));
      const decrypted = await cp.decrypt(encrypted);
      expect(decrypted.name).toBe('n');
      expect(decrypted.value).toBe('plaintext');
    });

    it('should throw EncryptionNotConfigured when decrypting without secret', async () => {
      const cp = CookieParser.create();
      let caught: unknown;
      try {
        await cp.decrypt(new Cookie('n', 'cipher'));
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(
        CookieErrorReason.EncryptionNotConfigured,
      );
    });

    it('should throw InvalidCiphertext when decrypting too-short value', async () => {
      const cp = CookieParser.create({ encryptionSecret: '9v7BAwKpXHWZnoKZIHV2XWch22HvF8bleOM6t4nc-A4' });
      let caught: unknown;
      try {
        await cp.decrypt(new Cookie('n', 'short'));
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(
        CookieErrorReason.InvalidCiphertext,
      );
    });

    it('should throw DecryptionFailed when decrypting tampered ciphertext', async () => {
      const cp = CookieParser.create({ encryptionSecret: '9v7BAwKpXHWZnoKZIHV2XWch22HvF8bleOM6t4nc-A4' });
      const encrypted = await cp.encrypt(new Cookie('n', 'v'));
      const tampered = new Cookie(
        'n',
        encrypted.value.slice(0, -4) + 'XXXX',
      );
      let caught: unknown;
      try {
        await cp.decrypt(tampered);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(
        CookieErrorReason.DecryptionFailed,
      );
    });

    it('should throw DecryptionFailed when decrypting with wrong key', async () => {
      const cpA = CookieParser.create({ encryptionSecret: '15MzBo5XvJ5s4pH6_Qg2rdLQ73O_ZWOyoNT2vsDtN1U' });
      const cpB = CookieParser.create({ encryptionSecret: 'G2ChMLgCJsc5VkAXlrN2ZUqgAKHsrASwTplEv5lcS1w' });
      const encrypted = await cpA.encrypt(new Cookie('n', 'v'));
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

    it('should return original value when encrypt then decrypt roundtrip', async () => {
      const cp = CookieParser.create({ encryptionSecret: '_cxDYhedJoI3pyfq0QbajZaiG-_F-pAASJH65k7wr6w' });
      const original = new Cookie('session', 'user:42', { path: '/', secure: true });
      const encrypted = await cp.encrypt(original);
      const decrypted = await cp.decrypt(encrypted);
      expect(decrypted.value).toBe('user:42');
      expect(decrypted.name).toBe('session');
    });
  });

  describe('validatePrefix', () => {
    it('should pass when validating __Host- cookie with all valid attributes', () => {
      const cp = CookieParser.create();
      const cookie = new Cookie('__Host-session', 'v', {
        secure: true,
        path: '/',
      });
      expect(() => cp.validatePrefix(cookie)).not.toThrow();
    });

    it('should pass when validating __Secure- cookie with secure flag', () => {
      const cp = CookieParser.create();
      const cookie = new Cookie('__Secure-token', 'v', { secure: true });
      expect(() => cp.validatePrefix(cookie)).not.toThrow();
    });

    it('should pass when validating cookie without prefix', () => {
      const cp = CookieParser.create();
      expect(() => cp.validatePrefix(new Cookie('normal', 'v'))).not.toThrow();
    });

    it('should throw HostPrefixRequiresSecure when __Host- without secure', () => {
      const cp = CookieParser.create();
      let caught: unknown;
      try {
        cp.validatePrefix(new Cookie('__Host-x', 'v', { path: '/' }));
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(
        CookieErrorReason.HostPrefixRequiresSecure,
      );
    });

    it('should throw HostPrefixForbidsDomain when __Host- with domain', () => {
      const cp = CookieParser.create();
      let caught: unknown;
      try {
        cp.validatePrefix(
          new Cookie('__Host-x', 'v', {
            secure: true,
            path: '/',
            domain: 'example.com',
          }),
        );
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(
        CookieErrorReason.HostPrefixForbidsDomain,
      );
    });

    it('should throw HostPrefixRequiresRootPath when __Host- with wrong path', () => {
      const cp = CookieParser.create();
      let caught: unknown;
      try {
        cp.validatePrefix(new Cookie('__Host-x', 'v', { secure: true, path: '/admin' }));
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(
        CookieErrorReason.HostPrefixRequiresRootPath,
      );
    });

    it('should throw SecurePrefixRequiresSecure when __Secure- without secure', () => {
      const cp = CookieParser.create();
      let caught: unknown;
      try {
        cp.validatePrefix(new Cookie('__Secure-x', 'v'));
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(
        CookieErrorReason.SecurePrefixRequiresSecure,
      );
    });
  });

  describe('pipeline', () => {
    it('should complete outbound pipeline validatePrefix then sign then encrypt then serialize', async () => {
      const cp = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'], encryptionSecret: '9v7BAwKpXHWZnoKZIHV2XWch22HvF8bleOM6t4nc-A4' });
      const cookie = new Cookie('__Secure-session', 'data', {
        secure: true,
        path: '/',
      });
      cp.validatePrefix(cookie);
      const signed = cp.sign(cookie);
      const encrypted = await cp.encrypt(signed);
      const header = cp.serialize(encrypted);
      expect(header).toContain('__Secure-session=');
    });

    it('should complete inbound pipeline parse then decrypt then unsign', async () => {
      const cp = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'], encryptionSecret: '9v7BAwKpXHWZnoKZIHV2XWch22HvF8bleOM6t4nc-A4' });
      const original = new Cookie('session', 'secret-data');
      const signed = cp.sign(original);
      const encrypted = await cp.encrypt(signed);
      const header = cp.serialize(encrypted);
      const parsed = Cookie.parse(header);
      const decrypted = await cp.decrypt(parsed);
      const unsigned = await cp.unsign(decrypted);
      expect(unsigned.value).toBe('secret-data');
    });

    it('should produce different results when sign-then-encrypt vs encrypt-then-sign', async () => {
      const cp = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'], encryptionSecret: '9v7BAwKpXHWZnoKZIHV2XWch22HvF8bleOM6t4nc-A4' });
      const cookie = new Cookie('n', 'v');
      const signFirst = await cp.encrypt(cp.sign(cookie));
      const encryptFirst = cp.sign(await cp.encrypt(cookie));
      expect(signFirst.value).not.toBe(encryptFirst.value);
    });

    it('should throw EncryptionNotConfigured when created with secrets only and encrypt called', async () => {
      const cp = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'] });
      let caught: unknown;
      try {
        await cp.encrypt(new Cookie('n', 'v'));
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(
        CookieErrorReason.EncryptionNotConfigured,
      );
    });

    it('should throw SigningNotConfigured when created with encryptionSecret only and sign called', () => {
      const cp = CookieParser.create({ encryptionSecret: '9v7BAwKpXHWZnoKZIHV2XWch22HvF8bleOM6t4nc-A4' });
      let caught: unknown;
      try {
        cp.sign(new Cookie('n', 'v'));
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(
        CookieErrorReason.SigningNotConfigured,
      );
    });

    it('should always sign with first secret in array', () => {
      const cpA = CookieParser.create({ secrets: ['TkAnVMEz2b6plPoYz_d34hH8YUoKtqSpKw98hRF1jyc', 'xWrp7xEBI_mt-LG3QJDz6wMQr37-nK0PvNmQp2Ejg0g'] });
      const cpB = CookieParser.create({ secrets: ['TkAnVMEz2b6plPoYz_d34hH8YUoKtqSpKw98hRF1jyc'] });
      const cookie = new Cookie('n', 'v');
      expect(cpA.sign(cookie).value).toBe(cpB.sign(cookie).value);
    });

    it('should unsign with old secret when key rotation array includes it', async () => {
      const cpOld = CookieParser.create({ secrets: ['L9B6csE6Sq9NA6MXZumamSev-eUUCfzGF_wMa8BRUaU'] });
      const signed = cpOld.sign(new Cookie('n', 'important'));
      const cpRotated = CookieParser.create({ secrets: ['1cxQCYROyjGcQQ_wLx_R6aGe0sfQL2LYjoQ3UStKWUI', 'L9B6csE6Sq9NA6MXZumamSev-eUUCfzGF_wMa8BRUaU'] });
      const unsigned = await cpRotated.unsign(signed);
      expect(unsigned.value).toBe('important');
    });
  });

  describe('algorithm', () => {
    it('should sign with sha384 algorithm', async () => {
      const cp = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'], algorithm: 'sha384' });
      const signed = cp.sign(new Cookie('n', 'v'));
      expect(signed.value).toContain('v.');
      const unsigned = await cp.unsign(signed);
      expect(unsigned.value).toBe('v');
    });

    it('should sign with sha512 algorithm', async () => {
      const cp = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'], algorithm: 'sha512' });
      const signed = cp.sign(new Cookie('n', 'v'));
      expect(signed.value).toContain('v.');
      const unsigned = await cp.unsign(signed);
      expect(unsigned.value).toBe('v');
    });

    it('should produce different signatures for different algorithms', () => {
      const cp256 = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'], algorithm: 'sha256' });
      const cp512 = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'], algorithm: 'sha512' });
      const cookie = new Cookie('n', 'v');
      expect(cp256.sign(cookie).value).not.toBe(cp512.sign(cookie).value);
    });

    it('should fail to unsign with different algorithm', async () => {
      const cp256 = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'], algorithm: 'sha256' });
      const cp512 = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'], algorithm: 'sha512' });
      const signed = cp256.sign(new Cookie('n', 'v'));
      let caught: unknown;
      try {
        await cp512.unsign(signed);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(
        CookieErrorReason.SignatureVerificationFailed,
      );
    });

    it('should throw InvalidAlgorithm when algorithm is unsupported', () => {
      let caught: unknown;
      try {
        CookieParser.create({ algorithm: 'md5' as any });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(CookieErrorReason.InvalidAlgorithm);
    });
  });

  describe('createCookie', () => {
    it('should create cookie with no defaults when none configured', () => {
      const cp = CookieParser.create();
      const cookie = cp.createCookie('session', 'abc');
      expect(cookie.name).toBe('session');
      expect(cookie.value).toBe('abc');
    });

    it('should apply parser defaults to created cookie', () => {
      const cp = CookieParser.create({
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/app',
        domain: 'example.com',
        maxAge: 3600,
        partitioned: true,
      });
      const cookie = cp.createCookie('session', 'abc');
      expect(cookie.httpOnly).toBe(true);
      expect(cookie.secure).toBe(true);
      expect(cookie.sameSite).toBe('strict');
      expect(cookie.path).toBe('/app');
      expect(cookie.domain).toBe('example.com');
      expect(cookie.maxAge).toBe(3600);
      expect(cookie.partitioned).toBe(true);
    });

    it('should allow per-cookie overrides over parser defaults', () => {
      const cp = CookieParser.create({
        httpOnly: true,
        secure: true,
        path: '/',
      });
      const cookie = cp.createCookie('session', 'abc', {
        httpOnly: false,
        secure: false,
        path: '/admin',
      });
      expect(cookie.httpOnly).toBe(false);
      expect(cookie.secure).toBe(false);
      expect(cookie.path).toBe('/admin');
    });

    it('should not apply secure to cookie when default is auto', () => {
      const cp = CookieParser.create({ secure: 'auto' });
      const cookie = cp.createCookie('session', 'abc');
      expect(cookie.secure).toBe(false);
    });

    it('should allow explicit secure override even when default is auto', () => {
      const cp = CookieParser.create({ secure: 'auto' });
      const cookie = cp.createCookie('session', 'abc', { secure: true });
      expect(cookie.secure).toBe(true);
    });
  });

  describe('serialize with context', () => {
    it('should resolve secure auto to true when context.isSecure is true', () => {
      const cp = CookieParser.create({ secure: 'auto' });
      const cookie = new Cookie('session', 'abc');
      const header = cp.serialize(cookie, { isSecure: true });
      expect(header).toContain('Secure');
    });

    it('should resolve secure auto to false when context.isSecure is false', () => {
      const cp = CookieParser.create({ secure: 'auto' });
      const cookie = new Cookie('session', 'abc');
      const header = cp.serialize(cookie, { isSecure: false });
      expect(header).not.toContain('Secure');
    });

    it('throws when secure="auto" but no SerializeContext is provided', () => {
      const cp = CookieParser.create({ secure: 'auto' });
      const cookie = new Cookie('session', 'abc');
      let caught: unknown;
      try { cp.serialize(cookie); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(CookieErrorReason.InvalidAttribute);
    });

    it('different kdfSalt produces signatures that do not cross-verify', async () => {
      const secret = '5qly1QnPB1M6tT3thbFxuaY6A7OXv2zS8_O3VTHTAQ8';
      const a = CookieParser.create({ secrets: [secret], kdfSalt: 'deployment-A-salt-padding-32-bytes!!' });
      const b = CookieParser.create({ secrets: [secret], kdfSalt: 'deployment-B-salt-padding-32-bytes!!' });
      const signed = a.sign(new Cookie('s', 'v'));
      let caught: unknown;
      try { await b.unsign(signed); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(CookieErrorReason.SignatureVerificationFailed);
    });

    it('throws when secure="auto" but context.isSecure is undefined', () => {
      const cp = CookieParser.create({ secure: 'auto' });
      const cookie = new Cookie('session', 'abc');
      let caught: unknown;
      try { cp.serialize(cookie, {}); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(CookieErrorReason.InvalidAttribute);
    });

    it('should apply nullable defaults in serialize when cookie has no domain', () => {
      const cp = CookieParser.create({ domain: 'example.com' });
      const cookie = new Cookie('session', 'abc');
      const header = cp.serialize(cookie);
      expect(header).toContain('Domain=example.com');
    });

    it('should not override cookie domain with default', () => {
      const cp = CookieParser.create({ domain: 'default.com' });
      const cookie = new Cookie('session', 'abc', { domain: 'explicit.com' });
      const header = cp.serialize(cookie);
      expect(header).toContain('Domain=explicit.com');
      expect(header).not.toContain('default.com');
    });

    it('should apply nullable maxAge default when cookie has none', () => {
      const cp = CookieParser.create({ maxAge: 7200 });
      const cookie = new Cookie('session', 'abc');
      const header = cp.serialize(cookie);
      expect(header).toContain('Max-Age=7200');
    });
  });

  describe('prefixValidation', () => {
    it('should auto-validate prefix when prefixValidation is true', () => {
      const cp = CookieParser.create({ prefixValidation: true });
      const cookie = new Cookie('__Host-x', 'v', { path: '/' });
      let caught: unknown;
      try {
        cp.serialize(cookie);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(
        CookieErrorReason.HostPrefixRequiresSecure,
      );
    });

    it('should not validate prefix when prefixValidation is false', () => {
      const cp = CookieParser.create({ prefixValidation: false });
      const cookie = new Cookie('__Host-x', 'v', { path: '/' });
      expect(() => cp.serialize(cookie)).not.toThrow();
    });

    it('should pass auto-validation for valid __Host- cookie', () => {
      const cp = CookieParser.create({ prefixValidation: true });
      const cookie = new Cookie('__Host-session', 'v', {
        secure: true,
        path: '/',
      });
      expect(() => cp.serialize(cookie)).not.toThrow();
    });

    it('should auto-validate with secure auto resolved to true', () => {
      const cp = CookieParser.create({
        prefixValidation: true,
        secure: 'auto',
      });
      const cookie = new Cookie('__Secure-token', 'v');
      expect(() => cp.serialize(cookie, { isSecure: true })).not.toThrow();
    });

    it('should fail auto-validation with secure auto resolved to false', () => {
      const cp = CookieParser.create({
        prefixValidation: true,
        secure: 'auto',
      });
      const cookie = new Cookie('__Secure-token', 'v');
      let caught: unknown;
      try {
        cp.serialize(cookie, { isSecure: false });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(
        CookieErrorReason.SecurePrefixRequiresSecure,
      );
    });
  });

  describe('cloneCookieWithDefaults', () => {
    it('should apply nullable defaults when signing cookie with no domain', () => {
      const cp = CookieParser.create({
        secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'],
        domain: 'example.com',
        maxAge: 3600,
      });
      const cookie = new Cookie('session', 'data');
      const signed = cp.sign(cookie);
      const header = cp.serialize(signed);
      expect(header).toContain('Domain=example.com');
      expect(header).toContain('Max-Age=3600');
    });

    it('should preserve maxAge 0 through sign roundtrip', async () => {
      const cp = CookieParser.create({ secrets: ['gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg'] });
      const cookie = new Cookie('session', 'data', { maxAge: 0 });
      const signed = cp.sign(cookie);
      expect(signed.maxAge).toBe(0);
      const unsigned = await cp.unsign(signed);
      expect(unsigned.maxAge).toBe(0);
    });
  });

  describe('RFC compliance', () => {
    it('should throw InvalidCookieName when name is empty', () => {
      const cp = CookieParser.create();
      let caught: unknown;
      try {
        cp.createCookie('', 'v');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(CookieErrorReason.InvalidCookieName);
    });

    it('should throw InvalidCookieName when name contains spaces', () => {
      const cp = CookieParser.create();
      let caught: unknown;
      try {
        cp.createCookie('bad name', 'v');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(CookieErrorReason.InvalidCookieName);
    });

    it('should throw InvalidCookieName when name contains control chars', () => {
      const cp = CookieParser.create();
      let caught: unknown;
      try {
        cp.createCookie('bad\x00name', 'v');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(CookieErrorReason.InvalidCookieName);
    });

    it('should throw InvalidCookieName when name contains separator chars', () => {
      const cp = CookieParser.create();
      for (const ch of ['(', ')', '<', '>', '@', ',', ';', ':', '\\', '"', '/', '[', ']', '?', '=', '{', '}']) {
        let caught: unknown;
        try {
          cp.createCookie(`bad${ch}name`, 'v');
        } catch (e) {
          caught = e;
        }
        expect(caught).toBeInstanceOf(CookieError);
      }
    });

    it('should accept valid token characters in cookie name', () => {
      const cp = CookieParser.create();
      expect(() => cp.createCookie('valid-name_123.test~!', 'v')).not.toThrow();
    });

    it('should throw CookieTooLarge when serialized cookie exceeds 4096 bytes', () => {
      const cp = CookieParser.create();
      const cookie = new Cookie('session', 'x'.repeat(4096));
      let caught: unknown;
      try {
        cp.serialize(cookie);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(CookieErrorReason.CookieTooLarge);
    });

    it('should not throw when serialized cookie is within 4096 bytes', () => {
      const cp = CookieParser.create();
      const cookie = new Cookie('gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg', 'v');
      expect(() => cp.serialize(cookie)).not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should encrypt and decrypt empty string value', async () => {
      const cp = CookieParser.create({ encryptionSecret: '9v7BAwKpXHWZnoKZIHV2XWch22HvF8bleOM6t4nc-A4' });
      const cookie = new Cookie('session', '');
      const encrypted = await cp.encrypt(cookie);
      const decrypted = await cp.decrypt(encrypted);
      expect(decrypted.value).toBe('');
    });

    it('should apply expires default in serialize when cookie has none', () => {
      const expires = new Date(Date.now() + 30 * 86400 * 1000);
      const cp = CookieParser.create({ expires });
      const cookie = new Cookie('session', 'v');
      const header = cp.serialize(cookie);
      expect(header).toContain('Expires=');
    });

    it('should apply maxAge 0 default via createCookie', () => {
      const cp = CookieParser.create({ maxAge: 0 });
      const cookie = cp.createCookie('session', 'v');
      expect(cookie.maxAge).toBe(0);
    });

    it('should not clone in serialize when no defaults apply and secure is not auto', () => {
      const cp = CookieParser.create();
      const cookie = new Cookie('session', 'v', { secure: true, path: '/' });
      const header = cp.serialize(cookie);
      expect(header).toContain('session=v');
      expect(header).toContain('Secure');
    });
  });

  describe('RFC 6265bis compliance', () => {
    it('should throw SameSiteNoneRequiresSecure when SameSite=None without Secure', () => {
      const cp = CookieParser.create();
      const cookie = new Cookie('session', 'v', { sameSite: 'none' });
      let caught: unknown;
      try {
        cp.serialize(cookie);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(
        CookieErrorReason.SameSiteNoneRequiresSecure,
      );
    });

    it('should allow SameSite=None with Secure', () => {
      const cp = CookieParser.create();
      const cookie = new Cookie('session', 'v', { sameSite: 'none', secure: true });
      expect(() => cp.serialize(cookie)).not.toThrow();
    });

    it('should allow SameSite=Lax without Secure', () => {
      const cp = CookieParser.create();
      const cookie = new Cookie('session', 'v', { sameSite: 'lax' });
      expect(() => cp.serialize(cookie)).not.toThrow();
    });

    it('should allow SameSite=Strict without Secure', () => {
      const cp = CookieParser.create();
      const cookie = new Cookie('session', 'v', { sameSite: 'strict' });
      expect(() => cp.serialize(cookie)).not.toThrow();
    });

    it('should allow cookie without Max-Age', () => {
      const cp = CookieParser.create();
      const cookie = new Cookie('session', 'v');
      expect(() => cp.serialize(cookie)).not.toThrow();
    });

    it('should validate SameSite=None after secure auto resolves to true', () => {
      const cp = CookieParser.create({ secure: 'auto' });
      const cookie = new Cookie('session', 'v', { sameSite: 'none' });
      expect(() => cp.serialize(cookie, { isSecure: true })).not.toThrow();
    });

    it('should reject SameSite=None after secure auto resolves to false', () => {
      const cp = CookieParser.create({ secure: 'auto' });
      const cookie = new Cookie('session', 'v', { sameSite: 'none' });
      let caught: unknown;
      try {
        cp.serialize(cookie, { isSecure: false });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(
        CookieErrorReason.SameSiteNoneRequiresSecure,
      );
    });
    it('should throw PartitionedRequiresSecure when Partitioned without Secure', () => {
      const cp = CookieParser.create();
      const cookie = new Cookie('session', 'v', { partitioned: true });
      let caught: unknown;
      try {
        cp.serialize(cookie);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(
        CookieErrorReason.PartitionedRequiresSecure,
      );
    });

    it('should allow Partitioned with Secure', () => {
      const cp = CookieParser.create();
      const cookie = new Cookie('session', 'v', { partitioned: true, secure: true });
      expect(() => cp.serialize(cookie)).not.toThrow();
    });

    it('should reject domain with semicolon at Cookie construction (Bun validates)', () => {
      expect(() => new Cookie('session', 'v', { domain: 'evil.com; Path=/' })).toThrow();
    });

    it('should reject domain with newline at Cookie construction (Bun validates)', () => {
      expect(() => new Cookie('session', 'v', { domain: "evil.com\r\nSet-Cookie: bad=1" })).toThrow();
    });

    it('should reject path with semicolon at Cookie construction (Bun validates)', () => {
      expect(() => new Cookie('session', 'v', { path: '/; Domain=evil.com' })).toThrow();
    });

    it('should reject path with newline at Cookie construction (Bun validates)', () => {
      expect(() => new Cookie('session', 'v', { path: "/\r\nSet-Cookie: bad=1" })).toThrow();
    });

    it('should allow valid domain and path', () => {
      const cp = CookieParser.create();
      const cookie = new Cookie('session', 'v', {
        domain: 'example.com',
        path: '/app/dashboard',
        secure: true,
      });
      expect(() => cp.serialize(cookie)).not.toThrow();
    });
  });

  describe('name binding (C1, C2 fixes)', () => {
    const SIGN_SECRET = 'CBzj5JR05_07YsY5omzjqXIij4t3dRfV53j5O7CQJ7A';
    const ENC_SECRET = 'cR4uVjV4lfCVnqFwvsyNGlH7SJ_mtBG5OdXE-evGkIY';

    it('should reject HMAC-signed value when cookie name differs (C1)', async () => {
      const cp = CookieParser.create({ secrets: [SIGN_SECRET] });
      const signed = cp.sign(new Cookie('admin', 'true'));
      // Replay signature under a different cookie name
      const replayed = new Cookie('user', signed.value);
      let caught: unknown;
      try { await cp.unsign(replayed); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(CookieErrorReason.SignatureVerificationFailed);
    });

    it('should reject AES-GCM ciphertext when cookie name differs (C2)', async () => {
      const cp = CookieParser.create({ encryptionSecret: ENC_SECRET });
      const encrypted = await cp.encrypt(new Cookie('admin', 'true'));
      const replayed = new Cookie('user', encrypted.value);
      let caught: unknown;
      try { await cp.decrypt(replayed); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(CookieErrorReason.DecryptionFailed);
    });

    it('should sign and unsign successfully when cookie name matches', async () => {
      const cp = CookieParser.create({ secrets: [SIGN_SECRET] });
      const signed = cp.sign(new Cookie('session', 'data'));
      const unsigned = await cp.unsign(signed);
      expect(unsigned.value).toBe('data');
    });

    it('should encrypt and decrypt successfully when cookie name matches', async () => {
      const cp = CookieParser.create({ encryptionSecret: ENC_SECRET });
      const encrypted = await cp.encrypt(new Cookie('session', 'data'));
      const decrypted = await cp.decrypt(encrypted);
      expect(decrypted.value).toBe('data');
    });
  });

  describe('encryption key rotation (H2 fix)', () => {
    const KEY_OLD = '6H3Sj5cLS9TVElTBHCWw8a90Gdi1B0TyW4hs5ZUXK8o';
    const KEY_NEW = 'ESduDrMmoDDKP-g1nZ882YzFcaZiYg-IzQoIiDqQ5kU';

    it('should accept encryptionSecret as array', () => {
      const cp = CookieParser.create({ encryptionSecret: [KEY_NEW, KEY_OLD] });
      expect(cp).toBeInstanceOf(CookieParser);
    });

    it('should encrypt with first key and decrypt with any key in array', async () => {
      const cpOld = CookieParser.create({ encryptionSecret: KEY_OLD });
      const encryptedOld = await cpOld.encrypt(new Cookie('s', 'data'));
      const cpRotated = CookieParser.create({ encryptionSecret: [KEY_NEW, KEY_OLD] });
      const decrypted = await cpRotated.decrypt(encryptedOld);
      expect(decrypted.value).toBe('data');
    });

    it('should fail to decrypt when no rotation key matches', async () => {
      const cpA = CookieParser.create({ encryptionSecret: KEY_OLD });
      const encrypted = await cpA.encrypt(new Cookie('s', 'data'));
      const cpB = CookieParser.create({ encryptionSecret: 'Zgpo7Ytgh_uw3ubvZ7SssN8oCbLdnr1DeeN6XSKScMA' });
      let caught: unknown;
      try { await cpB.decrypt(encrypted); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(CookieErrorReason.DecryptionFailed);
    });
  });

  describe('weak secret rejection (H1, N8 fixes)', () => {
    it('should throw WeakSecret when signing secret is shorter than 32 chars', () => {
      let caught: unknown;
      try { CookieParser.create({ secrets: ['short'] }); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(CookieErrorReason.WeakSecret);
    });

    it('should throw WeakSecret when encryption secret is shorter than 32 chars', () => {
      let caught: unknown;
      try { CookieParser.create({ encryptionSecret: 'short' }); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(CookieErrorReason.WeakSecret);
    });

    it('should accept high-entropy secret with exactly 32 chars', () => {
      const exact32 = 'lncXWJjxZUmIjzo4ihUH_c0hxCdx4KKVTEeHMAACqZ4';
      expect(() => CookieParser.create({ secrets: [exact32] })).not.toThrow();
      expect(() => CookieParser.create({ encryptionSecret: exact32 })).not.toThrow();
    });

    it('should reject low-entropy secret (single repeated char)', () => {
      let caught: unknown;
      try { CookieParser.create({ secrets: ['a'.repeat(40)] }); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(CookieErrorReason.WeakSecret);
    });
  });

  describe('maxAge integer validation (N6, N7 fixes)', () => {
    it('should throw InvalidMaxAge when maxAge is NaN via createCookie (N6)', () => {
      const cp = CookieParser.create();
      let caught: unknown;
      try { cp.createCookie('n', 'v', { maxAge: NaN as any }); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(CookieErrorReason.InvalidMaxAge);
    });

    it('should throw InvalidMaxAge when maxAge is decimal 0.5 via createCookie (N7)', () => {
      const cp = CookieParser.create();
      let caught: unknown;
      try { cp.createCookie('n', 'v', { maxAge: 0.5 as any }); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(CookieErrorReason.InvalidMaxAge);
    });

    it('should throw InvalidMaxAge when maxAge is Infinity via createCookie', () => {
      const cp = CookieParser.create();
      let caught: unknown;
      try { cp.createCookie('n', 'v', { maxAge: Infinity as any }); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(CookieErrorReason.InvalidMaxAge);
    });

    it('should throw InvalidMaxAge in serialize when raw Cookie has decimal maxAge', () => {
      const cp = CookieParser.create();
      let caught: unknown;
      try { cp.serialize(new Cookie('n', 'v', { maxAge: 0.5 as any })); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(CookieErrorReason.InvalidMaxAge);
    });

    it('should accept negative integer maxAge per RFC 6265bis §5.4', () => {
      const cp = CookieParser.create();
      const header = cp.serialize(cp.createCookie('n', 'v', { maxAge: -1 }));
      expect(header).toContain('Max-Age=-1');
    });

    it('should accept zero maxAge', () => {
      const cp = CookieParser.create();
      const header = cp.serialize(cp.createCookie('n', 'v', { maxAge: 0 }));
      expect(header).toContain('Max-Age=0');
    });
  });

  describe('constant-time HMAC verify (H3 fix)', () => {
    it('should verify correctly regardless of secret position in array', async () => {
      const KEY1 = '-0dchjqFPQroVsWenM90XGv9NwJ0SfIeMvViNC_P90s';
      const KEY5 = 'AjtO7x4Fi8N8X8_vJRapkf8F-lmYjkzTyTMoSr5Ywv4';
      const cp = CookieParser.create({ secrets: [KEY1, 't5U2PwbDwqncuRrp7ugKdwCdVNxY9l59p0DpZtCsr_w', 'nbfONK9H2TJNeewNHc4JE00NwToJpRqL8-PFeQgPsz4', 'h4Y-jMwAdZXyGnHTqRK3f4spihRsOLqCr1Z8NokZBkc', KEY5] });
      // Sign with last key
      const cpLast = CookieParser.create({ secrets: [KEY5] });
      const signed = cpLast.sign(new Cookie('s', 'data'));
      // Verifies even though it's last in rotation array
      const unsigned = await cp.unsign(signed);
      expect(unsigned.value).toBe('data');
    });
  });

  describe('token validation across all entry points (H-1 fix)', () => {
    const SIGN_SECRET = 'mUGiDLrJDq7yYP8XCeTmvHFu6uUYzYLNhl03gLPfllA';
    const ENC_SECRET = 'weIQlNCq5MacmAUQsFI8EnM1NM4Dana95Mn48ResQYs';

    function expectInvalidName(fn: () => unknown | Promise<unknown>): Promise<void> {
      return Promise.resolve()
        .then(fn)
        .then(
          () => { throw new Error('expected InvalidCookieName but no error thrown'); },
          (e) => {
            expect(e).toBeInstanceOf(CookieError);
            expect((e as CookieError).reason).toBe(CookieErrorReason.InvalidCookieName);
          },
        );
    }

    it('should reject comma in name via serialize (RFC 9110 §5.6.2 token violation)', () => {
      const cp = CookieParser.create();
      return expectInvalidName(() => cp.serialize(new Cookie('bad,name', 'v')));
    });

    it('should reject paren in name via serialize', () => {
      const cp = CookieParser.create();
      return expectInvalidName(() => cp.serialize(new Cookie('bad(name', 'v')));
    });

    it('should reject quote in name via serialize', () => {
      const cp = CookieParser.create();
      return expectInvalidName(() => cp.serialize(new Cookie('bad"name', 'v')));
    });

    it('should reject @ in name via serialize', () => {
      const cp = CookieParser.create();
      return expectInvalidName(() => cp.serialize(new Cookie('bad@name', 'v')));
    });

    it('should reject invalid name via sign', () => {
      const cp = CookieParser.create({ secrets: [SIGN_SECRET] });
      return expectInvalidName(() => cp.sign(new Cookie('bad,name', 'v')));
    });

    it('should reject invalid name via encrypt', async () => {
      const cp = CookieParser.create({ encryptionSecret: ENC_SECRET });
      await expectInvalidName(() => cp.encrypt(new Cookie('bad,name', 'v')));
    });

    it('should reject invalid name via unsign', async () => {
      const cp = CookieParser.create({ secrets: [SIGN_SECRET] });
      await expectInvalidName(() => cp.unsign(new Cookie('bad,name', 'v.sig')));
    });

    it('should reject invalid name via decrypt', async () => {
      const cp = CookieParser.create({ encryptionSecret: ENC_SECRET });
      await expectInvalidName(() => cp.decrypt(new Cookie('bad,name', 'bDx0MVBNq29dB9qJ7q1QHW_zSizEq3rqcoDOM_X7RWs')));
    });

    it('should reject invalid name via validatePrefix', () => {
      const cp = CookieParser.create();
      return expectInvalidName(() => cp.validatePrefix(new Cookie('bad,name', 'v')));
    });
  });

  describe('expires normalization (H-2 fix)', () => {
    it('should throw CookieError(InvalidExpires) for invalid date string via createCookie', () => {
      const cp = CookieParser.create();
      let caught: unknown;
      try { cp.createCookie('n', 'v', { expires: 'not-a-date' as any }); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(CookieErrorReason.InvalidExpires);
    });

    it('should throw CookieError(InvalidExpires) for NaN expires', () => {
      const cp = CookieParser.create();
      let caught: unknown;
      try { cp.createCookie('n', 'v', { expires: NaN as any }); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(CookieErrorReason.InvalidExpires);
    });

    it('should throw CookieError(InvalidExpires) for invalid Date object', () => {
      const cp = CookieParser.create();
      let caught: unknown;
      try { cp.createCookie('n', 'v', { expires: new Date('invalid') }); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(CookieErrorReason.InvalidExpires);
    });

    it('should throw CookieError(InvalidExpires) for Infinity expires', () => {
      const cp = CookieParser.create();
      let caught: unknown;
      try { cp.createCookie('n', 'v', { expires: Infinity as any }); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(CookieErrorReason.InvalidExpires);
    });

    it('should accept valid IMF-fixdate string', () => {
      const cp = CookieParser.create();
      expect(() => cp.createCookie('n', 'v', { expires: 'Wed, 21 Oct 2026 07:28:00 GMT' })).not.toThrow();
    });

    it('should accept valid Date object', () => {
      const cp = CookieParser.create();
      const future = new Date(Date.now() + 30 * 86400 * 1000);
      expect(() => cp.createCookie('n', 'v', { expires: future })).not.toThrow();
    });

    it('should accept valid number timestamp', () => {
      const cp = CookieParser.create();
      expect(() => cp.createCookie('n', 'v', { expires: Date.now() + 30 * 86400 * 1000 })).not.toThrow();
    });

    it('should wrap Bun ctor errors into CookieError (no TypeError leak)', () => {
      const cp = CookieParser.create();
      let caught: unknown;
      try { cp.createCookie('n', 'v', { domain: 'evil; injected' as any }); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(CookieErrorReason.InvalidDomain);
    });

    it('should wrap Bun path errors into CookieError', () => {
      const cp = CookieParser.create();
      let caught: unknown;
      try { cp.createCookie('n', 'v', { path: '/x;injected' as any }); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(CookieError);
      expect((caught as CookieError).reason).toBe(CookieErrorReason.InvalidPath);
    });
  });
});
