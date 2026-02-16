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
  parameterLimit?: number;

  /**
   * Whether to support array parsing with brackets (e.g. `a[]=b`).
   * @default false
   */
  parseArrays?: boolean;

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
  hppMode?: 'first' | 'last' | 'array';

  /**
   * Whether to enable strict mode.
   * If enabled:
   * - Throws BadRequestError on malformed query strings (unbalanced brackets, etc.).
   * - Throws on mixed scalar and nested keys (e.g. `a=1&a[b]=2`).
   * - Throws on mixed array and object indices if not handled by conversion.
   * @default false
   */
  strictMode?: boolean;
}
