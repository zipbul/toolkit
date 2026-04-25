import { describe, expect, it } from 'bun:test';
import { isErr } from '@zipbul/result';

import { CookieParser, CookieJar } from '../../index';

describe('CookieParser E2E', () => {
  describe('simulated HTTP request/response cycle via jar', () => {
    it('should handle server setting signed+encrypted cookies and reading them back', async () => {
      const parser = CookieParser.create({
        secrets: ['prod-secret-2024-with-min-length__', 'prod-secret-2023-with-min-length__'],
        encryptionSecret: 'aes-256-gcm-production-key-padding',
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
      });

      const sessionData = JSON.stringify({ userId: 42, role: 'admin' });

      // Server sets cookie
      const outJar = new CookieJar(parser, '');
      outJar.set('session', sessionData);
      const setCookieHeaders = await outJar.getSetCookieHeaders();

      expect(setCookieHeaders).toHaveLength(1);
      expect(setCookieHeaders[0]).toContain('session=');
      expect(setCookieHeaders[0]).not.toContain('"userId"');
      expect(setCookieHeaders[0]).toContain('Secure');
      expect(setCookieHeaders[0]).toContain('HttpOnly');

      // Browser sends cookie back
      const cookieValue = setCookieHeaders[0]!.split('=').slice(1).join('=').split(';')[0]!;
      const inJar = new CookieJar(parser, `session=${cookieValue}`);
      const restored = JSON.parse((await inJar.get('session')) as string);
      expect(restored.userId).toBe(42);
      expect(restored.role).toBe('admin');
    });

    it('should handle mixed signed and encrypted cookies', async () => {
      const parser = CookieParser.create({
        secrets: ['prod-secret-2024-with-min-length__'],
        encryptionSecret: 'aes-256-gcm-production-key-padding',
      });

      const outJar = new CookieJar(parser, '');
      outJar.set('token', 'jwt.payload.sig');
      outJar.set('prefs', 'theme=dark&lang=ko');
      const headers = await outJar.getSetCookieHeaders();

      const cookieParts = headers.map((h) => {
        const name = h.split('=')[0]!;
        const value = h.split('=').slice(1).join('=').split(';')[0]!;
        return `${name}=${value}`;
      });

      const inJar = new CookieJar(parser, cookieParts.join('; '));
      expect(await inJar.get('token')).toBe('jwt.payload.sig');
      expect(await inJar.get('prefs')).toBe('theme=dark&lang=ko');
    });
  });

  describe('simulated Bun.serve handler via jar', () => {
    it('should work within a Bun.serve-like request handler flow', async () => {
      const parser = CookieParser.create({
        secrets: ['server-key-with-minimum-length____'],
        encryptionSecret: 'server-enc-with-minimum-length____',
        httpOnly: true,
        secure: true,
        path: '/',
        sameSite: 'lax',
      });

      async function handleRequest(cookieHeader: string): Promise<{
        headers: Record<string, string[]>;
        body: string;
      }> {
        const jar = new CookieJar(parser, cookieHeader);
        const session = await jar.get('session');

        if (session === null || isErr(session)) {
          jar.set('session', 'new-user');
          return {
            headers: { 'Set-Cookie': await jar.getSetCookieHeaders() },
            body: 'Welcome, new user!',
          };
        }

        return { headers: {}, body: `Welcome back, ${session}!` };
      }

      const firstResponse = await handleRequest('');
      expect(firstResponse.body).toBe('Welcome, new user!');
      expect(firstResponse.headers['Set-Cookie']).toHaveLength(1);

      const setCookie = firstResponse.headers['Set-Cookie']![0]!;
      const cookieValue = setCookie.split('=').slice(1).join('=').split(';')[0]!;

      const secondResponse = await handleRequest(`session=${cookieValue}`);
      expect(secondResponse.body).toBe('Welcome back, new-user!');
    });
  });

  describe('simulated key rotation scenario via jar', () => {
    it('should migrate cookies from old key to new key', async () => {
      const parserOld = CookieParser.create({
        secrets: ['rotation-key-year-2023__abcdefghijklmnop'],
        encryptionSecret: 'encryption-key-2023__paddingpadding',
      });

      const outJar = new CookieJar(parserOld, '');
      outJar.set('session', 'user-data');
      const oldHeaders = await outJar.getSetCookieHeaders();
      const oldValue = oldHeaders[0]!.split('=').slice(1).join('=').split(';')[0]!;

      // Migration parser accepts both keys
      const parserMigrate = CookieParser.create({
        secrets: ['rotation-key-year-2024__abcdefghijklmnop', 'rotation-key-year-2023__abcdefghijklmnop'],
        encryptionSecret: 'encryption-key-2023__paddingpadding',
      });
      const migrateJar = new CookieJar(parserMigrate, `session=${oldValue}`);
      expect(await migrateJar.get('session')).toBe('user-data');

      // Re-sign with new key
      migrateJar.set('session', 'user-data');
      const newHeaders = await migrateJar.getSetCookieHeaders();
      const newValue = newHeaders[0]!.split('=').slice(1).join('=').split(';')[0]!;

      // New-only parser can read
      const parserNew = CookieParser.create({
        secrets: ['rotation-key-year-2024__abcdefghijklmnop'],
        encryptionSecret: 'encryption-key-2023__paddingpadding',
      });
      const newJar = new CookieJar(parserNew, `session=${newValue}`);
      expect(await newJar.get('session')).toBe('user-data');
    });
  });

  describe('simulated middleware pattern via jar', () => {
    it('should handle complete middleware lifecycle', async () => {
      const parser = CookieParser.create({
        secrets: ['signing-key-primary-aaaaaaaaaaaaaaa'],
        encryptionSecret: 'encryption-key-extra-cccccccccccccc',
        httpOnly: true,
        secure: 'auto',
        sameSite: 'lax',
        path: '/',
        prefixValidation: true,
      });

      // Middleware creates jar on request
      async function middlewareOnRequest(
        cookieHeader: string,
        isSecure: boolean,
      ): Promise<{ jar: CookieJar; context: { isSecure: boolean } }> {
        return {
          jar: new CookieJar(parser, cookieHeader),
          context: { isSecure },
        };
      }

      // Handler uses jar
      const { jar, context } = await middlewareOnRequest('', true);
      const session = await jar.get('session');
      expect(session).toBeNull();

      jar.set('session', 'new-session');
      jar.delete('old-token');

      // Middleware serializes on response
      const headers = await jar.getSetCookieHeaders(context);
      expect(headers).toHaveLength(2);
      expect(headers[0]).toContain('Secure');
      expect(headers[0]).toContain('HttpOnly');
      expect(headers[1]).toContain('Max-Age=0');
    });
  });
});
