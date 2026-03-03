import type { QueryParserErrorReason } from './enums';

/**
 * Error data payload used internally with the Result pattern.
 * @internal
 */
export interface QueryParserErrorData {
  reason: QueryParserErrorReason;
  message: string;
}

/**
 * Thrown by {@link QueryParser.create} on invalid options, or by
 * {@link QueryParser.parse} when strict mode detects malformed input.
 *
 * Inspect {@link reason} to programmatically distinguish error kinds.
 */
export class QueryParserError extends Error {
  public readonly reason: QueryParserErrorReason;

  constructor(data: QueryParserErrorData) {
    super(data.message);
    this.name = 'QueryParserError';
    this.reason = data.reason;
  }
}

export interface QueryParserOptions {
  /**
   * Maximum depth of nested objects to parse.
   * @default 5
   */
  depth?: number;

  /**
   * Maximum number of parameters to parse.
   * @default 1000
   */
  maxParams?: number;

  /**
   * Whether to support nested object and array parsing with brackets (e.g. `a[b]=1`, `a[]=b`).
   * @default false
   */
  nesting?: boolean;

  /**
   * Maximum array index allowed.
   * @default 20
   */
  arrayLimit?: number;

  /**
   * Strategy for handling duplicate keys (HTTP Parameter Pollution).
   * - 'first': Use the first value (Secure).
   * - 'last': Use the last value.
   * - 'array': Convert to array (Use with caution).
   * @default 'first'
   */
  duplicates?: 'first' | 'last' | 'array';

  /**
   * Whether to enable strict mode.
   * If enabled:
   * - Throws QueryParserError on malformed query strings (unbalanced brackets, etc.).
   * - Throws on mixed scalar and nested keys (e.g. `a=1&a[b]=2`).
   * - Throws on mixed array and object indices if not handled by conversion.
   * @default false
   */
  strict?: boolean;

  /**
   * Whether to decode `+` as space (`application/x-www-form-urlencoded`).
   *
   * When `true`, `+` in both keys and values is treated as a space character,
   * matching the behavior of HTML form submissions. When `false` (default),
   * `+` is treated as a literal character per RFC 3986.
   * @default false
   */
  urlEncoded?: boolean;
}
