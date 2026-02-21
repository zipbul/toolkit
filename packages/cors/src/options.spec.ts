import { describe, expect, it } from 'bun:test';

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
    const methods = ['GET', 'POST'];
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
      optionsSuccessStatus: 200,
    });
    // Assert
    expect(result.origin).toBe(originFn);
    expect(result.methods).toEqual(methods);
    expect(result.allowedHeaders).toEqual(allowedHeaders);
    expect(result.exposedHeaders).toEqual(exposedHeaders);
    expect(result.credentials).toBe(true);
    expect(result.maxAge).toBe(3600);
    expect(result.preflightContinue).toBe(true);
    expect(result.optionsSuccessStatus).toBe(200);
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

  it('should uppercase all method strings except wildcard when methods has lowercase entries', () => {
    // Arrange / Act
    const result = resolveCorsOptions({ methods: ['get', 'post', 'delete'] });
    // Assert
    expect(result.methods).toEqual(['GET', 'POST', 'DELETE']);
  });

  it('should preserve already-uppercase methods unchanged when methods has uppercase entries', () => {
    // Arrange / Act
    const result = resolveCorsOptions({ methods: ['GET', 'POST'] });
    // Assert
    expect(result.methods).toEqual(['GET', 'POST']);
  });

  it('should preserve wildcard * without uppercasing when methods contains wildcard', () => {
    // Arrange / Act
    const result = resolveCorsOptions({ methods: ['*'] });
    // Assert
    expect(result.methods).toEqual(['*']);
  });

  it('should uppercase all entries when methods has mixed-case strings', () => {
    // Arrange / Act
    const result = resolveCorsOptions({ methods: ['Get', 'pOST', 'DELETE'] });
    // Assert
    expect(result.methods).toEqual(['GET', 'POST', 'DELETE']);
  });

  it('should return empty array when methods is empty array', () => {
    // Arrange / Act
    const result = resolveCorsOptions({ methods: [] });
    // Assert
    expect(result.methods).toEqual([]);
  });

  it('should collapse to wildcard-only array when methods contains * mixed with other methods', () => {
    // Arrange / Act
    const result = resolveCorsOptions({ methods: ['get', '*', 'post'] });
    // Assert
    expect(result.methods).toEqual(['*']);
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

  // ── origin 신규 검증 ──

  it('should pass when origin is wildcard *', () => {
    // Arrange
    const resolved = makeResolved({ origin: '*' });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when origin is a valid concrete string', () => {
    // Arrange
    const resolved = makeResolved({ origin: 'https://a.com' });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when origin is true', () => {
    // Arrange
    const resolved = makeResolved({ origin: true });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when origin is false', () => {
    // Arrange
    const resolved = makeResolved({ origin: false });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when origin is an array of strings and RegExps', () => {
    // Arrange
    const resolved = makeResolved({ origin: ['https://a.com', /^https:\/\/b\.com$/] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should return CorsError when origin is an empty string', () => {
    // Arrange
    const resolved = makeResolved({ origin: '' });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeDefined();
    expect(result!.data.reason).toBe(CorsErrorReason.InvalidOrigin);
  });

  it('should return CorsError when origin is a blank string with spaces', () => {
    // Arrange
    const resolved = makeResolved({ origin: '  ' });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeDefined();
    expect(result!.data.reason).toBe(CorsErrorReason.InvalidOrigin);
  });

  it('should return CorsError when origin is a single space', () => {
    // Arrange
    const resolved = makeResolved({ origin: ' ' });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeDefined();
    expect(result!.data.reason).toBe(CorsErrorReason.InvalidOrigin);
  });

  it('should return CorsError when origin is an empty array', () => {
    // Arrange
    const resolved = makeResolved({ origin: [] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeDefined();
    expect(result!.data.reason).toBe(CorsErrorReason.InvalidOrigin);
  });

  it('should return CorsError when origin array contains an empty string', () => {
    // Arrange
    const resolved = makeResolved({ origin: [''] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeDefined();
    expect(result!.data.reason).toBe(CorsErrorReason.InvalidOrigin);
  });

  it('should return CorsError when origin array contains a blank string', () => {
    // Arrange
    const resolved = makeResolved({ origin: ['  '] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeDefined();
    expect(result!.data.reason).toBe(CorsErrorReason.InvalidOrigin);
  });

  it('should return CorsError when origin array contains a single space', () => {
    // Arrange
    const resolved = makeResolved({ origin: [' '] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeDefined();
    expect(result!.data.reason).toBe(CorsErrorReason.InvalidOrigin);
  });

  it('should return CorsError when origin array mixes valid and empty string entries', () => {
    // Arrange
    const resolved = makeResolved({ origin: ['https://a.com', ''] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeDefined();
    expect(result!.data.reason).toBe(CorsErrorReason.InvalidOrigin);
  });

  it('should fire InvalidOrigin before CredentialsWithWildcardOrigin when origin is empty string and credentials is true', () => {
    // Arrange
    const resolved = makeResolved({ origin: '', credentials: true });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert — InvalidOrigin fires before V1
    expect(result).toBeDefined();
    expect(result!.data.reason).toBe(CorsErrorReason.InvalidOrigin);
  });

  // ── methods 신규 검증 ──

  it('should pass when methods contains default values', () => {
    // Arrange
    const resolved = makeResolved({ methods: CORS_DEFAULT_METHODS });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when methods is wildcard array', () => {
    // Arrange
    const resolved = makeResolved({ methods: ['*'] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when methods contains a custom method token', () => {
    // Arrange
    const resolved = makeResolved({ methods: ['GET', 'PROPFIND'] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should return CorsError when methods is an empty array', () => {
    // Arrange
    const resolved = makeResolved({ methods: [] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeDefined();
    expect(result!.data.reason).toBe(CorsErrorReason.InvalidMethods);
  });

  it('should return CorsError when methods contains an empty string', () => {
    // Arrange
    const resolved = makeResolved({ methods: [''] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeDefined();
    expect(result!.data.reason).toBe(CorsErrorReason.InvalidMethods);
  });

  it('should return CorsError when methods contains a blank string', () => {
    // Arrange
    const resolved = makeResolved({ methods: ['  '] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeDefined();
    expect(result!.data.reason).toBe(CorsErrorReason.InvalidMethods);
  });

  it('should return CorsError when methods mixes valid and empty string entries', () => {
    // Arrange
    const resolved = makeResolved({ methods: ['GET', ''] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeDefined();
    expect(result!.data.reason).toBe(CorsErrorReason.InvalidMethods);
  });

  // ── allowedHeaders 신규 검증 ──

  it('should pass when allowedHeaders is null', () => {
    // Arrange
    const resolved = makeResolved({ allowedHeaders: null });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when allowedHeaders is an empty array', () => {
    // Arrange
    const resolved = makeResolved({ allowedHeaders: [] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when allowedHeaders contains valid header names', () => {
    // Arrange
    const resolved = makeResolved({ allowedHeaders: ['X-Custom', 'Authorization'] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should return CorsError when allowedHeaders contains an empty string', () => {
    // Arrange
    const resolved = makeResolved({ allowedHeaders: [''] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeDefined();
    expect(result!.data.reason).toBe(CorsErrorReason.InvalidAllowedHeaders);
  });

  it('should return CorsError when allowedHeaders contains a blank string', () => {
    // Arrange
    const resolved = makeResolved({ allowedHeaders: ['  '] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeDefined();
    expect(result!.data.reason).toBe(CorsErrorReason.InvalidAllowedHeaders);
  });

  it('should return CorsError when allowedHeaders mixes valid and empty string entries', () => {
    // Arrange
    const resolved = makeResolved({ allowedHeaders: ['X-Custom', ''] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeDefined();
    expect(result!.data.reason).toBe(CorsErrorReason.InvalidAllowedHeaders);
  });

  // ── exposedHeaders 신규 검증 ──

  it('should pass when exposedHeaders is null', () => {
    // Arrange
    const resolved = makeResolved({ exposedHeaders: null });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when exposedHeaders is an empty array', () => {
    // Arrange
    const resolved = makeResolved({ exposedHeaders: [] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when exposedHeaders contains valid header names', () => {
    // Arrange
    const resolved = makeResolved({ exposedHeaders: ['X-Request-Id'] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should return CorsError when exposedHeaders contains an empty string', () => {
    // Arrange
    const resolved = makeResolved({ exposedHeaders: [''] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeDefined();
    expect(result!.data.reason).toBe(CorsErrorReason.InvalidExposedHeaders);
  });

  it('should return CorsError when exposedHeaders contains a blank string', () => {
    // Arrange
    const resolved = makeResolved({ exposedHeaders: ['  '] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeDefined();
    expect(result!.data.reason).toBe(CorsErrorReason.InvalidExposedHeaders);
  });

  it('should return CorsError when exposedHeaders mixes valid and empty string entries', () => {
    // Arrange
    const resolved = makeResolved({ exposedHeaders: ['X-Custom', ''] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeDefined();
    expect(result!.data.reason).toBe(CorsErrorReason.InvalidExposedHeaders);
  });

  // ── optionsSuccessStatus 강화 검증 ──

  it('should return CorsError when optionsSuccessStatus is NaN', () => {
    // Arrange
    const resolved = makeResolved({ optionsSuccessStatus: NaN });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeDefined();
    expect(result!.data.reason).toBe(CorsErrorReason.InvalidStatusCode);
  });

  it('should return CorsError when optionsSuccessStatus is a decimal number', () => {
    // Arrange
    const resolved = makeResolved({ optionsSuccessStatus: 200.5 });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeDefined();
    expect(result!.data.reason).toBe(CorsErrorReason.InvalidStatusCode);
  });

  // ── V_regex — single RegExp origin ──

  it('should pass when origin is a safe RegExp with anchors', () => {
    // Arrange
    const resolved = makeResolved({ origin: /^https:\/\/example\.com$/ });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when origin is a safe RegExp with i flag', () => {
    // Arrange
    const resolved = makeResolved({ origin: /^https:\/\/example\.com$/i });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when origin is a trivially safe RegExp', () => {
    // Arrange
    const resolved = makeResolved({ origin: /a/ });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when origin is a safe RegExp with star height 1', () => {
    // Arrange
    const resolved = makeResolved({ origin: /^[a-z]+$/ });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when origin is a safe greedy-any RegExp', () => {
    // Arrange
    const resolved = makeResolved({ origin: /.*/ });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when origin is a safe empty-group RegExp', () => {
    // Arrange
    const resolved = makeResolved({ origin: /(?:)/ });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when origin is a string (V_regex skipped)', () => {
    // Arrange
    const resolved = makeResolved({ origin: 'https://a.com' });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should return CorsError when origin is an unsafe RegExp (nested quantifier)', () => {
    // Arrange
    const resolved = makeResolved({ origin: /(a+)+$/ });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeDefined();
    expect(result!.data.reason).toBe(CorsErrorReason.UnsafeRegExp);
    expect(typeof result!.data.message).toBe('string');
  });

  it('should return CorsError when origin is an unsafe RegExp (nested star)', () => {
    // Arrange
    const resolved = makeResolved({ origin: /(a*)*$/ });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeDefined();
    expect(result!.data.reason).toBe(CorsErrorReason.UnsafeRegExp);
  });

  it('should return CorsError when origin RegExp has star height ≥ 2', () => {
    // Arrange
    const resolved = makeResolved({ origin: /(a+)+/ });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeDefined();
    expect(result!.data.reason).toBe(CorsErrorReason.UnsafeRegExp);
  });

  // ── V_regex — array containing RegExp ──

  it('should pass when origin array contains only safe RegExps', () => {
    // Arrange
    const resolved = makeResolved({ origin: [/^https:\/\/a\.com$/] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when origin array mixes string and safe RegExp', () => {
    // Arrange
    const resolved = makeResolved({ origin: ['https://a.com', /^https:\/\/b\.com$/] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should return CorsError when origin array contains an unsafe RegExp', () => {
    // Arrange
    const resolved = makeResolved({ origin: [/(a+)+$/] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeDefined();
    expect(result!.data.reason).toBe(CorsErrorReason.UnsafeRegExp);
  });

  it('should return CorsError when origin array mixes safe string and unsafe RegExp', () => {
    // Arrange
    const resolved = makeResolved({ origin: ['https://ok.com', /(a+)+$/] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeDefined();
    expect(result!.data.reason).toBe(CorsErrorReason.UnsafeRegExp);
  });

  it('should return CorsError when origin array mixes safe RegExp and unsafe RegExp', () => {
    // Arrange
    const resolved = makeResolved({ origin: [/^a$/, /(a+)+$/] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeDefined();
    expect(result!.data.reason).toBe(CorsErrorReason.UnsafeRegExp);
  });

  // ── V_regex — validation order ──

  it('should fire UnsafeRegExp before V1/V2/V3 when origin is unsafe RegExp with other invalid options', () => {
    // Arrange — unsafe origin + invalid maxAge + invalid status
    const resolved = makeResolved({ origin: /(a+)+$/, maxAge: -1, optionsSuccessStatus: 0 });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert — V_regex fires first
    expect(result).toBeDefined();
    expect(result!.data.reason).toBe(CorsErrorReason.UnsafeRegExp);
  });

  it('should fire InvalidOrigin before UnsafeRegExp when array has blank string and unsafe RegExp', () => {
    // Arrange — blank string triggers V0b before V_regex
    const resolved = makeResolved({ origin: ['', /(a+)+$/] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert — V0b (blank) fires first
    expect(result).toBeDefined();
    expect(result!.data.reason).toBe(CorsErrorReason.InvalidOrigin);
  });

  it('should pass both V_regex and V1 when origin is safe RegExp with credentials:true', () => {
    // Arrange — RegExp origin is not '*', so V1 does not fire
    const resolved = makeResolved({ origin: /^a$/, credentials: true });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert
    expect(result).toBeUndefined();
  });

  it('should fire UnsafeRegExp before V0c when origin array has unsafe RegExp and methods is invalid', () => {
    // Arrange
    const resolved = makeResolved({ origin: [/(a+)+$/], methods: [] });
    // Act
    const result = validateCorsOptions(resolved);
    // Assert — V_regex fires inside V0b before V0c
    expect(result).toBeDefined();
    expect(result!.data.reason).toBe(CorsErrorReason.UnsafeRegExp);
  });

  // ── V_regex — idempotency ──

  it('should return the same UnsafeRegExp error on repeated calls with the same unsafe RegExp', () => {
    // Arrange
    const resolved = makeResolved({ origin: /(a+)+$/ });
    // Act
    const r1 = validateCorsOptions(resolved);
    const r2 = validateCorsOptions(resolved);
    // Assert
    expect(r1).toBeDefined();
    expect(r2).toBeDefined();
    expect(r1!.data.reason).toBe(CorsErrorReason.UnsafeRegExp);
    expect(r2!.data.reason).toBe(CorsErrorReason.UnsafeRegExp);
  });
});
