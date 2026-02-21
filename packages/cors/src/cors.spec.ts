import { describe, expect, it, mock } from 'bun:test';

import { HttpHeader, HttpMethod, HttpStatus } from '@zipbul/shared';
import { isErr } from '@zipbul/result';
import type { Err } from '@zipbul/result';

import { CorsAction, CorsErrorReason, CorsRejectionReason } from './enums';
import type {
  CorsContinueResult,
  CorsError,
  CorsOptions,
  CorsPreflightResult,
  CorsRejectResult,
} from './interfaces';
import type { CorsResult } from './types';
import { Cors } from './cors';

// ── helpers ──

function makeRequest(
  method: string,
  origin?: string,
  headers?: Record<string, string>,
): Request {
  const h: Record<string, string> = { ...headers };
  if (origin !== undefined) h[HttpHeader.Origin] = origin;
  return new Request('http://localhost', { method, headers: h });
}

function makePreflight(
  origin: string,
  requestMethod: string,
  requestHeaders?: string,
): Request {
  const h: Record<string, string> = {
    [HttpHeader.Origin]: origin,
    [HttpHeader.AccessControlRequestMethod]: requestMethod,
  };
  if (requestHeaders !== undefined) {
    h[HttpHeader.AccessControlRequestHeaders] = requestHeaders;
  }
  return new Request('http://localhost', { method: 'OPTIONS', headers: h });
}

function assertReject(result: CorsResult): asserts result is CorsRejectResult {
  expect(result.action).toBe(CorsAction.Reject);
}

function assertContinue(result: CorsResult): asserts result is CorsContinueResult {
  expect(result.action).toBe(CorsAction.Continue);
}

function assertPreflight(result: CorsResult): asserts result is CorsPreflightResult {
  expect(result.action).toBe(CorsAction.RespondPreflight);
}

// ── tests ──

