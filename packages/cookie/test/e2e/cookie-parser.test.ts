import { describe, expect, it } from 'bun:test';
import { Cookie } from 'bun';

import { CookieParser } from '../../index';

describe('CookieParser E2E', () => {
  const cp = CookieParser.create({
    secrets: ['prod-secret-2024', 'prod-secret-2023'],
    encryptionSecret: 'aes-256-gcm-production-key',
  });

  describe('simulated HTTP request/response cycle', () => {
    it('should handle server setting a signed+encrypted cookie and reading it back', async () => {
      const sessionData = JSON.stringify({
        userId: 42,
        role: 'admin',
        ts: Date.now(),
      });
      const cookie = new Cookie('__Secure-session', sessionData, {
        secure: true,
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
        maxAge: 86400,
      });

      cp.validatePrefix(cookie);
      const outbound = cp.serialize(await cp.encrypt(cp.sign(cookie)));
      expect(outbound).toContain('__Secure-session=');
      expect(outbound).not.toContain('"userId"');

      const inbound = cp.parseOne(outbound);
      const restored = JSON.parse((await cp.unsign(await cp.decrypt(inbound))).value);
      expect(restored.userId).toBe(42);
      expect(restored.role).toBe('admin');
    });

    it('should handle server parsing Cookie header with multiple cookies', async () => {
      const tokenCookie = new Cookie('token', 'jwt.payload.sig');
      const prefsCookie = new Cookie('prefs', 'theme=dark&lang=ko');

      const tokenSigned = cp.sign(tokenCookie);
      const prefsEncrypted = await cp.encrypt(prefsCookie);

      const cookieHeader = `token=${tokenSigned.value}; prefs=${prefsEncrypted.value}`;
      const parsed = cp.parse(cookieHeader);

      expect(parsed).toHaveLength(2);

      const tokenParsed = parsed.find((c) => c.name === 'token')!;
      const tokenUnsigned = await cp.unsign(tokenParsed);
      expect(tokenUnsigned.value).toBe('jwt.payload.sig');

      const prefsParsed = parsed.find((c) => c.name === 'prefs')!;
      const prefsDecrypted = await cp.decrypt(prefsParsed);
      expect(prefsDecrypted.value).toBe('theme=dark&lang=ko');
    });
  });

  describe('simulated Bun.serve handler integration', () => {
    it('should work within a Bun.serve-like request handler flow', async () => {
      async function handleRequest(cookieHeader: string): Promise<{
        headers: Record<string, string>;
        body: string;
      }> {
        const cookies = cp.parse(cookieHeader);
        const sessionCookie = cookies.find((c) => c.name === 'session');

        if (!sessionCookie) {
          const newSession = cp.serialize(
            await cp.encrypt(
              cp.sign(
                new Cookie('session', 'new-user', {
                  secure: true,
                  httpOnly: true,
                  path: '/',
                  sameSite: 'lax',
                }),
              ),
            ),
          );
          return {
            headers: { 'Set-Cookie': newSession },
            body: 'Welcome, new user!',
          };
        }

        const data = await cp.unsign(await cp.decrypt(sessionCookie));
        return { headers: {}, body: `Welcome back, ${data.value}!` };
      }

      const firstResponse = await handleRequest('');
      expect(firstResponse.body).toBe('Welcome, new user!');
      expect(firstResponse.headers['Set-Cookie']).toContain('session=');

      const setCookie = firstResponse.headers['Set-Cookie']!;
      const parsed = cp.parseOne(setCookie);

      const cookieFromClient = `session=${parsed.value}`;
      const secondResponse = await handleRequest(cookieFromClient);
      expect(secondResponse.body).toBe('Welcome back, new-user!');
    });
  });

  describe('simulated key rotation scenario', () => {
    it('should migrate cookies from old key to new key', async () => {
      const cpOld = CookieParser.create({
        secrets: ['2023-key'],
        encryptionSecret: 'enc-2023',
      });
      const oldCookie = await cpOld.encrypt(
        cpOld.sign(new Cookie('session', 'user-data')),
      );
      const oldHeader = cpOld.serialize(oldCookie);

      const cpMigrate = CookieParser.create({
        secrets: ['2024-key', '2023-key'],
        encryptionSecret: 'enc-2023',
      });
      const parsed = cpMigrate.parseOne(oldHeader);
      const decrypted = await cpMigrate.decrypt(parsed);
      const unsigned = await cpMigrate.unsign(decrypted);
      expect(unsigned.value).toBe('user-data');

      const reSigned = cpMigrate.sign(unsigned);
      const cpNewOnly = CookieParser.create({ secrets: ['2024-key'] });
      expect((await cpNewOnly.unsign(reSigned)).value).toBe('user-data');
    });
  });

  describe('framework middleware pattern', () => {
    it('should work as middleware that signs all outbound cookies', () => {
      const middleware = (outboundCookies: Cookie[]): string[] => {
        return outboundCookies.map((c) => {
          cp.validatePrefix(c);
          return cp.serialize(cp.sign(c));
        });
      };

      const cookies = [
        new Cookie('__Secure-token', 'abc', { secure: true, path: '/' }),
        new Cookie('prefs', 'dark', { path: '/' }),
      ];

      const headers = middleware(cookies);
      expect(headers).toHaveLength(2);
      expect(headers[0]).toContain('__Secure-token=');
      expect(headers[0]).toContain('Secure');
      expect(headers[1]).toContain('prefs=');
    });

    it('should work as middleware that unsigns all inbound cookies', async () => {
      const middleware = async (cookieHeader: string): Promise<Record<string, string>> => {
        const parsed = cp.parse(cookieHeader);
        const result: Record<string, string> = {};
        for (const c of parsed) {
          try {
            result[c.name] = (await cp.unsign(c)).value;
          } catch {
            result[c.name] = c.value;
          }
        }
        return result;
      };

      const signed1 = cp.sign(new Cookie('a', 'val-a'));
      const signed2 = cp.sign(new Cookie('b', 'val-b'));
      const header = `a=${signed1.value}; b=${signed2.value}; plain=hello`;

      const result = await middleware(header);
      expect(result['a']).toBe('val-a');
      expect(result['b']).toBe('val-b');
      expect(result['plain']).toBe('hello');
    });
  });

  describe('simulated http-adapter integration with createCookie', () => {
    it('should use createCookie with server defaults for full request/response cycle', async () => {
      const cpServer = CookieParser.create({
        secrets: ['server-key-2024'],
        encryptionSecret: 'server-enc-key',
        httpOnly: true,
        secure: 'auto',
        sameSite: 'lax',
        path: '/',
        prefixValidation: true,
      });

      async function handleRequest(
        cookieHeader: string,
        isSecure: boolean,
      ): Promise<{ headers: Record<string, string>; body: string }> {
        const cookies = cpServer.parse(cookieHeader);
        const sessionCookie = cookies.find((c) => c.name === 'session');

        if (!sessionCookie) {
          const newSession = cpServer.createCookie('session', 'new-user');
          const outbound = cpServer.serialize(
            await cpServer.encrypt(cpServer.sign(newSession)),
            { isSecure },
          );
          return {
            headers: { 'Set-Cookie': outbound },
            body: 'Welcome, new user!',
          };
        }

        const data = await cpServer.unsign(await cpServer.decrypt(sessionCookie));
        return { headers: {}, body: `Welcome back, ${data.value}!` };
      }

      const firstResponse = await handleRequest('', true);
      expect(firstResponse.body).toBe('Welcome, new user!');
      expect(firstResponse.headers['Set-Cookie']).toContain('session=');
      expect(firstResponse.headers['Set-Cookie']).toContain('Secure');
      expect(firstResponse.headers['Set-Cookie']).toContain('HttpOnly');

      const setCookie = firstResponse.headers['Set-Cookie']!;
      const parsed = cpServer.parseOne(setCookie);
      const cookieFromClient = `session=${parsed.value}`;

      const secondResponse = await handleRequest(cookieFromClient, true);
      expect(secondResponse.body).toBe('Welcome back, new-user!');
    });

    it('should not set Secure on HTTP with auto mode', () => {
      const cpDev = CookieParser.create({
        secrets: ['dev-key'],
        secure: 'auto',
        httpOnly: true,
        path: '/',
      });

      const cookie = cpDev.createCookie('session', 'dev-data');
      const signed = cpDev.sign(cookie);
      const header = cpDev.serialize(signed, { isSecure: false });

      expect(header).toContain('session=');
      expect(header).toContain('HttpOnly');
      expect(header).not.toContain('Secure');
    });
  });
});
