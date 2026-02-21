import { describe, expect, it } from 'bun:test';

import { HttpHeader } from '@zipbul/shared';
import { isErr } from '@zipbul/result';

import { Cors, CorsAction, CorsErrorReason, CorsRejectionReason } from '../index';
import type {
  CorsError,
  CorsContinueResult,
  CorsPreflightResult,
  CorsRejectResult,
  CorsResult,
} from '../index';

describe('Cors integration', () => {
  it('should handle full GET flow: create → handle → inspect headers', async () => {
    // Arrange
    const cors = Cors.create() as Cors;
    const req = new Request('http://localhost', {
      method: 'GET',
      headers: { [HttpHeader.Origin]: 'https://a.com' },
    });
    // Act
    const result = await cors.handle(req);
    // Assert
    expect(isErr(result)).toBe(false);
    const corsResult = result as CorsContinueResult;
    expect(corsResult.action).toBe(CorsAction.Continue);
    expect(corsResult.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe('*');
  });

  it('should handle full preflight flow: create → handle → inspect result', async () => {
    // Arrange
    const cors = Cors.create({
      origin: 'https://a.com',
      credentials: true,
      allowedHeaders: ['X-Custom'],
    }) as Cors;
    const req = new Request('http://localhost', {
      method: 'OPTIONS',
      headers: {
        [HttpHeader.Origin]: 'https://a.com',
        [HttpHeader.AccessControlRequestMethod]: 'POST',
        [HttpHeader.AccessControlRequestHeaders]: 'X-Custom',
      },
    });
    // Act
    const result = await cors.handle(req);
    // Assert
    expect(isErr(result)).toBe(false);
    const corsResult = result as CorsPreflightResult;
    expect(corsResult.action).toBe(CorsAction.RespondPreflight);
    expect(corsResult.statusCode).toBe(204);
    expect(corsResult.headers.get(HttpHeader.AccessControlAllowCredentials)).toBe('true');
    expect(corsResult.headers.has(HttpHeader.AccessControlAllowMethods)).toBe(true);
  });

  it('should return Err when create receives credentials with wildcard origin', () => {
    // Arrange / Act
    const result = Cors.create({ credentials: true, origin: '*' });
    // Assert
    expect(isErr(result)).toBe(true);
    if (isErr<CorsError>(result)) {
      expect(result.data.reason).toBe(CorsErrorReason.CredentialsWithWildcardOrigin);
    }
  });

  it('should return Err<CorsError> when OriginFn throws at runtime', async () => {
    // Arrange
    const cors = Cors.create({
      origin: () => { throw new Error('runtime failure'); },
    }) as Cors;
    const req = new Request('http://localhost', {
      method: 'GET',
      headers: { [HttpHeader.Origin]: 'https://a.com' },
    });
    // Act
    const result = await cors.handle(req);
    // Assert
    expect(isErr(result)).toBe(true);
    if (isErr<CorsError>(result)) {
      expect(result.data.reason).toBe(CorsErrorReason.OriginFunctionError);
    }
  });

  it('should return Reject when origin is false', async () => {
    // Arrange
    const cors = Cors.create({ origin: false }) as Cors;
    const req = new Request('http://localhost', {
      method: 'GET',
      headers: { [HttpHeader.Origin]: 'https://a.com' },
    });
    // Act
    const result = await cors.handle(req);
    // Assert
    expect(isErr(result)).toBe(false);
    const corsResult = result as CorsRejectResult;
    expect(corsResult.action).toBe(CorsAction.Reject);
    expect(corsResult.reason).toBe(CorsRejectionReason.OriginNotAllowed);
  });

  it('should return Continue for preflight when preflightContinue is true', async () => {
    // Arrange
    const cors = Cors.create({ origin: true, preflightContinue: true }) as Cors;
    const req = new Request('http://localhost', {
      method: 'OPTIONS',
      headers: {
        [HttpHeader.Origin]: 'https://a.com',
        [HttpHeader.AccessControlRequestMethod]: 'POST',
      },
    });
    // Act
    const result = await cors.handle(req);
    // Assert
    expect(isErr(result)).toBe(false);
    const corsResult = result as CorsContinueResult;
    expect(corsResult.action).toBe(CorsAction.Continue);
    expect(corsResult.headers.has(HttpHeader.AccessControlAllowMethods)).toBe(true);
  });

  it('should include ACEH in result headers when exposedHeaders is configured', async () => {
    // Arrange
    const cors = Cors.create({ origin: true, exposedHeaders: ['X-Request-Id'] }) as Cors;
    const req = new Request('http://localhost', {
      method: 'GET',
      headers: { [HttpHeader.Origin]: 'https://a.com' },
    });
    // Act
    const result = await cors.handle(req);
    // Assert
    expect(isErr(result)).toBe(false);
    const corsResult = result as CorsContinueResult;
    expect(corsResult.action).toBe(CorsAction.Continue);
    expect(corsResult.headers.get(HttpHeader.AccessControlExposeHeaders)).toBe('X-Request-Id');
  });

  it('should return Err when create receives maxAge as non-integer', () => {
    // Arrange / Act
    const result = Cors.create({ maxAge: 1.5 });
    // Assert
    expect(isErr(result)).toBe(true);
    if (isErr<CorsError>(result)) {
      expect(result.data.reason).toBe(CorsErrorReason.InvalidMaxAge);
    }
  });

  it('should return Err when create receives optionsSuccessStatus outside 200-299', () => {
    // Arrange / Act
    const result = Cors.create({ optionsSuccessStatus: 404 });
    // Assert
    expect(isErr(result)).toBe(true);
    if (isErr<CorsError>(result)) {
      expect(result.data.reason).toBe(CorsErrorReason.InvalidStatusCode);
    }
  });
});
