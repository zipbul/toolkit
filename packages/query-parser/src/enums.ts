/**
 * Reason why query-parser options validation failed.
 */
export enum QueryParserErrorReason {
  /** depth must be a non-negative integer. */
  InvalidDepth,
  /** parameterLimit must be a positive integer. */
  InvalidParameterLimit,
  /** arrayLimit must be a non-negative integer. */
  InvalidArrayLimit,
  /** hppMode must be 'first', 'last', or 'array'. */
  InvalidHppMode,
  /** Query string contains malformed syntax (unbalanced/nested brackets). */
  MalformedQueryString,
  /** Key is used as both a scalar and a nested structure. */
  ConflictingStructure,
}
