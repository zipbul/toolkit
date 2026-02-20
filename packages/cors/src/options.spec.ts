import { describe, expect, it } from 'bun:test';

import { HttpMethod, HttpStatus } from '@zipbul/shared';

import { CORS_DEFAULT_METHODS, CORS_DEFAULT_OPTIONS_SUCCESS_STATUS } from './constants';
import { CorsErrorReason } from './enums';
import { resolveCorsOptions, validateCorsOptions } from './options';
import type { ResolvedCorsOptions } from './types';

describe('resolveCorsOptions', () => {
  it('should return all defaults when called without arguments', () => {
    // Arrange / Act
    const result = resolveCorsOptions();
    // Assert
    expect(result.origin).toBe('*');
    expect(result.methods).toEqual(CORS_DEFAULT_METHODS);
    expect(result.allowedHeaders).toBeNull();
    expect(result.exposedHeaders).toBeNull();
    expect(result.credentials).toBe(false);
    expect(result.maxAge).toBeNull();
    expect(result.preflightContinue).toBe(false);
    expect(result.optionsSuccessStatus).toBe(CORS_DEFAULT_OPTIONS_SUCCESS_STATUS);
  });

  it('should reflect all explicit values when every field is provided', () => {
    // Arrange
    const methods = [HttpMethod.Get, HttpMethod.Post];
    const allowedHeaders = ['X-Custom'];
    const exposedHeaders = ['X-Result'];
    const originFn = () => true as const;
    // Act
    const result = resolveCorsOptions({
      origin: originFn,
      methods,
      allowedHeaders,
      exposedHeaders,
      credentials: true,
      maxAge: 3600,
      preflightContinue: true,
      optionsSuccessStatus: HttpStatus.Ok,
    });
    // Assert
    expect(result.origin).toBe(originFn);
    expect(result.methods).toEqual(methods);
    expect(result.allowedHeaders).toEqual(allowedHeaders);
    expect(result.exposedHeaders).toEqual(exposedHeaders);
    expect(result.credentials).toBe(true);
    expect(result.maxAge).toBe(3600);
    expect(result.preflightContinue).toBe(true);
    expect(result.optionsSuccessStatus).toBe(HttpStatus.Ok);
  });

  it('should mix explicit origin with default values for remaining fields', () => {
    // Arrange / Act
    const result = resolveCorsOptions({ origin: 'https://example.com' });
    // Assert
    expect(result.origin).toBe('https://example.com');
    expect(result.methods).toEqual(CORS_DEFAULT_METHODS);
    expect(result.credentials).toBe(false);
  });

  it('should preserve falsy non-null values through nullish coalescing', () => {
    // Arrange / Act
    const result = resolveCorsOptions({
      origin: '',
      credentials: false,
      maxAge: 0,
      preflightContinue: false,
      optionsSuccessStatus: 0,
    });
    // Assert — these are falsy but NOT null/undefined, so ?? should not replace them
    expect(result.origin).toBe('');
    expect(result.credentials).toBe(false);
    expect(result.maxAge).toBe(0);
    expect(result.preflightContinue).toBe(false);
    expect(result.optionsSuccessStatus).toBe(0);
  });

  it('should return identical structure for identical options called twice', () => {
    // Arrange
    const options = { origin: 'https://a.com' as const, credentials: true };
    // Act
    const r1 = resolveCorsOptions(options);
    const r2 = resolveCorsOptions(options);
    // Assert
    expect(r1).toEqual(r2);
  });
});

