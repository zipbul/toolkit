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
    expect(result.maxParams).toBe(DEFAULT_QUERY_PARSER_OPTIONS.maxParams);
    expect(result.nesting).toBe(DEFAULT_QUERY_PARSER_OPTIONS.nesting);
    expect(result.arrayLimit).toBe(DEFAULT_QUERY_PARSER_OPTIONS.arrayLimit);
    expect(result.duplicates).toBe(DEFAULT_QUERY_PARSER_OPTIONS.duplicates);
    expect(result.strict).toBe(DEFAULT_QUERY_PARSER_OPTIONS.strict);
  });

  it('should return provided boolean field with rest defaults when nesting is given', () => {
    // Act
    const result = resolveQueryParserOptions({ nesting: true });

    // Assert
    expect(result.nesting).toBe(true);
    expect(result.depth).toBe(DEFAULT_QUERY_PARSER_OPTIONS.depth);
  });

  it('should return provided string field with rest defaults when duplicates is given', () => {
    // Act
    const result = resolveQueryParserOptions({ duplicates: 'last' });

    // Assert
    expect(result.duplicates).toBe('last');
    expect(result.depth).toBe(DEFAULT_QUERY_PARSER_OPTIONS.depth);
  });

  it('should return all provided values when fully specified', () => {
    // Arrange
    const input = {
      depth: 3,
      maxParams: 50,
      nesting: true,
      arrayLimit: 10,
      duplicates: 'array' as const,
      strict: true,
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

  it('should preserve nesting=false as non-nullish when explicitly set', () => {
    // Act
    const result = resolveQueryParserOptions({ nesting: false });

    // Assert
    expect(result.nesting).toBe(false);
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

  it('should pass when maxParams is 1', () => {
    // Arrange
    const resolved: ResolvedQueryParserOptions = { ...resolveQueryParserOptions(), maxParams: 1 };

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

  it('should pass for all three valid duplicates values', () => {
    const modes = ['first', 'last', 'array'] as const;

    for (const mode of modes) {
      // Arrange
      const resolved: ResolvedQueryParserOptions = { ...resolveQueryParserOptions(), duplicates: mode };

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

  it('should return Err with InvalidParameterLimit when maxParams is less than 1', () => {
    // Arrange
    const resolved: ResolvedQueryParserOptions = { ...resolveQueryParserOptions(), maxParams: 0 };

    // Act
    const result = validateQueryParserOptions(resolved);

    // Assert
    const errResult = assertErr(result);

    expect(errResult.data.reason).toBe(QueryParserErrorReason.InvalidParameterLimit);
  });

  it('should return Err with InvalidParameterLimit when maxParams is non-integer', () => {
    // Arrange
    const resolved: ResolvedQueryParserOptions = { ...resolveQueryParserOptions(), maxParams: 1.5 };

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

  it('should return Err with InvalidHppMode when duplicates is invalid', () => {
    // Arrange
    const resolved = {
      ...resolveQueryParserOptions(),
      duplicates: 'invalid',
    } as unknown as ResolvedQueryParserOptions;

    // Act
    const result = validateQueryParserOptions(resolved);

    // Assert
    const errResult = assertErr(result);

    expect(errResult.data.reason).toBe(QueryParserErrorReason.InvalidHppMode);
  });

  it('should return first failing validation when multiple options are invalid', () => {
    // Arrange — depth (V1) and maxParams (V2) both invalid
    const resolved: ResolvedQueryParserOptions = {
      ...resolveQueryParserOptions(),
      depth: -1,
      maxParams: 0,
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
