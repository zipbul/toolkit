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
    maxParams: options?.maxParams ?? DEFAULT_QUERY_PARSER_OPTIONS.maxParams,
    nesting: options?.nesting ?? DEFAULT_QUERY_PARSER_OPTIONS.nesting,
    arrayLimit: options?.arrayLimit ?? DEFAULT_QUERY_PARSER_OPTIONS.arrayLimit,
    duplicates: options?.duplicates ?? DEFAULT_QUERY_PARSER_OPTIONS.duplicates,
    strict: options?.strict ?? DEFAULT_QUERY_PARSER_OPTIONS.strict,
    urlEncoded: options?.urlEncoded ?? DEFAULT_QUERY_PARSER_OPTIONS.urlEncoded,
  };
}

const VALID_DUPLICATE_MODES: ReadonlySet<string> = new Set(['first', 'last', 'array']);

/**
 * Validates resolved query-parser options.
 *
 * - V1: `depth` must be a non-negative integer.
 * - V2: `maxParams` must be a positive integer (≥ 1).
 * - V3: `arrayLimit` must be a non-negative integer.
 * - V4: `duplicates` must be 'first', 'last', or 'array'.
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

  // V2 — maxParams: positive integer (≥ 1)
  if (!Number.isInteger(resolved.maxParams) || resolved.maxParams < 1) {
    return err<QueryParserErrorData>({
      reason: QueryParserErrorReason.InvalidMaxParams,
      message: 'maxParams must be a positive integer (≥ 1)',
    });
  }

  // V3 — arrayLimit: non-negative integer
  if (!Number.isInteger(resolved.arrayLimit) || resolved.arrayLimit < 0) {
    return err<QueryParserErrorData>({
      reason: QueryParserErrorReason.InvalidArrayLimit,
      message: 'arrayLimit must be a non-negative integer',
    });
  }

  // V4 — duplicates: valid value
  if (!VALID_DUPLICATE_MODES.has(resolved.duplicates)) {
    return err<QueryParserErrorData>({
      reason: QueryParserErrorReason.InvalidDuplicates,
      message: "duplicates must be 'first', 'last', or 'array'",
    });
  }
}