describe('validateCorsOptions', () => {
  function makeResolved(overrides: Partial<ResolvedCorsOptions> = {}): ResolvedCorsOptions {
    return {
      origin: '*',
      methods: CORS_DEFAULT_METHODS,
      allowedHeaders: null,
      exposedHeaders: null,
      credentials: false,
      maxAge: null,
      preflightContinue: false,
      optionsSuccessStatus: CORS_DEFAULT_OPTIONS_SUCCESS_STATUS,
      ...overrides,
    };
  }

  it('should pass for default resolved options', () => {
    // Arrange
    const resolved = makeResolved();
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when credentials is true with non-wildcard origin', () => {
    // Arrange
    const resolved = makeResolved({ credentials: true, origin: 'https://a.com' });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should return CorsError when credentials is true with wildcard origin', () => {
    // Arrange
    const resolved = makeResolved({ credentials: true, origin: '*' });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeDefined();
    expect(result!.data.reason).toBe(CorsErrorReason.CredentialsWithWildcardOrigin);
    expect(typeof result!.data.message).toBe('string');
  });

  it('should return CorsError when maxAge is negative', () => {
    // Arrange
    const resolved = makeResolved({ maxAge: -1 });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeDefined();
    expect(result!.data.reason).toBe(CorsErrorReason.InvalidMaxAge);
  });

  it('should return CorsError when optionsSuccessStatus is below 200', () => {
    // Arrange
    const resolved = makeResolved({ optionsSuccessStatus: 0 });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeDefined();
    expect(result!.data.reason).toBe(CorsErrorReason.InvalidStatusCode);
  });

  it('should return CorsError when optionsSuccessStatus is above 299', () => {
    // Arrange
    const resolved = makeResolved({ optionsSuccessStatus: 300 });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeDefined();
    expect(result!.data.reason).toBe(CorsErrorReason.InvalidStatusCode);
  });

  it('should return CorsError when maxAge is non-integer', () => {
    // Arrange
    const resolved = makeResolved({ maxAge: 1.5 });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeDefined();
    expect(result!.data.reason).toBe(CorsErrorReason.InvalidMaxAge);
  });

  it('should return CorsError when maxAge is Infinity', () => {
    // Arrange
    const resolved = makeResolved({ maxAge: Infinity });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeDefined();
    expect(result!.data.reason).toBe(CorsErrorReason.InvalidMaxAge);
  });

  it('should return CorsError when optionsSuccessStatus is 100', () => {
    // Arrange
    const resolved = makeResolved({ optionsSuccessStatus: 100 });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeDefined();
    expect(result!.data.reason).toBe(CorsErrorReason.InvalidStatusCode);
  });

  it('should return CorsError when optionsSuccessStatus is 599', () => {
    // Arrange
    const resolved = makeResolved({ optionsSuccessStatus: 599 });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeDefined();
    expect(result!.data.reason).toBe(CorsErrorReason.InvalidStatusCode);
  });

  it('should pass when maxAge is zero (boundary)', () => {
    // Arrange
    const resolved = makeResolved({ maxAge: 0 });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when optionsSuccessStatus is 200 (lower boundary)', () => {
    // Arrange
    const resolved = makeResolved({ optionsSuccessStatus: 200 });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when optionsSuccessStatus is 299 (upper boundary)', () => {
    // Arrange
    const resolved = makeResolved({ optionsSuccessStatus: 299 });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when maxAge is negative zero', () => {
    // Arrange
    const resolved = makeResolved({ maxAge: -0 });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should reject at first violated rule when multiple rules fail', () => {
    // Arrange — credentials+wildcard (V1) + maxAge:-1 (V2) + status:0 (V3)
    const resolved = makeResolved({
      credentials: true,
      origin: '*',
      maxAge: -1,
      optionsSuccessStatus: 0,
    });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert — V1 fires first
    expect(result).toBeDefined();
    expect(result!.data.reason).toBe(CorsErrorReason.CredentialsWithWildcardOrigin);
  });

  it('should reject V2 before V3 when both maxAge and status fail', () => {
    // Arrange — maxAge:1.5 (V2) + status:0 (V3)
    const resolved = makeResolved({
      maxAge: 1.5,
      optionsSuccessStatus: 0,
    });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert — V2 fires first
    expect(result).toBeDefined();
    expect(result!.data.reason).toBe(CorsErrorReason.InvalidMaxAge);
  });
});
