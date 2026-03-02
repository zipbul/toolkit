/**
 * Reason why query-parser options validation failed.
 */
export enum QueryParserErrorReason {
  /** depth must be a non-negative integer. */
  InvalidDepth,
  /** maxParams must be a positive integer. */
  InvalidMaxParams,
  /** arrayLimit must be a non-negative integer. */
  InvalidArrayLimit,
  /** duplicates must be 'first', 'last', or 'array'. */
  InvalidDuplicates,
  /** Query string contains malformed syntax (unbalanced/nested brackets). */
  MalformedQueryString,
  /** Key is used as both a scalar and a nested structure. */
  ConflictingStructure,
}
