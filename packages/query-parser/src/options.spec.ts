/* oxlint-disable typescript-eslint/no-unsafe-type-assertion */

import { describe, expect, it } from 'bun:test';
import { isErr } from '@zipbul/result';
import type { Err } from '@zipbul/result';

import { DEFAULT_QUERY_PARSER_OPTIONS } from './constants';
import { QueryParserErrorReason } from './enums';
import type { QueryParserErrorData } from './interfaces';
import { resolveQueryParserOptions, validateQueryParserOptions } from './options';
import type { ResolvedQueryParserOptions } from './types';

const assertErr = (result: unknown): Err<QueryParserErrorData> => {
  expect(isErr(result)).toBe(true);

  return result as Err<QueryParserErrorData>;
};

// ---------------------------------------------------------------------------
// resolveQueryParserOptions
// ---------------------------------------------------------------------------
describe('resolveQueryParserOptions', () => {
  it('should return all defaults when called without arguments', () => {
    // Act
    const result = resolveQueryParserOptions();

    // Assert
    expect(result).toEqual(DEFAULT_QUERY_PARSER_OPTIONS);
  });

  it('should return provided number field with rest defaults when depth is given', () => {
    // Act
    const result = resolveQueryParserOptions({ depth: 10 });

    // Assert
    expect(result.depth).toBe(10);
    expect(result.parameterLimit).toBe(DEFAULT_QUERY_PARSER_OPTIONS.parameterLimit);
    expect(result.parseArrays).toBe(DEFAULT_QUERY_PARSER_OPTIONS.parseArrays);
    expect(result.arrayLimit).toBe(DEFAULT_QUERY_PARSER_OPTIONS.arrayLimit);
    expect(result.hppMode).toBe(DEFAULT_QUERY_PARSER_OPTIONS.hppMode);
    expect(result.strictMode).toBe(DEFAULT_QUERY_PARSER_OPTIONS.strictMode);
  });

  it('should return provided boolean field with rest defaults when parseArrays is given', () => {
    // Act
    const result = resolveQueryParserOptions({ parseArrays: true });

    // Assert
    expect(result.parseArrays).toBe(true);
    expect(result.depth).toBe(DEFAULT_QUERY_PARSER_OPTIONS.depth);
  });

  it('should return provided string field with rest defaults when hppMode is given', () => {
    // Act
    const result = resolveQueryParserOptions({ hppMode: 'last' });

    // Assert
    expect(result.hppMode).toBe('last');
    expect(result.depth).toBe(DEFAULT_QUERY_PARSER_OPTIONS.depth);
  });

  it('should return all provided values when fully specified', () => {
    // Arrange
    const input = {
      depth: 3,
      parameterLimit: 50,
      parseArrays: true,
      arrayLimit: 10,
      hppMode: 'array' as const,
      strictMode: true,
    };

    // Act
    const result = resolveQueryParserOptions(input);

    // Assert
    expect(result).toEqual(input);
  });

  it('should preserve depth=0 as non-nullish when explicitly set', () => {
    // Act
    const result = resolveQueryParserOptions({ depth: 0 });

    // Assert
    expect(result.depth).toBe(0);
  });

  it('should preserve parseArrays=false as non-nullish when explicitly set', () => {
    // Act
    const result = resolveQueryParserOptions({ parseArrays: false });

    // Assert
    expect(result.parseArrays).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateQueryParserOptions
// ---------------------------------------------------------------------------
describe('validateQueryParserOptions', () => {
  it('should return void when all options are valid defaults', () => {
    // Arrange
    const resolved = resolveQueryParserOptions();

    // Act
    const result = validateQueryParserOptions(resolved);

    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when depth is 0', () => {
    // Arrange
    const resolved: ResolvedQueryParserOptions = { ...resolveQueryParserOptions(), depth: 0 };

    // Act
    const result = validateQueryParserOptions(resolved);

    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when parameterLimit is 1', () => {
    // Arrange
    const resolved: ResolvedQueryParserOptions = { ...resolveQueryParserOptions(), parameterLimit: 1 };

    // Act
    const result = validateQueryParserOptions(resolved);

    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass when arrayLimit is 0', () => {
    // Arrange
    const resolved: ResolvedQueryParserOptions = { ...resolveQueryParserOptions(), arrayLimit: 0 };

    // Act
    const result = validateQueryParserOptions(resolved);

    // Assert
    expect(result).toBeUndefined();
  });

  it('should pass for all three valid hppMode values', () => {
    const modes = ['first', 'last', 'array'] as const;

    for (const mode of modes) {
      // Arrange
      const resolved: ResolvedQueryParserOptions = { ...resolveQueryParserOptions(), hppMode: mode };

      // Act
      const result = validateQueryParserOptions(resolved);

      // Assert
      expect(result).toBeUndefined();
    }
  });

  it('should return Err with InvalidDepth when depth is negative', () => {
    // Arrange
    const resolved: ResolvedQueryParserOptions = { ...resolveQueryParserOptions(), depth: -1 };

    // Act
    const result = validateQueryParserOptions(resolved);

    // Assert
    const errResult = assertErr(result);

    expect(errResult.data.reason).toBe(QueryParserErrorReason.InvalidDepth);
  });

  it('should return Err with InvalidDepth when depth is non-integer', () => {
    // Arrange
    const resolved: ResolvedQueryParserOptions = { ...resolveQueryParserOptions(), depth: 1.5 };

    // Act
    const result = validateQueryParserOptions(resolved);

    // Assert
    const errResult = assertErr(result);

    expect(errResult.data.reason).toBe(QueryParserErrorReason.InvalidDepth);
  });

  it('should return Err with InvalidParameterLimit when parameterLimit is less than 1', () => {
    // Arrange
    const resolved: ResolvedQueryParserOptions = { ...resolveQueryParserOptions(), parameterLimit: 0 };

    // Act
    const result = validateQueryParserOptions(resolved);

    // Assert
    const errResult = assertErr(result);

    expect(errResult.data.reason).toBe(QueryParserErrorReason.InvalidParameterLimit);
  });

  it('should return Err with InvalidParameterLimit when parameterLimit is non-integer', () => {
    // Arrange
    const resolved: ResolvedQueryParserOptions = { ...resolveQueryParserOptions(), parameterLimit: 1.5 };

    // Act
    const result = validateQueryParserOptions(resolved);

    // Assert
    const errResult = assertErr(result);

    expect(errResult.data.reason).toBe(QueryParserErrorReason.InvalidParameterLimit);
  });

  it('should return Err with InvalidArrayLimit when arrayLimit is negative', () => {
    // Arrange
    const resolved: ResolvedQueryParserOptions = { ...resolveQueryParserOptions(), arrayLimit: -1 };

    // Act
    const result = validateQueryParserOptions(resolved);

    // Assert
    const errResult = assertErr(result);

    expect(errResult.data.reason).toBe(QueryParserErrorReason.InvalidArrayLimit);
  });

  it('should return Err with InvalidArrayLimit when arrayLimit is non-integer', () => {
    // Arrange
    const resolved: ResolvedQueryParserOptions = { ...resolveQueryParserOptions(), arrayLimit: 0.5 };

    // Act
    const result = validateQueryParserOptions(resolved);

    // Assert
    const errResult = assertErr(result);

    expect(errResult.data.reason).toBe(QueryParserErrorReason.InvalidArrayLimit);
  });

  it('should return Err with InvalidHppMode when hppMode is invalid', () => {
    // Arrange
    const resolved = {
      ...resolveQueryParserOptions(),
      hppMode: 'invalid',
    } as unknown as ResolvedQueryParserOptions;

    // Act
    const result = validateQueryParserOptions(resolved);

    // Assert
    const errResult = assertErr(result);

    expect(errResult.data.reason).toBe(QueryParserErrorReason.InvalidHppMode);
  });

  it('should return first failing validation when multiple options are invalid', () => {
    // Arrange — depth (V1) and parameterLimit (V2) both invalid
    const resolved: ResolvedQueryParserOptions = {
      ...resolveQueryParserOptions(),
      depth: -1,
      parameterLimit: 0,
    };

    // Act
    const result = validateQueryParserOptions(resolved);

    // Assert — V1 (depth) is checked first
    const errResult = assertErr(result);

    expect(errResult.data.reason).toBe(QueryParserErrorReason.InvalidDepth);
  });

  it('should produce identical output when called twice with same input', () => {
    // Arrange
    const resolved = resolveQueryParserOptions({ depth: 3 });

    // Act
    const result1 = validateQueryParserOptions(resolved);
    const result2 = validateQueryParserOptions(resolved);

    // Assert
    expect(result1).toBeUndefined();
    expect(result2).toBeUndefined();
  });
});
