import { describe, expect, it } from 'bun:test';

import { HttpHeader, HttpMethod, HttpStatus } from '@zipbul/shared';

import { CorsAction, CorsHandler } from '../index';
import type { CorsContinueResult, CorsPreflightResult, CorsRejectResult } from '../index';
import type { CorsAllowed, CorsResult } from '../index';

function assertReject(result: CorsResult): asserts result is CorsRejectResult {
  expect(result.action).toBe(CorsAction.Reject);
}

function assertAllowed(result: CorsResult): asserts result is CorsAllowed {
  expect(result.action).not.toBe(CorsAction.Reject);
}

function assertContinue(result: CorsResult): asserts result is CorsContinueResult {
  expect(result.action).toBe(CorsAction.Continue);
}

function assertPreflight(result: CorsResult): asserts result is CorsPreflightResult {
  expect(result.action).toBe(CorsAction.RespondPreflight);
}

describe('cors-handler integration', () => {
  it('should create preflight response data and merge it into final response when modules are combined', async () => {
    const cors = new CorsHandler({
      origin: ['https://app.example.com'],
      methods: [HttpMethod.Get, HttpMethod.Post],
      allowedHeaders: ['content-type', 'authorization'],
      credentials: true,
      maxAge: 600,
      optionsSuccessStatus: HttpStatus.Ok,
    });
    const request = new Request('http://example.test', {
      method: HttpMethod.Options,
      headers: {
        [HttpHeader.Origin]: 'https://app.example.com',
        [HttpHeader.AccessControlRequestMethod]: HttpMethod.Post,
        [HttpHeader.AccessControlRequestHeaders]: 'content-type,authorization',
      },
    });

    const result = await cors.handle(request);

    assertPreflight(result);
    expect(result.statusCode).toBe(HttpStatus.Ok);
    expect(result.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('https://app.example.com');
    expect(result.headers.get(HttpHeader.AccessControlAllowMethods)).toBe('GET,POST');
    expect(result.headers.get(HttpHeader.AccessControlAllowHeaders)).toBe('content-type,authorization');
    expect(result.headers.get(HttpHeader.AccessControlAllowCredentials)).toBe('true');
    expect(result.headers.get(HttpHeader.AccessControlMaxAge)).toBe('600');
  });

  it('should reject preflight request when requested method is not in allowed methods', async () => {
    const cors = new CorsHandler({
      origin: ['https://app.example.com'],
      methods: [HttpMethod.Get],
    });
    const request = new Request('http://example.test', {
      method: HttpMethod.Options,
      headers: {
        [HttpHeader.Origin]: 'https://app.example.com',
        [HttpHeader.AccessControlRequestMethod]: HttpMethod.Post,
      },
    });

    const result = await cors.handle(request);

    assertReject(result);
  });

  it('should echo requested method and headers when wildcard options are used with credentials', async () => {
    const cors = new CorsHandler({
      origin: ['https://app.example.com'],
      methods: ['*'],
      allowedHeaders: ['*'],
      credentials: true,
    });
    const request = new Request('http://example.test', {
      method: HttpMethod.Options,
      headers: {
        [HttpHeader.Origin]: 'https://app.example.com',
        [HttpHeader.AccessControlRequestMethod]: HttpMethod.Patch,
        [HttpHeader.AccessControlRequestHeaders]: 'x-api-key,content-type',
      },
    });

    const result = await cors.handle(request);

    assertAllowed(result);
    expect(result.headers.get(HttpHeader.AccessControlAllowMethods)).toBe(HttpMethod.Patch);
    expect(result.headers.get(HttpHeader.AccessControlAllowHeaders)).toBe('x-api-key,content-type');
  });

  it('should preserve existing vary values when applying cors headers to response', async () => {
    const cors = new CorsHandler({
      origin: ['https://app.example.com'],
      credentials: true,
    });
    const request = new Request('http://example.test', {
      method: HttpMethod.Get,
      headers: {
        [HttpHeader.Origin]: 'https://app.example.com',
      },
    });

    const result = await cors.handle(request);
    const response = new Response('ok', {
      status: HttpStatus.Ok,
      headers: {
        [HttpHeader.Vary]: 'Accept-Encoding',
      },
    });

    assertAllowed(result);
    const merged = CorsHandler.applyHeaders(result, response);
    const vary = merged.headers.get(HttpHeader.Vary);

    expect(vary).toContain('Accept-Encoding');
    expect(vary).toContain(HttpHeader.Origin);
  });

  it('should reject wildcard allowed headers when request includes authorization header', async () => {
    const cors = new CorsHandler({
      origin: ['https://app.example.com'],
      methods: [HttpMethod.Post],
      allowedHeaders: ['*'],
    });
    const request = new Request('http://example.test', {
      method: HttpMethod.Options,
      headers: {
        [HttpHeader.Origin]: 'https://app.example.com',
        [HttpHeader.AccessControlRequestMethod]: HttpMethod.Post,
        [HttpHeader.AccessControlRequestHeaders]: 'authorization,x-api-key',
      },
    });

    const result = await cors.handle(request);

    assertReject(result);
  });

  it('should reject wildcard allowed headers when request includes uppercase Authorization header', async () => {
    const cors = new CorsHandler({
      origin: ['https://app.example.com'],
      methods: [HttpMethod.Post],
      allowedHeaders: ['*'],
    });
    const request = new Request('http://example.test', {
      method: HttpMethod.Options,
      headers: {
        [HttpHeader.Origin]: 'https://app.example.com',
        [HttpHeader.AccessControlRequestMethod]: HttpMethod.Post,
        [HttpHeader.AccessControlRequestHeaders]: 'Authorization,x-api-key',
      },
    });

    const result = await cors.handle(request);

    assertReject(result);
  });

  it('should allow authorization header when wildcard and explicit authorization are both configured', async () => {
    const cors = new CorsHandler({
      origin: ['https://app.example.com'],
      methods: [HttpMethod.Post],
      allowedHeaders: ['*', 'Authorization'],
    });
    const request = new Request('http://example.test', {
      method: HttpMethod.Options,
      headers: {
        [HttpHeader.Origin]: 'https://app.example.com',
        [HttpHeader.AccessControlRequestMethod]: HttpMethod.Post,
        [HttpHeader.AccessControlRequestHeaders]: 'authorization,x-api-key',
      },
    });

    const result = await cors.handle(request);

    assertAllowed(result);
  });

  it('should include request method and request headers in vary for configured preflight response', async () => {
    const cors = new CorsHandler({
      origin: ['https://app.example.com'],
      methods: [HttpMethod.Post],
      allowedHeaders: ['content-type', 'x-api-key'],
    });
    const request = new Request('http://example.test', {
      method: HttpMethod.Options,
      headers: {
        [HttpHeader.Origin]: 'https://app.example.com',
        [HttpHeader.AccessControlRequestMethod]: HttpMethod.Post,
        [HttpHeader.AccessControlRequestHeaders]: 'x-api-key,content-type',
      },
    });

    const result = await cors.handle(request);
    assertAllowed(result);
    const vary = result.headers.get(HttpHeader.Vary);

    expect(vary).toContain(HttpHeader.AccessControlRequestMethod);
    expect(vary).toContain(HttpHeader.AccessControlRequestHeaders);
  });

  it('should treat options request without access-control-request-method as non-preflight', async () => {
    const cors = new CorsHandler({
      origin: ['https://app.example.com'],
    });
    const request = new Request('http://example.test', {
      method: HttpMethod.Options,
      headers: {
        [HttpHeader.Origin]: 'https://app.example.com',
      },
    });

    const result = await cors.handle(request);

    assertContinue(result);
    expect(result.headers.get(HttpHeader.AccessControlAllowMethods)).toBeNull();
  });

  it('should return preflight result without immediate response when preflightContinue is enabled', async () => {
    const cors = new CorsHandler({
      origin: ['https://app.example.com'],
      methods: [HttpMethod.Post],
      preflightContinue: true,
    });
    const request = new Request('http://example.test', {
      method: HttpMethod.Options,
      headers: {
        [HttpHeader.Origin]: 'https://app.example.com',
        [HttpHeader.AccessControlRequestMethod]: HttpMethod.Post,
      },
    });

    const result = await cors.handle(request);

    assertContinue(result);
  });

  it('should keep preflight rejection contract when requested method is disallowed', async () => {
    const cors = new CorsHandler({
      origin: ['https://app.example.com'],
      methods: [HttpMethod.Get],
    });
    const request = new Request('http://example.test', {
      method: HttpMethod.Options,
      headers: {
        [HttpHeader.Origin]: 'https://app.example.com',
        [HttpHeader.AccessControlRequestMethod]: HttpMethod.Delete,
      },
    });

    const result = await cors.handle(request);

    assertReject(result);
  });

  it('should return wildcard origin and omit vary origin when credentials are disabled', async () => {
    const cors = new CorsHandler();
    const request = new Request('http://example.test', {
      method: HttpMethod.Get,
      headers: {
        [HttpHeader.Origin]: 'https://app.example.com',
      },
    });

    const result = await cors.handle(request);

    assertAllowed(result);
    expect(result.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('*');
    expect(result.headers.get(HttpHeader.Vary)).toBeNull();
  });

  it('should reflect request origin and append vary origin when credentials are enabled with wildcard origin', async () => {
    const cors = new CorsHandler({
      credentials: true,
    });
    const request = new Request('http://example.test', {
      method: HttpMethod.Get,
      headers: {
        [HttpHeader.Origin]: 'https://app.example.com',
      },
    });

    const result = await cors.handle(request);

    assertAllowed(result);
    expect(result.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('https://app.example.com');
    expect(result.headers.get(HttpHeader.AccessControlAllowCredentials)).toBe('true');
    expect(result.headers.get(HttpHeader.Vary)).toContain(HttpHeader.Origin);
  });

  it('should allow requested headers when allowedHeaders is undefined by echoing access-control-request-headers', async () => {
    const cors = new CorsHandler({
      origin: ['https://app.example.com'],
      methods: [HttpMethod.Put],
    });
    const request = new Request('http://example.test', {
      method: HttpMethod.Options,
      headers: {
        [HttpHeader.Origin]: 'https://app.example.com',
        [HttpHeader.AccessControlRequestMethod]: HttpMethod.Put,
        [HttpHeader.AccessControlRequestHeaders]: 'x-client-id,content-type',
      },
    });

    const result = await cors.handle(request);

    assertAllowed(result);
    expect(result.headers.get(HttpHeader.AccessControlAllowHeaders)).toBe('x-client-id,content-type');
    expect(result.headers.get(HttpHeader.Vary)).toContain(HttpHeader.AccessControlRequestHeaders);
  });

  it('should build preflight response and merge cors headers into existing response in sequence', async () => {
    const cors = new CorsHandler({
      origin: ['https://app.example.com'],
      methods: [HttpMethod.Post],
      allowedHeaders: ['content-type'],
    });
    const request = new Request('http://example.test', {
      method: HttpMethod.Options,
      headers: {
        [HttpHeader.Origin]: 'https://app.example.com',
        [HttpHeader.AccessControlRequestMethod]: HttpMethod.Post,
        [HttpHeader.AccessControlRequestHeaders]: 'content-type',
      },
    });

    const result = await cors.handle(request);
    assertPreflight(result);
    const preflightResponse = CorsHandler.createPreflightResponse(result);
    const merged = CorsHandler.applyHeaders(result, preflightResponse);

    expect(preflightResponse.status).toBe(HttpStatus.NoContent);
    expect(merged.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('https://app.example.com');
    expect(merged.headers.get(HttpHeader.AccessControlAllowMethods)).toBe('POST');
    expect(merged.headers.get(HttpHeader.AccessControlAllowHeaders)).toBe('content-type');
  });

  it('should keep request disallowed when origin callback denies the origin', async () => {
    const cors = new CorsHandler({
      origin: async () => false,
    });
    const request = new Request('http://example.test', {
      method: HttpMethod.Get,
      headers: {
        [HttpHeader.Origin]: 'https://app.example.com',
      },
    });

    const result = await cors.handle(request);

    assertReject(result);
  });
});