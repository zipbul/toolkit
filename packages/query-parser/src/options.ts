import { err } from '@zipbul/result';
import type { Result } from '@zipbul/result';

import { DEFAULT_QUERY_PARSER_OPTIONS } from './constants';
import { QueryParserErrorReason } from './enums';
import type { QueryParserErrorData, QueryParserOptions } from './interfaces';
import type { ResolvedQueryParserOptions } from './types';

/**
 * Resolves partial {@link QueryParserOptions} into a fully populated
 * {@link ResolvedQueryParserOptions} by applying defaults via nullish coalescing.
 */
export function resolveQueryParserOptions(options?: QueryParserOptions): ResolvedQueryParserOptions {
  return {
    depth: options?.depth ?? DEFAULT_QUERY_PARSER_OPTIONS.depth,
    parameterLimit: options?.parameterLimit ?? DEFAULT_QUERY_PARSER_OPTIONS.parameterLimit,
    parseArrays: options?.parseArrays ?? DEFAULT_QUERY_PARSER_OPTIONS.parseArrays,
    arrayLimit: options?.arrayLimit ?? DEFAULT_QUERY_PARSER_OPTIONS.arrayLimit,
    hppMode: options?.hppMode ?? DEFAULT_QUERY_PARSER_OPTIONS.hppMode,
    strictMode: options?.strictMode ?? DEFAULT_QUERY_PARSER_OPTIONS.strictMode,
  };
}

const VALID_HPP_MODES: ReadonlySet<string> = new Set(['first', 'last', 'array']);

/**
 * Validates resolved query-parser options.
 *
 * - V1: `depth` must be a non-negative integer.
 * - V2: `parameterLimit` must be a positive integer (≥ 1).
 * - V3: `arrayLimit` must be a non-negative integer.
 * - V4: `hppMode` must be 'first', 'last', or 'array'.
 *
 * @returns `undefined` (void) if valid, or `Err<QueryParserErrorData>` on the first violated rule.
 */
export function validateQueryParserOptions(resolved: ResolvedQueryParserOptions): Result<void, QueryParserErrorData> {
  // V1 — depth: non-negative integer
  if (!Number.isInteger(resolved.depth) || resolved.depth < 0) {
    return err<QueryParserErrorData>({
      reason: QueryParserErrorReason.InvalidDepth,
      message: 'depth must be a non-negative integer',
    });
  }

  // V2 — parameterLimit: positive integer (≥ 1)
  if (!Number.isInteger(resolved.parameterLimit) || resolved.parameterLimit < 1) {
    return err<QueryParserErrorData>({
      reason: QueryParserErrorReason.InvalidParameterLimit,
      message: 'parameterLimit must be a positive integer (≥ 1)',
    });
  }

  // V3 — arrayLimit: non-negative integer
  if (!Number.isInteger(resolved.arrayLimit) || resolved.arrayLimit < 0) {
    return err<QueryParserErrorData>({
      reason: QueryParserErrorReason.InvalidArrayLimit,
      message: 'arrayLimit must be a non-negative integer',
    });
  }

  // V4 — hppMode: valid value
  if (!VALID_HPP_MODES.has(resolved.hppMode)) {
    return err<QueryParserErrorData>({
      reason: QueryParserErrorReason.InvalidHppMode,
      message: "hppMode must be 'first', 'last', or 'array'",
    });
  }
}
