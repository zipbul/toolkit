import { describe, expect, it } from 'bun:test';

import { HttpHeader, HttpMethod, HttpStatus } from '@zipbul/shared';

import { CorsHandler } from './cors-handler';

describe('CorsHandler', () => {
  it('should return disallowed result when origin header is missing', async () => {
    const handler = new CorsHandler();
    const request = new Request('http://example.test', { method: HttpMethod.Get });

    const result = await handler.handle(request);

    expect(result.isAllowed).toBe(false);
    expect(result.headers.get(HttpHeader.AccessControlAllowOrigin)).toBeNull();
  });

  it('should return disallowed result when origin header is empty string', async () => {
    const handler = new CorsHandler();
    const request = new Request('http://example.test', {
      method: HttpMethod.Get,
      headers: {
        [HttpHeader.Origin]: '',
      },
    });

    const result = await handler.handle(request);

    expect(result.isAllowed).toBe(false);
    expect(result.headers.get(HttpHeader.AccessControlAllowOrigin)).toBeNull();
  });

  it('should allow wildcard origin when origin header is provided with default options', async () => {
    const handler = new CorsHandler();
    const request = new Request('http://example.test', {
      method: HttpMethod.Get,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
      },
    });

    const result = await handler.handle(request);

    expect(result.isAllowed).toBe(true);
    expect(result.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('*');
  });

  it('should return disallowed result when origin option is false', async () => {
    const handler = new CorsHandler({ origin: false });
    const request = new Request('http://example.test', {
      method: HttpMethod.Get,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
      },
    });

    const result = await handler.handle(request);

    expect(result.isAllowed).toBe(false);
  });

  it('should allow request when origin option is exact matching string', async () => {
    const handler = new CorsHandler({ origin: 'https://example.com' });
    const request = new Request('http://example.test', {
      method: HttpMethod.Get,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
      },
    });

    const result = await handler.handle(request);

    expect(result.isAllowed).toBe(true);
    expect(result.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('https://example.com');
  });

  it('should return disallowed result when origin option is non-matching string', async () => {
    const handler = new CorsHandler({ origin: 'https://allowed.example.com' });
    const request = new Request('http://example.test', {
      method: HttpMethod.Get,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
      },
    });

    const result = await handler.handle(request);

    expect(result.isAllowed).toBe(false);
  });

  it('should reflect origin when origin option is true', async () => {
    const handler = new CorsHandler({ origin: true });
    const request = new Request('http://example.test', {
      method: HttpMethod.Get,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
      },
    });

    const result = await handler.handle(request);

    expect(result.isAllowed).toBe(true);
    expect(result.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('https://example.com');
  });

  it('should return disallowed result when origin option is regular expression and does not match', async () => {
    const handler = new CorsHandler({ origin: /^https:\/\/allowed\./ });
    const request = new Request('http://example.test', {
      method: HttpMethod.Get,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
      },
    });

    const result = await handler.handle(request);

    expect(result.isAllowed).toBe(false);
  });

  it('should allow request when origin option is regular expression and matches', async () => {
    const handler = new CorsHandler({ origin: /^https:\/\/example\./ });
    const request = new Request('http://example.test', {
      method: HttpMethod.Get,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
      },
    });

    const result = await handler.handle(request);

    expect(result.isAllowed).toBe(true);
    expect(result.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('https://example.com');
  });

  it('should allow request when origin option array contains exact string', async () => {
    const handler = new CorsHandler({ origin: ['https://example.com'] });
    const request = new Request('http://example.test', {
      method: HttpMethod.Get,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
      },
    });

    const result = await handler.handle(request);

    expect(result.isAllowed).toBe(true);
  });

  it('should allow request when origin option array contains matching regular expression', async () => {
    const handler = new CorsHandler({ origin: [/^https:\/\/example\./] });
    const request = new Request('http://example.test', {
      method: HttpMethod.Get,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
      },
    });

    const result = await handler.handle(request);

    expect(result.isAllowed).toBe(true);
  });

  it('should return disallowed result when origin option array does not match request origin', async () => {
    const handler = new CorsHandler({ origin: ['https://allowed.example.com', /^https:\/\/api\./] });
    const request = new Request('http://example.test', {
      method: HttpMethod.Get,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
      },
    });

    const result = await handler.handle(request);

    expect(result.isAllowed).toBe(false);
  });

  it('should allow request when origin function returns true', async () => {
    const handler = new CorsHandler({
      origin: async () => true,
    });
    const request = new Request('http://example.test', {
      method: HttpMethod.Get,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
      },
    });

    const result = await handler.handle(request);

    expect(result.isAllowed).toBe(true);
    expect(result.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('https://example.com');
  });

  it('should allow request when origin function returns explicit origin string', async () => {
    const handler = new CorsHandler({
      origin: async () => 'https://proxy.example.com',
    });
    const request = new Request('http://example.test', {
      method: HttpMethod.Get,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
      },
    });

    const result = await handler.handle(request);

    expect(result.isAllowed).toBe(true);
    expect(result.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('https://proxy.example.com');
  });

  it('should allow request when origin function is synchronous and returns true', async () => {
    const handler = new CorsHandler({
      origin: () => true,
    });
    const request = new Request('http://example.test', {
      method: HttpMethod.Get,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
      },
    });

    const result = await handler.handle(request);

    expect(result.isAllowed).toBe(true);
  });

  it('should pass origin and request to origin function', async () => {
    let capturedOrigin = '';
    let capturedRequest: Request | null = null;

    const handler = new CorsHandler({
      origin: (origin, request) => {
        capturedOrigin = origin;
        capturedRequest = request;

        return true;
      },
    });
    const request = new Request('http://example.test', {
      method: HttpMethod.Get,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
      },
    });

    const result = await handler.handle(request);

    expect(result.isAllowed).toBe(true);
    expect(capturedOrigin).toBe('https://example.com');
    expect(capturedRequest === request).toBe(true);
  });

  it('should reject when origin function throws an error', async () => {
    const handler = new CorsHandler({
      origin: () => {
        throw new Error('origin function failed');
      },
    });
    const request = new Request('http://example.test', {
      method: HttpMethod.Get,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
      },
    });

    await expect(handler.handle(request)).rejects.toThrow('origin function failed');
  });

  it('should reject when origin function returns rejected promise', async () => {
    const handler = new CorsHandler({
      origin: async () => Promise.reject(new Error('origin function rejected')),
    });
    const request = new Request('http://example.test', {
      method: HttpMethod.Get,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
      },
    });

    await expect(handler.handle(request)).rejects.toThrow('origin function rejected');
  });

  it('should return disallowed result when origin function returns false', async () => {
    const handler = new CorsHandler({
      origin: async () => false,
    });
    const request = new Request('http://example.test', {
      method: HttpMethod.Get,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
      },
    });

    const result = await handler.handle(request);

    expect(result.isAllowed).toBe(false);
  });

  it('should return disallowed result when origin function returns empty string', async () => {
    const handler = new CorsHandler({
      origin: async () => '',
    });
    const request = new Request('http://example.test', {
      method: HttpMethod.Get,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
      },
    });

    const result = await handler.handle(request);

    expect(result.isAllowed).toBe(false);
  });

  it('should reflect request origin when credentials is true and origin option is wildcard', async () => {
    const handler = new CorsHandler({ origin: '*', credentials: true });
    const request = new Request('http://example.test', {
      method: HttpMethod.Get,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
      },
    });

    const result = await handler.handle(request);

    expect(result.isAllowed).toBe(true);
    expect(result.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('https://example.com');
    expect(result.headers.get(HttpHeader.AccessControlAllowCredentials)).toBe('true');
  });

  it('should set expose headers when exposed headers are provided', async () => {
    const handler = new CorsHandler({ exposedHeaders: ['x-request-id', 'x-rate-limit'] });
    const request = new Request('http://example.test', {
      method: HttpMethod.Get,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
      },
    });

    const result = await handler.handle(request);

    expect(result.headers.get(HttpHeader.AccessControlExposeHeaders)).toBe('x-request-id,x-rate-limit');
  });

  it('should not set expose headers when exposed headers is empty array', async () => {
    const handler = new CorsHandler({ exposedHeaders: [] });
    const request = new Request('http://example.test', {
      method: HttpMethod.Get,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
      },
    });

    const result = await handler.handle(request);

    expect(result.headers.get(HttpHeader.AccessControlExposeHeaders)).toBeNull();
  });

  it('should set wildcard expose headers when credentials is not enabled', async () => {
    const handler = new CorsHandler({ exposedHeaders: ['*'] });
    const request = new Request('http://example.test', {
      method: HttpMethod.Get,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
      },
    });

    const result = await handler.handle(request);

    expect(result.headers.get(HttpHeader.AccessControlExposeHeaders)).toBe('*');
  });

  it('should not set expose headers when exposed headers contains wildcard and credentials is true', async () => {
    const handler = new CorsHandler({ exposedHeaders: ['*'], credentials: true });
    const request = new Request('http://example.test', {
      method: HttpMethod.Get,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
      },
    });

    const result = await handler.handle(request);

    expect(result.headers.get(HttpHeader.AccessControlExposeHeaders)).toBeNull();
  });

  it('should not mark preflight when options request does not include access-control-request-method', async () => {
    const handler = new CorsHandler();
    const request = new Request('http://example.test', {
      method: HttpMethod.Options,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
      },
    });

    const result = await handler.handle(request);

    expect(result.isAllowed).toBe(true);
    expect(result.isPreflight).toBe(false);
    expect(result.shouldRespond).toBe(false);
  });

  it('should not mark preflight when access-control-request-method is empty string', async () => {
    const handler = new CorsHandler();
    const request = new Request('http://example.test', {
      method: HttpMethod.Options,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
        [HttpHeader.AccessControlRequestMethod]: '',
      },
    });

    const result = await handler.handle(request);

    expect(result.isPreflight).toBe(false);
    expect(result.isAllowed).toBe(true);
  });

  it('should mark preflight response when options method has access-control-request-method', async () => {
    const handler = new CorsHandler();
    const request = new Request('http://example.test', {
      method: HttpMethod.Options,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
        [HttpHeader.AccessControlRequestMethod]: HttpMethod.Post,
      },
    });

    const result = await handler.handle(request);

    expect(result.isPreflight).toBe(true);
    expect(result.shouldRespond).toBe(true);
    expect(result.statusCode).toBe(HttpStatus.NoContent);
    expect(result.headers.get(HttpHeader.AccessControlAllowMethods)).toContain(HttpMethod.Post);
  });

  it('should return disallowed result when preflight requested method is not allowed by configured methods', async () => {
    const handler = new CorsHandler({ methods: [HttpMethod.Get] });
    const request = new Request('http://example.test', {
      method: HttpMethod.Options,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
        [HttpHeader.AccessControlRequestMethod]: HttpMethod.Post,
      },
    });

    const result = await handler.handle(request);

    expect(result.isAllowed).toBe(false);
    expect(result.isPreflight).toBe(true);
  });

  it('should return disallowed result when allowed methods is empty', async () => {
    const handler = new CorsHandler({ methods: [] });
    const request = new Request('http://example.test', {
      method: HttpMethod.Options,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
        [HttpHeader.AccessControlRequestMethod]: HttpMethod.Post,
      },
    });

    const result = await handler.handle(request);

    expect(result.isAllowed).toBe(false);
    expect(result.isPreflight).toBe(true);
  });

  it('should allow request method matching with different casing', async () => {
    const handler = new CorsHandler({ methods: [HttpMethod.Post] });
    const request = new Request('http://example.test', {
      method: HttpMethod.Options,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
        [HttpHeader.AccessControlRequestMethod]: 'post',
      },
    });

    const result = await handler.handle(request);

    expect(result.isAllowed).toBe(true);
  });

  it('should allow requested method when methods wildcard is configured without credentials', async () => {
    const handler = new CorsHandler({ methods: ['*'] });
    const request = new Request('http://example.test', {
      method: HttpMethod.Options,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
        [HttpHeader.AccessControlRequestMethod]: HttpMethod.Put,
      },
    });

    const result = await handler.handle(request);

    expect(result.isAllowed).toBe(true);
    expect(result.headers.get(HttpHeader.AccessControlAllowMethods)).toBe('*');
  });

  it('should avoid wildcard methods when credentials is true by echoing requested method', async () => {
    const handler = new CorsHandler({ methods: ['*'], credentials: true });
    const request = new Request('http://example.test', {
      method: HttpMethod.Options,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
        [HttpHeader.AccessControlRequestMethod]: HttpMethod.Patch,
      },
    });

    const result = await handler.handle(request);

    expect(result.isAllowed).toBe(true);
    expect(result.headers.get(HttpHeader.AccessControlAllowMethods)).toBe(HttpMethod.Patch);
  });

  it('should set allow headers from request headers when allowedHeaders option is undefined', async () => {
    const handler = new CorsHandler();
    const request = new Request('http://example.test', {
      method: HttpMethod.Options,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
        [HttpHeader.AccessControlRequestMethod]: HttpMethod.Post,
        [HttpHeader.AccessControlRequestHeaders]: 'x-api-key,content-type',
      },
    });

    const result = await handler.handle(request);

    expect(result.isAllowed).toBe(true);
    expect(result.headers.get(HttpHeader.AccessControlAllowHeaders)).toBe('x-api-key,content-type');
    expect(result.headers.get(HttpHeader.Vary)).toContain(HttpHeader.AccessControlRequestHeaders);
  });

  it('should return disallowed result when requested headers are not allowed by configured headers', async () => {
    const handler = new CorsHandler({ allowedHeaders: ['content-type'] });
    const request = new Request('http://example.test', {
      method: HttpMethod.Options,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
        [HttpHeader.AccessControlRequestMethod]: HttpMethod.Post,
        [HttpHeader.AccessControlRequestHeaders]: 'x-api-key,content-type',
      },
    });

    const result = await handler.handle(request);

    expect(result.isAllowed).toBe(false);
  });

  it('should allow requested headers when configured headers include case-insensitive matches', async () => {
    const handler = new CorsHandler({ allowedHeaders: ['Content-Type', 'X-API-KEY'] });
    const request = new Request('http://example.test', {
      method: HttpMethod.Options,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
        [HttpHeader.AccessControlRequestMethod]: HttpMethod.Post,
        [HttpHeader.AccessControlRequestHeaders]: 'x-api-key,content-type',
      },
    });

    const result = await handler.handle(request);

    expect(result.isAllowed).toBe(true);
    expect(result.headers.get(HttpHeader.AccessControlAllowHeaders)).toBe('Content-Type,X-API-KEY');
  });

  it('should return disallowed result when configured allowed headers are empty and request includes headers', async () => {
    const handler = new CorsHandler({ allowedHeaders: [] });
    const request = new Request('http://example.test', {
      method: HttpMethod.Options,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
        [HttpHeader.AccessControlRequestMethod]: HttpMethod.Post,
        [HttpHeader.AccessControlRequestHeaders]: 'x-api-key',
      },
    });

    const result = await handler.handle(request);

    expect(result.isAllowed).toBe(false);
  });

  it('should set wildcard allow headers when allowed headers wildcard is configured without credentials', async () => {
    const handler = new CorsHandler({ allowedHeaders: ['*'] });
    const request = new Request('http://example.test', {
      method: HttpMethod.Options,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
        [HttpHeader.AccessControlRequestMethod]: HttpMethod.Post,
        [HttpHeader.AccessControlRequestHeaders]: 'x-api-key,content-type',
      },
    });

    const result = await handler.handle(request);

    expect(result.isAllowed).toBe(true);
    expect(result.headers.get(HttpHeader.AccessControlAllowHeaders)).toBe('*');
  });

  it('should not set allow headers when wildcard allowed headers are configured with credentials and request headers are missing', async () => {
    const handler = new CorsHandler({ allowedHeaders: ['*'], credentials: true });
    const request = new Request('http://example.test', {
      method: HttpMethod.Options,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
        [HttpHeader.AccessControlRequestMethod]: HttpMethod.Post,
      },
    });

    const result = await handler.handle(request);

    expect(result.isAllowed).toBe(true);
    expect(result.headers.get(HttpHeader.AccessControlAllowHeaders)).toBeNull();
  });

  it('should return disallowed result when wildcard allowed headers is used with authorization request header', async () => {
    const handler = new CorsHandler({ allowedHeaders: ['*'] });
    const request = new Request('http://example.test', {
      method: HttpMethod.Options,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
        [HttpHeader.AccessControlRequestMethod]: HttpMethod.Post,
        [HttpHeader.AccessControlRequestHeaders]: 'authorization,x-api-key',
      },
    });

    const result = await handler.handle(request);

    expect(result.isAllowed).toBe(false);
  });

  it('should return disallowed result when wildcard allowed headers is used with uppercase authorization request header', async () => {
    const handler = new CorsHandler({ allowedHeaders: ['*'] });
    const request = new Request('http://example.test', {
      method: HttpMethod.Options,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
        [HttpHeader.AccessControlRequestMethod]: HttpMethod.Post,
        [HttpHeader.AccessControlRequestHeaders]: 'Authorization,x-api-key',
      },
    });

    const result = await handler.handle(request);

    expect(result.isAllowed).toBe(false);
  });

  it('should allow authorization request header when authorization is explicitly listed with wildcard', async () => {
    const handler = new CorsHandler({ allowedHeaders: ['*', 'authorization'] });
    const request = new Request('http://example.test', {
      method: HttpMethod.Options,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
        [HttpHeader.AccessControlRequestMethod]: HttpMethod.Post,
        [HttpHeader.AccessControlRequestHeaders]: 'authorization,x-api-key',
      },
    });

    const result = await handler.handle(request);

    expect(result.isAllowed).toBe(true);
  });

  it('should allow authorization request header when explicit authorization is listed with mixed casing', async () => {
    const handler = new CorsHandler({ allowedHeaders: ['*', 'Authorization'] });
    const request = new Request('http://example.test', {
      method: HttpMethod.Options,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
        [HttpHeader.AccessControlRequestMethod]: HttpMethod.Post,
        [HttpHeader.AccessControlRequestHeaders]: 'authorization,x-api-key',
      },
    });

    const result = await handler.handle(request);

    expect(result.isAllowed).toBe(true);
  });

  it('should avoid wildcard allow headers when credentials is true by echoing request headers', async () => {
    const handler = new CorsHandler({ allowedHeaders: ['*'], credentials: true });
    const request = new Request('http://example.test', {
      method: HttpMethod.Options,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
        [HttpHeader.AccessControlRequestMethod]: HttpMethod.Post,
        [HttpHeader.AccessControlRequestHeaders]: 'x-api-key,content-type',
      },
    });

    const result = await handler.handle(request);

    expect(result.isAllowed).toBe(true);
    expect(result.headers.get(HttpHeader.AccessControlAllowHeaders)).toBe('x-api-key,content-type');
    expect(result.headers.get(HttpHeader.Vary)).toContain(HttpHeader.AccessControlRequestHeaders);
  });

  it('should set max age when maxAge option is provided', async () => {
    const handler = new CorsHandler({ maxAge: 600 });
    const request = new Request('http://example.test', {
      method: HttpMethod.Options,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
        [HttpHeader.AccessControlRequestMethod]: HttpMethod.Post,
      },
    });

    const result = await handler.handle(request);

    expect(result.headers.get(HttpHeader.AccessControlMaxAge)).toBe('600');
  });

  it('should set max age to zero when maxAge option is zero', async () => {
    const handler = new CorsHandler({ maxAge: 0 });
    const request = new Request('http://example.test', {
      method: HttpMethod.Options,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
        [HttpHeader.AccessControlRequestMethod]: HttpMethod.Post,
      },
    });

    const result = await handler.handle(request);

    expect(result.headers.get(HttpHeader.AccessControlMaxAge)).toBe('0');
  });

  it('should not include vary origin when allow origin is wildcard', async () => {
    const handler = new CorsHandler();
    const request = new Request('http://example.test', {
      method: HttpMethod.Get,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
      },
    });

    const result = await handler.handle(request);

    expect(result.headers.get(HttpHeader.Vary)).toBeNull();
  });

  it('should allow origin string value null when origin option explicitly permits it', async () => {
    const handler = new CorsHandler({ origin: 'null' });
    const request = new Request('http://example.test', {
      method: HttpMethod.Get,
      headers: {
        [HttpHeader.Origin]: 'null',
      },
    });

    const result = await handler.handle(request);

    expect(result.isAllowed).toBe(true);
    expect(result.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('null');
  });

  it('should include three vary fields for configured preflight response', async () => {
    const handler = new CorsHandler({
      origin: ['https://example.com'],
      methods: [HttpMethod.Post],
      allowedHeaders: ['content-type', 'x-api-key'],
    });
    const request = new Request('http://example.test', {
      method: HttpMethod.Options,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
        [HttpHeader.AccessControlRequestMethod]: HttpMethod.Post,
        [HttpHeader.AccessControlRequestHeaders]: 'x-api-key,content-type',
      },
    });

    const result = await handler.handle(request);
    const vary = result.headers.get(HttpHeader.Vary);

    expect(vary).toContain(HttpHeader.Origin);
    expect(vary).toContain(HttpHeader.AccessControlRequestMethod);
    expect(vary).toContain(HttpHeader.AccessControlRequestHeaders);
  });

  it('should include vary access-control-request-method for preflight responses', async () => {
    const handler = new CorsHandler({ methods: [HttpMethod.Post] });
    const request = new Request('http://example.test', {
      method: HttpMethod.Options,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
        [HttpHeader.AccessControlRequestMethod]: HttpMethod.Post,
      },
    });

    const result = await handler.handle(request);

    expect(result.headers.get(HttpHeader.Vary)).toContain(HttpHeader.AccessControlRequestMethod);
  });

  it('should include vary access-control-request-headers when configured allowed headers are returned', async () => {
    const handler = new CorsHandler({ allowedHeaders: ['content-type', 'x-api-key'] });
    const request = new Request('http://example.test', {
      method: HttpMethod.Options,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
        [HttpHeader.AccessControlRequestMethod]: HttpMethod.Post,
        [HttpHeader.AccessControlRequestHeaders]: 'x-api-key,content-type',
      },
    });

    const result = await handler.handle(request);

    expect(result.headers.get(HttpHeader.Vary)).toContain(HttpHeader.AccessControlRequestHeaders);
  });

  it('should continue preflight when preflightContinue is true', async () => {
    const handler = new CorsHandler({ preflightContinue: true });
    const request = new Request('http://example.test', {
      method: HttpMethod.Options,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
        [HttpHeader.AccessControlRequestMethod]: HttpMethod.Put,
      },
    });

    const result = await handler.handle(request);

    expect(result.isPreflight).toBe(true);
    expect(result.shouldRespond).toBe(false);
    expect(result.statusCode).toBeNull();
  });

  it('should keep configured headers when allowed headers are configured and request headers are missing', async () => {
    const handler = new CorsHandler({
      allowedHeaders: ['content-type', 'x-api-key'],
      methods: [HttpMethod.Post],
    });
    const request = new Request('http://example.test', {
      method: HttpMethod.Options,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
        [HttpHeader.AccessControlRequestMethod]: HttpMethod.Post,
      },
    });

    const result = await handler.handle(request);

    expect(result.isAllowed).toBe(true);
    expect(result.headers.get(HttpHeader.AccessControlAllowHeaders)).toBe('content-type,x-api-key');
  });

  it('should set custom options success status in handle result', async () => {
    const handler = new CorsHandler({ optionsSuccessStatus: HttpStatus.Ok });
    const request = new Request('http://example.test', {
      method: HttpMethod.Options,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
        [HttpHeader.AccessControlRequestMethod]: HttpMethod.Post,
      },
    });

    const result = await handler.handle(request);

    expect(result.isPreflight).toBe(true);
    expect(result.statusCode).toBe(HttpStatus.Ok);
  });

  it('should apply cors headers to existing response when applyHeaders is used', async () => {
    const handler = new CorsHandler();
    const request = new Request('http://example.test', {
      method: HttpMethod.Get,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
      },
    });
    const result = await handler.handle(request);
    const source = new Response('ok', {
      status: HttpStatus.Ok,
      headers: {
        'content-type': 'text/plain',
      },
    });

    const output = CorsHandler.applyHeaders(result, source);

    expect(output.headers.get('content-type')).toBe('text/plain');
    expect(output.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('*');
  });

  it('should merge vary header values when applyHeaders is used', async () => {
    const resultHeaders = new Headers({
      [HttpHeader.Vary]: 'Origin',
      [HttpHeader.AccessControlAllowOrigin]: 'https://example.com',
    });
    const source = new Response('ok', {
      headers: {
        [HttpHeader.Vary]: 'Accept-Encoding',
      },
    });

    const output = CorsHandler.applyHeaders(
      {
        headers: resultHeaders,
        isAllowed: true,
        isPreflight: false,
        shouldRespond: false,
        statusCode: null,
      },
      source,
    );

    const vary = output.headers.get(HttpHeader.Vary);

    expect(vary).toContain('Accept-Encoding');
    expect(vary).toContain('Origin');
  });

  it('should deduplicate vary values in case-insensitive manner when applyHeaders is used', () => {
    const resultHeaders = new Headers({
      [HttpHeader.Vary]: 'origin',
    });
    const source = new Response('ok', {
      headers: {
        [HttpHeader.Vary]: 'Origin',
      },
    });

    const output = CorsHandler.applyHeaders(
      {
        headers: resultHeaders,
        isAllowed: true,
        isPreflight: false,
        shouldRespond: false,
        statusCode: null,
      },
      source,
    );

    expect(output.headers.get(HttpHeader.Vary)).toBe('Origin');
  });

  it('should preserve status and status text when applyHeaders is used', () => {
    const createdStatus = 201;

    const output = CorsHandler.applyHeaders(
      {
        headers: new Headers({ [HttpHeader.AccessControlAllowOrigin]: '*' }),
        isAllowed: true,
        isPreflight: false,
        shouldRespond: false,
        statusCode: null,
      },
      new Response('ok', {
        status: createdStatus,
        statusText: 'Created',
      }),
    );

    expect(output.status).toBe(createdStatus);
    expect(output.statusText).toBe('Created');
  });

  it('should keep original response unchanged when applyHeaders is used with disallowed result', () => {
    const acceptedStatus = 202;

    const source = new Response('ok', {
      status: acceptedStatus,
      statusText: 'Accepted',
      headers: {
        'content-type': 'text/plain',
      },
    });

    const output = CorsHandler.applyHeaders(
      {
        headers: new Headers(),
        isAllowed: false,
        isPreflight: false,
        shouldRespond: false,
        statusCode: null,
      },
      source,
    );

    expect(output.status).toBe(acceptedStatus);
    expect(output.statusText).toBe('Accepted');
    expect(output.headers.get('content-type')).toBe('text/plain');
  });

  it('should create preflight response with configured status when helper is called', async () => {
    const handler = new CorsHandler({ optionsSuccessStatus: HttpStatus.Ok });
    const request = new Request('http://example.test', {
      method: HttpMethod.Options,
      headers: {
        [HttpHeader.Origin]: 'https://example.com',
        [HttpHeader.AccessControlRequestMethod]: HttpMethod.Post,
      },
    });
    const result = await handler.handle(request);

    const response = CorsHandler.createPreflightResponse(result);

    expect(response.status).toBe(HttpStatus.Ok);
  });

  it('should create preflight response with default status when result status code is null', () => {
    const response = CorsHandler.createPreflightResponse({
      headers: new Headers(),
      isAllowed: true,
      isPreflight: true,
      shouldRespond: true,
      statusCode: null,
    });

    expect(response.status).toBe(HttpStatus.NoContent);
  });

  it('should create preflight response with null body', () => {
    const response = CorsHandler.createPreflightResponse({
      headers: new Headers(),
      isAllowed: true,
      isPreflight: true,
      shouldRespond: true,
      statusCode: HttpStatus.NoContent,
    });

    expect(response.body).toBeNull();
  });
});
