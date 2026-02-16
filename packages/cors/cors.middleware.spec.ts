import { describe, expect, it } from 'bun:test';
import { StatusCodes } from 'http-status-codes';

import type { HttpAdapter } from '../../adapter/http-adapter';

import { BunnerHttpContext } from '../../adapter';
import { BunnerRequest } from '../../bunner-request';
import { BunnerResponse } from '../../bunner-response';
import { HeaderField, HttpMethod } from '../../enums';
import { CORS_DEFAULT_METHODS } from './constants';
import { CorsMiddleware } from './cors.middleware';

/**
 * Comprehensive CORS Middleware Test Suite
 *
 * Based on:
 * - Fetch Standard (WHATWG): https://fetch.spec.whatwg.org/#cors-protocol
 * - W3C CORS Specification: https://www.w3.org/TR/cors/
 * - MDN Web Docs: https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS
 */
describe('cors.middleware', () => {
  // ============================================
  // Test Helpers
  // ============================================
  const isStatusCode = (value: number): value is StatusCodes => {
    return Object.values(StatusCodes).includes(value);
  };

  const isHttpMethod = (value: string): value is HttpMethod => {
    // oxlint-disable-next-line typescript-eslint/no-unsafe-enum-comparison
    return Object.values(HttpMethod).some(method => method === value);
  };

  const normalizeHttpMethod = (method: HttpMethod | string): HttpMethod => {
    if (typeof method === 'string') {
      const normalized = method.toUpperCase();

      if (isHttpMethod(normalized)) {
        return normalized;
      }
    }

    return HttpMethod.Get;
  };

  const createMockContext = (method: HttpMethod | string, headers: Record<string, string> = {}): BunnerHttpContext => {
    const reqHeaders = new Headers(headers);
    const request = new BunnerRequest({
      url: 'http://example.test',
      httpMethod: normalizeHttpMethod(method),
      headers: reqHeaders,
      params: {},
      query: {},
      body: null,
      isTrustedProxy: false,
      ip: null,
      ips: [],
    });
    const response = new BunnerResponse(request, new Headers());
    const adapter: HttpAdapter = {
      getRequest: () => request,
      getResponse: () => response,
      setHeader: (name: string, value: string) => {
        response.setHeader(name, value);
      },
      setStatus: (status: number) => {
        if (isStatusCode(status)) {
          response.setStatus(status);

          return;
        }

        response.setStatus(StatusCodes.OK);
      },
    };

    return new BunnerHttpContext(adapter);
  };

  const getResHeader = (ctx: BunnerHttpContext, name: string): string | null => {
    return ctx.response.getHeader(name);
  };

  // ============================================
  // 1. Non-HTTP Context Handling
  // ============================================
  // ============================================
  // 1. Non-HTTP Context Handling - REMOVED (Strict Types enforce HTTP)
  // ============================================

  // ============================================
  // 2. Origin Header Handling (Fetch Standard §3.2.5)
  // ============================================
  describe('Origin Header Handling', () => {
    it('should skip CORS processing when no Origin header is present', async () => {
      // Arrange
      const middleware = new CorsMiddleware();
      const ctx = createMockContext(HttpMethod.Get);

      // Act
      await middleware.handle(ctx);

      // Assert
      expect(getResHeader(ctx, HeaderField.AccessControlAllowOrigin)).toBeNull();
    });

    it('should set Access-Control-Allow-Origin to * when using defaults', async () => {
      // Arrange
      const middleware = new CorsMiddleware();
      const ctx = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'https://example.com' });

      // Act
      await middleware.handle(ctx);

      // Assert
      expect(getResHeader(ctx, HeaderField.AccessControlAllowOrigin)).toBe('*');
    });

    it('should not set Vary when using wildcard origin', async () => {
      // Arrange
      const middleware = new CorsMiddleware();
      const ctx = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'https://example.com' });

      // Act
      await middleware.handle(ctx);

      // Assert
      expect(getResHeader(ctx, HeaderField.Vary)).toBeNull();
    });

    it('should handle null origin when origin is allowed', async () => {
      // Arrange
      const middleware = new CorsMiddleware({ origin: true });
      const ctx = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'null' });

      // Act
      await middleware.handle(ctx);

      // Assert
      expect(getResHeader(ctx, HeaderField.AccessControlAllowOrigin)).toBe('null');
    });

    it('should block null origin when using strict origin string', async () => {
      // Arrange
      const middleware = new CorsMiddleware({ origin: 'https://example.com' });
      const ctx = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'null' });

      // Act
      await middleware.handle(ctx);

      // Assert
      expect(getResHeader(ctx, HeaderField.AccessControlAllowOrigin)).toBeNull();
    });
  });

  // ============================================
  // 3. Origin Matching Strategies
  // ============================================
  describe('Origin Matching Strategies', () => {
    describe('Boolean origin', () => {
      it('should reflect origin when configured as true', async () => {
        // Arrange
        const middleware = new CorsMiddleware({ origin: true });
        const ctx = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'https://example.com' });

        // Act
        await middleware.handle(ctx);

        // Assert
        expect(getResHeader(ctx, HeaderField.AccessControlAllowOrigin)).toBe('https://example.com');
        expect(getResHeader(ctx, HeaderField.Vary)).toBe(HeaderField.Origin);
      });

      it('should block all origins when configured as false', async () => {
        // Arrange
        const middleware = new CorsMiddleware({ origin: false });
        const ctx = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'https://example.com' });

        // Act
        await middleware.handle(ctx);

        // Assert
        expect(getResHeader(ctx, HeaderField.AccessControlAllowOrigin)).toBeNull();
      });
    });

    describe('String origin', () => {
      it('should match exact string origin when configured', async () => {
        // Arrange
        const middleware = new CorsMiddleware({ origin: 'https://allowed.com' });
        const ctx = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'https://allowed.com' });

        // Act
        await middleware.handle(ctx);

        // Assert
        expect(getResHeader(ctx, HeaderField.AccessControlAllowOrigin)).toBe('https://allowed.com');
        expect(getResHeader(ctx, HeaderField.Vary)).toBe(HeaderField.Origin);
      });

      it('should reject non-matching string origin when configured', async () => {
        // Arrange
        const middleware = new CorsMiddleware({ origin: 'https://allowed.com' });
        const ctx = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'https://forbidden.com' });

        // Act
        await middleware.handle(ctx);

        // Assert
        expect(getResHeader(ctx, HeaderField.AccessControlAllowOrigin)).toBeNull();
      });

      it('should be case-sensitive for origin matching when configured', async () => {
        // Arrange
        const middleware = new CorsMiddleware({ origin: 'https://Example.com' });
        const ctx = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'https://example.com' });

        // Act
        await middleware.handle(ctx);

        // Assert
        expect(getResHeader(ctx, HeaderField.AccessControlAllowOrigin)).toBeNull();
      });

      it('should not match partial origin strings when configured', async () => {
        // Arrange
        const middleware = new CorsMiddleware({ origin: 'https://example.com' });
        const ctx = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'https://example.com.evil.com' });

        // Act
        await middleware.handle(ctx);

        // Assert
        expect(getResHeader(ctx, HeaderField.AccessControlAllowOrigin)).toBeNull();
      });
    });

    describe('Regex origin', () => {
      it('should match regex origin pattern when configured', async () => {
        // Arrange
        const middleware = new CorsMiddleware({ origin: /\.example\.com$/ });
        const ctx = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'https://sub.example.com' });

        // Act
        await middleware.handle(ctx);

        // Assert
        expect(getResHeader(ctx, HeaderField.AccessControlAllowOrigin)).toBe('https://sub.example.com');
      });

      it('should match regex with protocol and port when configured', async () => {
        // Arrange
        const middleware = new CorsMiddleware({ origin: /^https:\/\/.*\.example\.com(:\d+)?$/ });
        const ctx1 = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'https://api.example.com' });

        // Act
        await middleware.handle(ctx1);

        // Assert
        expect(getResHeader(ctx1, HeaderField.AccessControlAllowOrigin)).toBe('https://api.example.com');

        const ctx2 = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'https://api.example.com:8080' });

        // Act
        await middleware.handle(ctx2);

        // Assert
        expect(getResHeader(ctx2, HeaderField.AccessControlAllowOrigin)).toBe('https://api.example.com:8080');
      });

      it('should reject regex non-match when configured', async () => {
        // Arrange
        const middleware = new CorsMiddleware({ origin: /^https:\/\/.*\.example\.com$/ });
        const ctx = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'http://sub.example.com' });

        // Act
        await middleware.handle(ctx);

        // Assert
        expect(getResHeader(ctx, HeaderField.AccessControlAllowOrigin)).toBeNull();
      });
    });

    describe('Array origin', () => {
      it('should match any origin in array when configured', async () => {
        // Arrange
        const middleware = new CorsMiddleware({ origin: ['https://a.com', 'https://b.com', /\.c\.com$/] });
        const ctx1 = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'https://a.com' });

        // Act
        await middleware.handle(ctx1);

        // Assert
        expect(getResHeader(ctx1, HeaderField.AccessControlAllowOrigin)).toBe('https://a.com');

        const ctx2 = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'https://sub.c.com' });

        // Act
        await middleware.handle(ctx2);

        // Assert
        expect(getResHeader(ctx2, HeaderField.AccessControlAllowOrigin)).toBe('https://sub.c.com');
      });

      it('should reject origin not in array when configured', async () => {
        // Arrange
        const middleware = new CorsMiddleware({ origin: ['https://a.com', 'https://b.com'] });
        const ctx = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'https://evil.com' });

        // Act
        await middleware.handle(ctx);

        // Assert
        expect(getResHeader(ctx, HeaderField.AccessControlAllowOrigin)).toBeNull();
      });

      it('should handle empty origin array when configured', async () => {
        // Arrange
        const middleware = new CorsMiddleware({ origin: [] });
        const ctx = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'https://any.com' });

        // Act
        await middleware.handle(ctx);

        // Assert
        expect(getResHeader(ctx, HeaderField.AccessControlAllowOrigin)).toBeNull();
      });
    });

    describe('Function origin', () => {
      it('should allow origin via async callback when resolved true', async () => {
        // Arrange
        const customOrigin = (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
          setTimeout(() => {
            cb(null, origin === 'https://allowed.com');
          }, 10);
        };

        const middleware = new CorsMiddleware({ origin: customOrigin });
        const ctx = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'https://allowed.com' });

        // Act
        await middleware.handle(ctx);

        // Assert
        expect(getResHeader(ctx, HeaderField.AccessControlAllowOrigin)).toBe('https://allowed.com');
      });

      it('should reject origin via async callback when resolved false', async () => {
        // Arrange
        const customOrigin = (_origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
          cb(null, false);
        };

        const middleware = new CorsMiddleware({ origin: customOrigin });
        const ctx = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'https://any.com' });

        // Act
        await middleware.handle(ctx);

        // Assert
        expect(getResHeader(ctx, HeaderField.AccessControlAllowOrigin)).toBeNull();
      });

      it('should handle callback error as rejection when error is returned', async () => {
        // Arrange
        const errorOrigin = (_: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
          cb(new Error('Database lookup failed'));
        };

        const middleware = new CorsMiddleware({ origin: errorOrigin });
        const ctx = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'https://example.com' });

        // Act
        await middleware.handle(ctx);

        // Assert
        expect(getResHeader(ctx, HeaderField.AccessControlAllowOrigin)).toBeNull();
      });
    });
  });

  // ============================================
  // 4. Credentials (Fetch Standard §3.2.5)
  // ============================================
  describe('Credentials Handling', () => {
    it('should set Access-Control-Allow-Credentials when enabled', async () => {
      // Arrange
      const middleware = new CorsMiddleware({ credentials: true });
      const ctx = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'https://example.com' });

      // Act
      await middleware.handle(ctx);

      // Assert
      expect(getResHeader(ctx, HeaderField.AccessControlAllowCredentials)).toBe('true');
    });

    it('should not set credentials header when disabled', async () => {
      // Arrange
      const middleware = new CorsMiddleware({ credentials: false });
      const ctx = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'https://example.com' });

      // Act
      await middleware.handle(ctx);

      // Assert
      expect(getResHeader(ctx, HeaderField.AccessControlAllowCredentials)).toBeNull();
    });

    /**
     * CRITICAL: Fetch Standard prohibits credentials with wildcard origin
     * "If credentials mode is included and Access-Control-Allow-Origin is `*`,
     * then throw a network error" (at browser level).
     *
     * To support this server-side, we must reflect the origin instead of returning '*'.
     */
    it('should reflect origin when credentials is true and origin is wildcard', async () => {
      // Arrange
      const middleware = new CorsMiddleware({ origin: '*', credentials: true });
      const ctx = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'https://example.com' });

      // Act
      await middleware.handle(ctx);

      // Assert
      expect(getResHeader(ctx, HeaderField.AccessControlAllowOrigin)).toBe('https://example.com');
      expect(getResHeader(ctx, HeaderField.Vary)).toBe(HeaderField.Origin);
    });

    it('should reflect origin when credentials is true and origin is default', async () => {
      // Arrange
      const middleware = new CorsMiddleware({ credentials: true });
      const ctx = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'https://example.com' });

      // Act
      await middleware.handle(ctx);

      // Assert
      expect(getResHeader(ctx, HeaderField.AccessControlAllowOrigin)).toBe('https://example.com');
      expect(getResHeader(ctx, HeaderField.Vary)).toBe(HeaderField.Origin);
    });
  });

  // ============================================
  // 5. Exposed Headers (Fetch Standard §3.2.5)
  // ============================================
  describe('Exposed Headers', () => {
    it('should set Access-Control-Expose-Headers when exposedHeaders is array', async () => {
      // Arrange
      const middleware = new CorsMiddleware({ exposedHeaders: ['X-Custom', 'X-Request-Id'] });
      const ctx = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'https://example.com' });

      // Act
      await middleware.handle(ctx);

      // Assert
      expect(getResHeader(ctx, HeaderField.AccessControlExposeHeaders)).toBe('X-Custom,X-Request-Id');
    });

    it('should handle single exposed header string when provided', async () => {
      // Arrange
      const middleware = new CorsMiddleware({ exposedHeaders: 'X-Single' });
      const ctx = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'https://example.com' });

      // Act
      await middleware.handle(ctx);

      // Assert
      expect(getResHeader(ctx, HeaderField.AccessControlExposeHeaders)).toBe('X-Single');
    });

    it('should not set header when exposedHeaders is empty array', async () => {
      // Arrange
      const middleware = new CorsMiddleware({ exposedHeaders: [] });
      const ctx = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'https://example.com' });

      // Act
      await middleware.handle(ctx);

      // Assert
      expect(getResHeader(ctx, HeaderField.AccessControlExposeHeaders)).toBeNull();
    });

    it('should not set header when exposedHeaders is not specified', async () => {
      // Arrange
      const middleware = new CorsMiddleware();
      const ctx = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'https://example.com' });

      // Act
      await middleware.handle(ctx);

      // Assert
      expect(getResHeader(ctx, HeaderField.AccessControlExposeHeaders)).toBeNull();
    });
  });

  // ============================================
  // 6. Preflight Requests (Fetch Standard §3.2.2)
  // ============================================
  describe('Preflight Requests', () => {
    describe('Basic Preflight Handling', () => {
      it('should handle OPTIONS preflight request when method is OPTIONS', async () => {
        // Arrange
        const middleware = new CorsMiddleware();
        const ctx = createMockContext(HttpMethod.Options, {
          [HeaderField.Origin]: 'https://example.com',
          [HeaderField.AccessControlRequestMethod]: HttpMethod.Post,
        });
        // Act
        const result = await middleware.handle(ctx);

        // Assert
        expect(result).toBe(false);
        expect(getResHeader(ctx, HeaderField.AccessControlAllowOrigin)).toBe('*');
        expect(getResHeader(ctx, HeaderField.AccessControlAllowMethods)).toBe(CORS_DEFAULT_METHODS.join(','));
        expect(ctx.response.getStatus()).toBe(StatusCodes.NO_CONTENT);
      });

      it('should use custom optionsSuccessStatus when configured', async () => {
        // Arrange
        const middleware = new CorsMiddleware({ optionsSuccessStatus: 200 });
        const ctx = createMockContext(HttpMethod.Options, {
          [HeaderField.Origin]: 'https://example.com',
          [HeaderField.AccessControlRequestMethod]: HttpMethod.Post,
        });
        // Act
        const result = await middleware.handle(ctx);

        // Assert
        expect(result).toBe(false);
        expect(ctx.response.getStatus()).toBe(StatusCodes.OK);
      });

      it('should skip preflight when Access-Control-Request-Method is missing', async () => {
        // Arrange
        const middleware = new CorsMiddleware();
        const ctx = createMockContext(HttpMethod.Options, {
          [HeaderField.Origin]: 'https://example.com',
          // Access-Control-Request-Method intentionally omitted
        });
        // Act
        const result = await middleware.handle(ctx);

        // Assert
        expect(result).toBeUndefined();
        expect(getResHeader(ctx, HeaderField.AccessControlAllowMethods)).toBeNull();
        expect(ctx.response.getStatus()).toBe(0);
      });

      it('should continue to next handler when preflightContinue is true', async () => {
        // Arrange
        const middleware = new CorsMiddleware({ preflightContinue: true });
        const ctx = createMockContext(HttpMethod.Options, {
          [HeaderField.Origin]: 'https://example.com',
          [HeaderField.AccessControlRequestMethod]: HttpMethod.Post,
        });
        // Act
        const result = await middleware.handle(ctx);

        // Assert
        expect(result).toBeUndefined();
        expect(ctx.response.getStatus()).toBe(0);
      });
    });

    describe('Allowed Methods', () => {
      it('should use custom methods array when configured', async () => {
        // Arrange
        const middleware = new CorsMiddleware({ methods: ['GET', 'POST', 'CUSTOM'] });
        const ctx = createMockContext(HttpMethod.Options, {
          [HeaderField.Origin]: 'https://example.com',
          [HeaderField.AccessControlRequestMethod]: 'CUSTOM',
        });
        // Act
        const result = await middleware.handle(ctx);

        // Assert
        expect(result).toBe(false);
        expect(getResHeader(ctx, HeaderField.AccessControlAllowMethods)).toBe('GET,POST,CUSTOM');
      });

      it('should use methods as single string when configured', async () => {
        // Arrange
        const middleware = new CorsMiddleware({ methods: 'GET,POST' });
        const ctx = createMockContext(HttpMethod.Options, {
          [HeaderField.Origin]: 'https://example.com',
          [HeaderField.AccessControlRequestMethod]: HttpMethod.Post,
        });

        // Act
        await middleware.handle(ctx);

        // Assert
        expect(getResHeader(ctx, HeaderField.AccessControlAllowMethods)).toBe('GET,POST');
      });

      it('should handle empty methods array when configured', async () => {
        // Arrange
        const middleware = new CorsMiddleware({ methods: [] });
        const ctx = createMockContext(HttpMethod.Options, {
          [HeaderField.Origin]: 'https://example.com',
          [HeaderField.AccessControlRequestMethod]: HttpMethod.Post,
        });

        // Act
        await middleware.handle(ctx);

        // Assert
        expect(getResHeader(ctx, HeaderField.AccessControlAllowMethods)).toBe('');
      });
    });

    describe('Allowed Headers', () => {
      it('should reflect request headers when allowedHeaders not specified', async () => {
        // Arrange
        const middleware = new CorsMiddleware();
        const ctx = createMockContext(HttpMethod.Options, {
          [HeaderField.Origin]: 'https://example.com',
          [HeaderField.AccessControlRequestMethod]: HttpMethod.Post,
          [HeaderField.AccessControlRequestHeaders]: 'X-Custom-Header,Authorization',
        });

        // Act
        await middleware.handle(ctx);

        // Assert
        expect(getResHeader(ctx, HeaderField.AccessControlAllowHeaders)).toBe('X-Custom-Header,Authorization');
        expect(getResHeader(ctx, HeaderField.Vary)).toContain(HeaderField.AccessControlRequestHeaders);
      });

      it('should use specified allowedHeaders array when configured', async () => {
        // Arrange
        const middleware = new CorsMiddleware({ allowedHeaders: ['Content-Type', 'Authorization'] });
        const ctx = createMockContext(HttpMethod.Options, {
          [HeaderField.Origin]: 'https://example.com',
          [HeaderField.AccessControlRequestMethod]: HttpMethod.Post,
          [HeaderField.AccessControlRequestHeaders]: 'X-Ignored',
        });

        // Act
        await middleware.handle(ctx);

        // Assert
        expect(getResHeader(ctx, HeaderField.AccessControlAllowHeaders)).toBe('Content-Type,Authorization');
      });

      it('should use allowedHeaders as single string when configured', async () => {
        // Arrange
        const middleware = new CorsMiddleware({ allowedHeaders: 'Content-Type,X-Api-Key' });
        const ctx = createMockContext(HttpMethod.Options, {
          [HeaderField.Origin]: 'https://example.com',
          [HeaderField.AccessControlRequestMethod]: HttpMethod.Post,
        });

        // Act
        await middleware.handle(ctx);

        // Assert
        expect(getResHeader(ctx, HeaderField.AccessControlAllowHeaders)).toBe('Content-Type,X-Api-Key');
      });

      it('should not set Access-Control-Allow-Headers when no request headers and no config', async () => {
        // Arrange
        const middleware = new CorsMiddleware();
        const ctx = createMockContext(HttpMethod.Options, {
          [HeaderField.Origin]: 'https://example.com',
          [HeaderField.AccessControlRequestMethod]: HttpMethod.Post,
          // No Access-Control-Request-Headers
        });

        // Act
        await middleware.handle(ctx);

        // Assert
        expect(getResHeader(ctx, HeaderField.AccessControlAllowHeaders)).toBeNull();
      });
    });

    describe('Max Age', () => {
      it('should set Access-Control-Max-Age when maxAge is set', async () => {
        // Arrange
        const middleware = new CorsMiddleware({ maxAge: 86400 });
        const ctx = createMockContext(HttpMethod.Options, {
          [HeaderField.Origin]: 'https://example.com',
          [HeaderField.AccessControlRequestMethod]: HttpMethod.Post,
        });

        // Act
        await middleware.handle(ctx);

        // Assert
        expect(getResHeader(ctx, HeaderField.AccessControlMaxAge)).toBe('86400');
      });

      it('should handle maxAge 0 when configured', async () => {
        // Arrange
        const middleware = new CorsMiddleware({ maxAge: 0 });
        const ctx = createMockContext(HttpMethod.Options, {
          [HeaderField.Origin]: 'https://example.com',
          [HeaderField.AccessControlRequestMethod]: HttpMethod.Post,
        });

        // Act
        await middleware.handle(ctx);

        // Assert
        expect(getResHeader(ctx, HeaderField.AccessControlMaxAge)).toBe('0');
      });

      it('should not set maxAge when not specified', async () => {
        // Arrange
        const middleware = new CorsMiddleware();
        const ctx = createMockContext(HttpMethod.Options, {
          [HeaderField.Origin]: 'https://example.com',
          [HeaderField.AccessControlRequestMethod]: HttpMethod.Post,
        });

        // Act
        await middleware.handle(ctx);

        // Assert
        expect(getResHeader(ctx, HeaderField.AccessControlMaxAge)).toBeNull();
      });
    });
  });

  // ============================================
  // 7. Simple/Actual Requests (non-preflight)
  // ============================================
  describe('Simple/Actual Requests', () => {
    it('should handle GET request when CORS headers are enabled', async () => {
      // Arrange
      const middleware = new CorsMiddleware({ origin: true, credentials: true });
      const ctx = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'https://example.com' });
      // Act
      const result = await middleware.handle(ctx);

      // Assert
      expect(result).toBeUndefined();
      expect(getResHeader(ctx, HeaderField.AccessControlAllowOrigin)).toBe('https://example.com');
      expect(getResHeader(ctx, HeaderField.AccessControlAllowCredentials)).toBe('true');
    });

    it('should handle HEAD request when method is HEAD', async () => {
      // Arrange
      const middleware = new CorsMiddleware();
      const ctx = createMockContext(HttpMethod.Head, { [HeaderField.Origin]: 'https://example.com' });

      // Act
      await middleware.handle(ctx);

      // Assert
      expect(getResHeader(ctx, HeaderField.AccessControlAllowOrigin)).toBe('*');
    });

    it('should handle POST request when method is POST', async () => {
      // Arrange
      const middleware = new CorsMiddleware({ origin: 'https://api.example.com' });
      const ctx = createMockContext(HttpMethod.Post, { [HeaderField.Origin]: 'https://api.example.com' });

      // Act
      await middleware.handle(ctx);

      // Assert
      expect(getResHeader(ctx, HeaderField.AccessControlAllowOrigin)).toBe('https://api.example.com');
    });

    it('should handle PUT request when method is PUT', async () => {
      // Arrange
      const middleware = new CorsMiddleware();
      const ctx = createMockContext(HttpMethod.Put, { [HeaderField.Origin]: 'https://example.com' });

      // Act
      await middleware.handle(ctx);

      // Assert
      expect(getResHeader(ctx, HeaderField.AccessControlAllowOrigin)).toBe('*');
    });

    it('should handle DELETE request when method is DELETE', async () => {
      // Arrange
      const middleware = new CorsMiddleware();
      const ctx = createMockContext(HttpMethod.Delete, { [HeaderField.Origin]: 'https://example.com' });

      // Act
      await middleware.handle(ctx);

      // Assert
      expect(getResHeader(ctx, HeaderField.AccessControlAllowOrigin)).toBe('*');
    });

    it('should handle PATCH request when method is PATCH', async () => {
      // Arrange
      const middleware = new CorsMiddleware();
      const ctx = createMockContext(HttpMethod.Patch, { [HeaderField.Origin]: 'https://example.com' });

      // Act
      await middleware.handle(ctx);

      // Assert
      expect(getResHeader(ctx, HeaderField.AccessControlAllowOrigin)).toBe('*');
    });
  });

  // ============================================
  // 8. Vary Header Handling (Fetch Standard §3.2.5)
  // ============================================
  describe('Vary Header Handling', () => {
    it('should set Vary: Origin when reflecting specific origin', async () => {
      // Arrange
      const middleware = new CorsMiddleware({ origin: true });
      const ctx = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'https://example.com' });

      // Act
      await middleware.handle(ctx);

      // Assert
      expect(getResHeader(ctx, HeaderField.Vary)).toBe(HeaderField.Origin);
    });

    it('should append to Vary header when preflight has reflected headers', async () => {
      // Arrange
      const middleware = new CorsMiddleware({ origin: true });
      const ctx = createMockContext(HttpMethod.Options, {
        [HeaderField.Origin]: 'https://example.com',
        [HeaderField.AccessControlRequestMethod]: HttpMethod.Post,
        [HeaderField.AccessControlRequestHeaders]: 'X-Custom',
      });

      // Act
      await middleware.handle(ctx);

      const vary = getResHeader(ctx, HeaderField.Vary);

      // Assert
      expect(vary).toContain(HeaderField.Origin);
      expect(vary).toContain(HeaderField.AccessControlRequestHeaders);
    });

    it('should not set Vary when origin is wildcard', async () => {
      // Arrange
      const middleware = new CorsMiddleware({ origin: '*' });
      const ctx = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'https://example.com' });

      // Act
      await middleware.handle(ctx);

      // Assert
      expect(getResHeader(ctx, HeaderField.Vary)).toBeNull();
    });
  });

  // ============================================
  // 9. Edge Cases and Security
  // ============================================
  describe('Edge Cases and Security', () => {
    it('should handle origin with port when port matches', async () => {
      // Arrange
      const middleware = new CorsMiddleware({ origin: 'http://localhost:3000' });
      const ctx = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'http://localhost:3000' });

      // Act
      await middleware.handle(ctx);

      // Assert
      expect(getResHeader(ctx, HeaderField.AccessControlAllowOrigin)).toBe('http://localhost:3000');
    });

    it('should treat different ports as different origins when configured', async () => {
      // Arrange
      const middleware = new CorsMiddleware({ origin: 'http://localhost:3000' });
      const ctx = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'http://localhost:4000' });

      // Act
      await middleware.handle(ctx);

      // Assert
      expect(getResHeader(ctx, HeaderField.AccessControlAllowOrigin)).toBeNull();
    });

    it('should reject origin with trailing slash when configured strictly', async () => {
      // Arrange
      const middleware = new CorsMiddleware({ origin: 'https://example.com' });
      const ctx = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'https://example.com/' });

      // Act
      await middleware.handle(ctx);

      // Assert
      expect(getResHeader(ctx, HeaderField.AccessControlAllowOrigin)).toBeNull();
    });

    it('should reject protocol mismatch when origin differs by protocol', async () => {
      // Arrange
      const middleware = new CorsMiddleware({ origin: 'https://example.com' });
      const ctx = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'http://example.com' });

      // Act
      await middleware.handle(ctx);

      // Assert
      expect(getResHeader(ctx, HeaderField.AccessControlAllowOrigin)).toBeNull();
    });

    it('should handle uppercase method in request when preflight is OPTIONS', async () => {
      // Arrange
      const middleware = new CorsMiddleware();
      const ctx = createMockContext('OPTIONS', {
        [HeaderField.Origin]: 'https://example.com',
        [HeaderField.AccessControlRequestMethod]: 'POST',
      });
      // Act
      const result = await middleware.handle(ctx);

      // Assert
      expect(result).toBe(false);
    });

    it('should handle multiple origins in sequence when middleware is reused', async () => {
      // Arrange
      const middleware = new CorsMiddleware({ origin: ['https://a.com', 'https://b.com'] });
      const ctx1 = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'https://a.com' });

      // Act
      await middleware.handle(ctx1);

      // Assert
      expect(getResHeader(ctx1, HeaderField.AccessControlAllowOrigin)).toBe('https://a.com');

      const ctx2 = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'https://b.com' });

      // Act
      await middleware.handle(ctx2);

      // Assert
      expect(getResHeader(ctx2, HeaderField.AccessControlAllowOrigin)).toBe('https://b.com');

      const ctx3 = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'https://c.com' });

      // Act
      await middleware.handle(ctx3);

      // Assert
      expect(getResHeader(ctx3, HeaderField.AccessControlAllowOrigin)).toBeNull();
    });
  });

  // ============================================
  // 10. Complete Configuration Scenarios
  // ============================================
  describe('Complete Configuration Scenarios', () => {
    it('should handle full production-like configuration when configured', async () => {
      // Arrange
      const middleware = new CorsMiddleware({
        origin: ['https://app.example.com', /\.example\.com$/],
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
        exposedHeaders: ['X-Response-Time', 'X-Request-Id'],
        credentials: true,
        maxAge: 86400,
        optionsSuccessStatus: 204,
      });
      // Preflight request
      const preflightCtx = createMockContext(HttpMethod.Options, {
        [HeaderField.Origin]: 'https://app.example.com',
        [HeaderField.AccessControlRequestMethod]: 'PUT',
        [HeaderField.AccessControlRequestHeaders]: 'Content-Type,Authorization',
      });
      // Act
      const preflightResult = await middleware.handle(preflightCtx);

      // Assert
      expect(preflightResult).toBe(false);
      expect(getResHeader(preflightCtx, HeaderField.AccessControlAllowOrigin)).toBe('https://app.example.com');
      expect(getResHeader(preflightCtx, HeaderField.AccessControlAllowMethods)).toBe('GET,POST,PUT,DELETE');
      expect(getResHeader(preflightCtx, HeaderField.AccessControlAllowHeaders)).toBe('Content-Type,Authorization,X-Request-Id');
      expect(getResHeader(preflightCtx, HeaderField.AccessControlAllowCredentials)).toBe('true');
      expect(getResHeader(preflightCtx, HeaderField.AccessControlMaxAge)).toBe('86400');
      expect(getResHeader(preflightCtx, HeaderField.Vary)).toContain(HeaderField.Origin);

      // Actual request
      const actualCtx = createMockContext(HttpMethod.Put, {
        [HeaderField.Origin]: 'https://api.example.com',
      });
      // Act
      const actualResult = await middleware.handle(actualCtx);

      // Assert
      expect(actualResult).toBeUndefined();
      expect(getResHeader(actualCtx, HeaderField.AccessControlAllowOrigin)).toBe('https://api.example.com');
      expect(getResHeader(actualCtx, HeaderField.AccessControlExposeHeaders)).toBe('X-Response-Time,X-Request-Id');
      expect(getResHeader(actualCtx, HeaderField.AccessControlAllowCredentials)).toBe('true');
    });

    it('should handle minimal configuration when defaults are used', async () => {
      // Arrange
      const middleware = new CorsMiddleware();
      const ctx = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'https://any.com' });

      // Act
      await middleware.handle(ctx);

      // Assert
      expect(getResHeader(ctx, HeaderField.AccessControlAllowOrigin)).toBe('*');
      expect(getResHeader(ctx, HeaderField.AccessControlAllowCredentials)).toBeNull();
      expect(getResHeader(ctx, HeaderField.AccessControlExposeHeaders)).toBeNull();
    });

    it('should handle strict single-origin configuration when configured', async () => {
      // Arrange
      const middleware = new CorsMiddleware({
        origin: 'https://trusted.com',
        credentials: true,
        maxAge: 3600,
      });
      const allowedCtx = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'https://trusted.com' });

      // Act
      await middleware.handle(allowedCtx);

      // Assert
      expect(getResHeader(allowedCtx, HeaderField.AccessControlAllowOrigin)).toBe('https://trusted.com');

      const blockedCtx = createMockContext(HttpMethod.Get, { [HeaderField.Origin]: 'https://untrusted.com' });

      // Act
      await middleware.handle(blockedCtx);

      // Assert
      expect(getResHeader(blockedCtx, HeaderField.AccessControlAllowOrigin)).toBeNull();
    });
  });
});
