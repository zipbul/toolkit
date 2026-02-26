import { describe, expect, it } from 'bun:test';

import { HttpHeader } from '@zipbul/shared';

import { Cors, CorsAction, CorsError, CorsErrorReason, CorsRejectionReason } from '../index';
import type {
  CorsContinueResult,
  CorsPreflightResult,
  CorsRejectResult,
} from '../index';

describe('Cors integration', () => {
  it('should handle full GET flow: create → handle → inspect headers', async () => {
    // Arrange
    const cors = Cors.create();
    const req = new Request('http://localhost', {
      method: 'GET',
      headers: { [HttpHeader.Origin]: 'https://a.com' },
    });
    // Act
    const result = await cors.handle(req) as CorsContinueResult;
    // Assert
    expect(result.action).toBe(CorsAction.Continue);
    expect(result.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('*');
  });

  it('should handle full preflight flow: create → handle → inspect result', async () => {
    // Arrange
    const cors = Cors.create({
      origin: 'https://a.com',
      credentials: true,
      allowedHeaders: ['X-Custom'],
    });
    const req = new Request('http://localhost', {
      method: 'OPTIONS',
      headers: {
        [HttpHeader.Origin]: 'https://a.com',
        [HttpHeader.AccessControlRequestMethod]: 'POST',
        [HttpHeader.AccessControlRequestHeaders]: 'X-Custom',
      },
    });
    // Act
    const result = await cors.handle(req) as CorsPreflightResult;
    // Assert
    expect(result.action).toBe(CorsAction.RespondPreflight);
    expect(result.statusCode).toBe(204);
    expect(result.headers.get(HttpHeader.AccessControlAllowCredentials)).toBe('true');
    expect(result.headers.has(HttpHeader.AccessControlAllowMethods)).toBe(true);
  });

  it('should throw CorsError when create receives credentials with wildcard origin', () => {
    // Arrange / Act / Assert
    let caught: unknown;
    try {
      Cors.create({ credentials: true, origin: '*' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CorsError);
    expect((caught as CorsError).reason).toBe(CorsErrorReason.CredentialsWithWildcardOrigin);
  });

  it('should throw CorsError when OriginFn throws at runtime', async () => {
    // Arrange
    const cors = Cors.create({
      origin: () => { throw new Error('runtime failure'); },
    });
    const req = new Request('http://localhost', {
      method: 'GET',
      headers: { [HttpHeader.Origin]: 'https://a.com' },
    });
    // Act / Assert
    let caught: unknown;
    try {
      await cors.handle(req);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CorsError);
    expect((caught as CorsError).reason).toBe(CorsErrorReason.OriginFunctionError);
  });

  it('should return Reject when origin is false', async () => {
    // Arrange
    const cors = Cors.create({ origin: false });
    const req = new Request('http://localhost', {
      method: 'GET',
      headers: { [HttpHeader.Origin]: 'https://a.com' },
    });
    // Act
    const result = await cors.handle(req) as CorsRejectResult;
    // Assert
    expect(result.action).toBe(CorsAction.Reject);
    expect(result.reason).toBe(CorsRejectionReason.OriginNotAllowed);
  });

  it('should return Continue for preflight when preflightContinue is true', async () => {
    // Arrange
    const cors = Cors.create({ origin: true, preflightContinue: true });
    const req = new Request('http://localhost', {
      method: 'OPTIONS',
      headers: {
        [HttpHeader.Origin]: 'https://a.com',
        [HttpHeader.AccessControlRequestMethod]: 'POST',
      },
    });
    // Act
    const result = await cors.handle(req) as CorsContinueResult;
    // Assert
    expect(result.action).toBe(CorsAction.Continue);
    expect(result.headers.has(HttpHeader.AccessControlAllowMethods)).toBe(true);
  });

  it('should include ACEH in result headers when exposedHeaders is configured', async () => {
    // Arrange
    const cors = Cors.create({ origin: true, exposedHeaders: ['X-Request-Id'] });
    const req = new Request('http://localhost', {
      method: 'GET',
      headers: { [HttpHeader.Origin]: 'https://a.com' },
    });
    // Act
    const result = await cors.handle(req) as CorsContinueResult;
    // Assert
    expect(result.action).toBe(CorsAction.Continue);
    expect(result.headers.get(HttpHeader.AccessControlExposeHeaders)).toBe('X-Request-Id');
  });

  it('should throw CorsError when create receives maxAge as non-integer', () => {
    // Arrange / Act / Assert
    let caught: unknown;
    try {
      Cors.create({ maxAge: 1.5 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CorsError);
    expect((caught as CorsError).reason).toBe(CorsErrorReason.InvalidMaxAge);
  });

  it('should throw CorsError when create receives optionsSuccessStatus outside 200-299', () => {
    // Arrange / Act / Assert
    let caught: unknown;
    try {
      Cors.create({ optionsSuccessStatus: 404 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CorsError);
    expect((caught as CorsError).reason).toBe(CorsErrorReason.InvalidStatusCode);
  });
});