describe('Cors', () => {
  // ── Cors.create ──

  describe('create', () => {
    it('should return Cors instance for valid options', () => {
      // Arrange / Act
      const result = Cors.create({ origin: 'https://a.com' });
      // Assert
      expect(isErr(result)).toBe(false);
    });

    it('should return Err<CorsError> for invalid options', () => {
      // Arrange / Act
      const result = Cors.create({ credentials: true, origin: '*' });
      // Assert
      expect(isErr(result)).toBe(true);
      if (isErr<CorsError>(result)) {
        expect(result.data.reason).toBe(CorsErrorReason.CredentialsWithWildcardOrigin);
      }
    });
  });

  // ── Origin resolution ──

  describe('origin resolution', () => {
    it('should reject when Origin header is missing', async () => {
      // Arrange
      const cors = Cors.create() as Cors;
      const req = makeRequest('GET');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertReject(result as CorsResult);
      expect((result as CorsRejectResult).reason).toBe(CorsRejectionReason.NoOrigin);
    });

    it('should reject when Origin header is empty string', async () => {
      // Arrange
      const cors = Cors.create() as Cors;
      const req = makeRequest('GET', '');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertReject(result as CorsResult);
      expect((result as CorsRejectResult).reason).toBe(CorsRejectionReason.NoOrigin);
    });

    it('should return ACAO:* for wildcard origin and GET', async () => {
      // Arrange
      const cors = Cors.create() as Cors;
      const req = makeRequest('GET', 'https://a.com');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertContinue(result as CorsResult);
      expect((result as CorsContinueResult).headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('*');
    });

    it('should reflect origin when wildcard with credentials', async () => {
      // Arrange — origin defaults to '*', credentials:true → reflected
      // wait, create({credentials:true}) with default origin '*' → validate fails.
      // So we need origin:true + credentials:true
      const cors = Cors.create({ origin: true, credentials: true }) as Cors;
      const req = makeRequest('GET', 'https://a.com');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertContinue(result as CorsResult);
      expect((result as CorsContinueResult).headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('https://a.com');
    });

    it('should return Continue with Vary:Origin for specific string origin match', async () => {
      // Arrange
      const cors = Cors.create({ origin: 'https://a.com' }) as Cors;
      const req = makeRequest('GET', 'https://a.com');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertContinue(result as CorsResult);
      const headers = (result as CorsContinueResult).headers;
      expect(headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('https://a.com');
      expect(headers.get(HttpHeader.Vary)).toContain(HttpHeader.Origin);
    });

    it('should reject when specific string origin does not match', async () => {
      // Arrange
      const cors = Cors.create({ origin: 'https://a.com' }) as Cors;
      const req = makeRequest('GET', 'https://b.com');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertReject(result as CorsResult);
      expect((result as CorsRejectResult).reason).toBe(CorsRejectionReason.OriginNotAllowed);
    });

    it('should reflect origin when origin is true', async () => {
      // Arrange
      const cors = Cors.create({ origin: true }) as Cors;
      const req = makeRequest('GET', 'https://any.com');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertContinue(result as CorsResult);
      expect((result as CorsContinueResult).headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('https://any.com');
    });

    it('should reject when origin is false', async () => {
      // Arrange
      const cors = Cors.create({ origin: false }) as Cors;
      const req = makeRequest('GET', 'https://a.com');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertReject(result as CorsResult);
      expect((result as CorsRejectResult).reason).toBe(CorsRejectionReason.OriginNotAllowed);
    });

    it('should allow when origin matches RegExp', async () => {
      // Arrange
      const cors = Cors.create({ origin: /^https:\/\/.*\.example\.com$/ }) as Cors;
      const req = makeRequest('GET', 'https://sub.example.com');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertContinue(result as CorsResult);
    });

    it('should reject when origin does not match RegExp', async () => {
      // Arrange
      const cors = Cors.create({ origin: /^https:\/\/allowed\.com$/ }) as Cors;
      const req = makeRequest('GET', 'https://other.com');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertReject(result as CorsResult);
    });

    it('should return Allow consistently when RegExp has /g flag and called twice', async () => {
      // Arrange
      const cors = Cors.create({ origin: /^https:\/\/a\.com$/g }) as Cors;
      const req1 = makeRequest('GET', 'https://a.com');
      const req2 = makeRequest('GET', 'https://a.com');
      // Act
      const result1 = await cors.handle(req1);
      const result2 = await cors.handle(req2);
      // Assert
      assertContinue(result1 as CorsResult);
      assertContinue(result2 as CorsResult);
    });

    it('should return Allow consistently when array contains /g flag RegExp and called twice', async () => {
      // Arrange
      const cors = Cors.create({ origin: [/^https:\/\/a\.com$/g, 'https://b.com'] }) as Cors;
      const req1 = makeRequest('GET', 'https://a.com');
      const req2 = makeRequest('GET', 'https://a.com');
      // Act
      const result1 = await cors.handle(req1);
      const result2 = await cors.handle(req2);
      // Assert
      assertContinue(result1 as CorsResult);
      assertContinue(result2 as CorsResult);
    });

    it('should return Allow consistently when RegExp has no flag and called twice', async () => {
      // Arrange
      const cors = Cors.create({ origin: /^https:\/\/a\.com$/ }) as Cors;
      const req1 = makeRequest('GET', 'https://a.com');
      const req2 = makeRequest('GET', 'https://a.com');
      // Act
      const result1 = await cors.handle(req1);
      const result2 = await cors.handle(req2);
      // Assert
      assertContinue(result1 as CorsResult);
      assertContinue(result2 as CorsResult);
    });

    it('should allow when origin matches any entry in array (string+RegExp)', async () => {
      // Arrange
      const cors = Cors.create({ origin: ['https://a.com', /\.example\.com$/] }) as Cors;
      const req = makeRequest('GET', 'https://sub.example.com');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertContinue(result as CorsResult);
    });

    it('should reject when origin matches no entry in array', async () => {
      // Arrange
      const cors = Cors.create({ origin: ['https://a.com', /^https:\/\/b\.com$/] }) as Cors;
      const req = makeRequest('GET', 'https://c.com');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertReject(result as CorsResult);
    });

    it('should allow when OriginFn returns true', async () => {
      // Arrange
      const fn = mock(() => true as const);
      const cors = Cors.create({ origin: fn }) as Cors;
      const req = makeRequest('GET', 'https://a.com');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertContinue(result as CorsResult);
      expect(fn).toHaveBeenCalledWith('https://a.com', req);
    });

    it('should use custom string when OriginFn returns string', async () => {
      // Arrange
      const cors = Cors.create({ origin: () => 'https://custom.com' }) as Cors;
      const req = makeRequest('GET', 'https://a.com');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertContinue(result as CorsResult);
      expect((result as CorsContinueResult).headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('https://custom.com');
    });

    it('should reject when OriginFn returns false', async () => {
      // Arrange
      const cors = Cors.create({ origin: () => false }) as Cors;
      const req = makeRequest('GET', 'https://a.com');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertReject(result as CorsResult);
    });

    it('should return Err<CorsError> when OriginFn throws', async () => {
      // Arrange
      const cors = Cors.create({ origin: () => { throw new Error('boom'); } }) as Cors;
      const req = makeRequest('GET', 'https://a.com');
      // Act
      const result = await cors.handle(req);
      // Assert
      expect(isErr(result)).toBe(true);
      if (isErr<CorsError>(result)) {
        expect(result.data.reason).toBe(CorsErrorReason.OriginFunctionError);
      }
    });
  });

  // ── Credentials ──

  describe('credentials', () => {
    it('should set ACAC:true when credentials is true', async () => {
      // Arrange
      const cors = Cors.create({ origin: 'https://a.com', credentials: true }) as Cors;
      const req = makeRequest('GET', 'https://a.com');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertContinue(result as CorsResult);
      expect((result as CorsContinueResult).headers.get(HttpHeader.AccessControlAllowCredentials)).toBe('true');
    });
  });

  // ── Exposed headers ──

  describe('exposed headers', () => {
    it('should set ACEH for non-preflight when exposedHeaders is set', async () => {
      // Arrange
      const cors = Cors.create({ origin: true, exposedHeaders: ['X-Custom', 'X-Other'] }) as Cors;
      const req = makeRequest('GET', 'https://a.com');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertContinue(result as CorsResult);
      expect((result as CorsContinueResult).headers.get(HttpHeader.AccessControlExposeHeaders)).toBe('X-Custom,X-Other');
    });

    it('should not set ACEH when exposedHeaders is wildcard and credentials is true', async () => {
      // Arrange
      const cors = Cors.create({ origin: 'https://a.com', exposedHeaders: ['*'], credentials: true }) as Cors;
      const req = makeRequest('GET', 'https://a.com');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertContinue(result as CorsResult);
      expect((result as CorsContinueResult).headers.has(HttpHeader.AccessControlExposeHeaders)).toBe(false);
    });

    it('should keep explicit headers filtering wildcard when credentials is true', async () => {
      // Arrange
      const cors = Cors.create({ origin: 'https://a.com', exposedHeaders: ['*', 'X-Custom'], credentials: true }) as Cors;
      const req = makeRequest('GET', 'https://a.com');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertContinue(result as CorsResult);
      expect((result as CorsContinueResult).headers.get(HttpHeader.AccessControlExposeHeaders)).toBe('X-Custom');
    });

    it('should keep multiple explicit headers filtering wildcard when credentials is true', async () => {
      // Arrange
      const cors = Cors.create({ origin: 'https://a.com', exposedHeaders: ['X-A', '*', 'X-B'], credentials: true }) as Cors;
      const req = makeRequest('GET', 'https://a.com');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertContinue(result as CorsResult);
      expect((result as CorsContinueResult).headers.get(HttpHeader.AccessControlExposeHeaders)).toBe('X-A,X-B');
    });
  });

  // ── Preflight ──

  describe('preflight', () => {
    it('should return Continue when OPTIONS has no ACRM', async () => {
      // Arrange
      const cors = Cors.create({ origin: true }) as Cors;
      const req = makeRequest('OPTIONS', 'https://a.com');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertContinue(result as CorsResult);
    });

    it('should return RespondPreflight with ACAM when method is allowed', async () => {
      // Arrange
      const cors = Cors.create({ origin: true }) as Cors;
      const req = makePreflight('https://a.com', 'POST');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertPreflight(result as CorsResult);
      expect((result as CorsPreflightResult).headers.has(HttpHeader.AccessControlAllowMethods)).toBe(true);
    });

    it('should reject when preflight method is not allowed', async () => {
      // Arrange
      const cors = Cors.create({ origin: true, methods: ['GET'] }) as Cors;
      const req = makePreflight('https://a.com', 'DELETE');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertReject(result as CorsResult);
      expect((result as CorsRejectResult).reason).toBe(CorsRejectionReason.MethodNotAllowed);
    });

    it('should reject when preflight method has wrong case', async () => {
      // Arrange
      const cors = Cors.create({ origin: true, methods: ['GET', 'POST'] }) as Cors;
      const req = makePreflight('https://a.com', 'get');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertReject(result as CorsResult);
      expect((result as CorsRejectResult).reason).toBe(CorsRejectionReason.MethodNotAllowed);
    });

    it('should set ACAH when explicit allowedHeaders match', async () => {
      // Arrange
      const cors = Cors.create({ origin: true, allowedHeaders: ['X-Custom', 'Authorization'] }) as Cors;
      const req = makePreflight('https://a.com', 'POST', 'X-Custom');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertPreflight(result as CorsResult);
      expect((result as CorsPreflightResult).headers.get(HttpHeader.AccessControlAllowHeaders)).toBe('X-Custom,Authorization');
    });

    it('should reject when explicit allowedHeaders do not match', async () => {
      // Arrange
      const cors = Cors.create({ origin: true, allowedHeaders: ['X-Allowed'] }) as Cors;
      const req = makePreflight('https://a.com', 'POST', 'X-Forbidden');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertReject(result as CorsResult);
      expect((result as CorsRejectResult).reason).toBe(CorsRejectionReason.HeaderNotAllowed);
    });

    it('should echo request headers when allowedHeaders is null (echo mode)', async () => {
      // Arrange — default allowedHeaders is null after resolve
      const cors = Cors.create({ origin: true }) as Cors;
      const req = makePreflight('https://a.com', 'POST', 'X-Custom, X-Other');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertPreflight(result as CorsResult);
      expect((result as CorsPreflightResult).headers.get(HttpHeader.AccessControlAllowHeaders)).toBe('X-Custom, X-Other');
    });

    it('should set ACAH:* when allowedHeaders is wildcard without credentials', async () => {
      // Arrange
      const cors = Cors.create({ origin: true, allowedHeaders: ['*'] }) as Cors;
      const req = makePreflight('https://a.com', 'POST', 'X-Custom');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertPreflight(result as CorsResult);
      expect((result as CorsPreflightResult).headers.get(HttpHeader.AccessControlAllowHeaders)).toBe('*');
    });

    it('should reject when wildcard allowedHeaders with Authorization but no explicit entry', async () => {
      // Arrange
      const cors = Cors.create({ origin: true, allowedHeaders: ['*'] }) as Cors;
      const req = makePreflight('https://a.com', 'POST', 'Authorization');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertReject(result as CorsResult);
      expect((result as CorsRejectResult).reason).toBe(CorsRejectionReason.HeaderNotAllowed);
    });

    it('should allow Authorization with wildcard when explicitly listed', async () => {
      // Arrange
      const cors = Cors.create({
        origin: 'https://a.com',
        allowedHeaders: ['*', 'Authorization'],
        credentials: true,
      }) as Cors;
      const req = makePreflight('https://a.com', 'POST', 'Authorization, X-Custom');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertPreflight(result as CorsResult);
    });

    it('should set ACMA when maxAge is configured', async () => {
      // Arrange
      const cors = Cors.create({ origin: true, maxAge: 86400 }) as Cors;
      const req = makePreflight('https://a.com', 'POST');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertPreflight(result as CorsResult);
      expect((result as CorsPreflightResult).headers.get(HttpHeader.AccessControlMaxAge)).toBe('86400');
    });

    it('should return Continue when preflightContinue is true', async () => {
      // Arrange
      const cors = Cors.create({ origin: true, preflightContinue: true }) as Cors;
      const req = makePreflight('https://a.com', 'POST');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertContinue(result as CorsResult);
    });

    it('should use custom optionsSuccessStatus', async () => {
      // Arrange
      const cors = Cors.create({ origin: true, optionsSuccessStatus: 200 }) as Cors;
      const req = makePreflight('https://a.com', 'POST');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertPreflight(result as CorsResult);
      expect((result as CorsPreflightResult).statusCode).toBe(200);
    });
  });

  // ── Method serialization ──

  describe('method serialization', () => {
    it('should echo request method when methods is wildcard with credentials', async () => {
      // Arrange
      const cors = Cors.create({ origin: 'https://a.com', methods: ['*'], credentials: true }) as Cors;
      const req = makePreflight('https://a.com', 'PATCH');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertPreflight(result as CorsResult);
      expect((result as CorsPreflightResult).headers.get(HttpHeader.AccessControlAllowMethods)).toBe('PATCH');
    });

    it('should return ACAM:* when methods is wildcard without credentials', async () => {
      // Arrange
      const cors = Cors.create({ origin: true, methods: ['*'] }) as Cors;
      const req = makePreflight('https://a.com', 'PUT');
      // Act
      const result = await cors.handle(req);
      // Assert
      assertPreflight(result as CorsResult);
      expect((result as CorsPreflightResult).headers.get(HttpHeader.AccessControlAllowMethods)).toBe('*');
    });
  });

  // ── Idempotency ──

  describe('idempotency', () => {
    it('should produce identical results for the same request called twice', async () => {
      // Arrange
      const cors = Cors.create({ origin: 'https://a.com' }) as Cors;
      const req1 = makeRequest('GET', 'https://a.com');
      const req2 = makeRequest('GET', 'https://a.com');
      // Act
      const r1 = await cors.handle(req1);
      const r2 = await cors.handle(req2);
      // Assert
      expect(r1).toEqual(r2);
    });
  });
});
