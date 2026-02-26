/**
 * A union type representing an HTTP method token.
 *
 * The seven standard methods are provided as string literals for IDE
 * autocompletion. The `(string & {})` tail keeps the union open so any
 * valid RFC 9110 §5.6.2 token (e.g. `'PROPFIND'` for WebDAV) is also
 * accepted without losing autocomplete on the standard members.
 *
 * @example
 * ```ts
 * const method: HttpMethod = 'GET';       // standard — autocompleted
 * const custom: HttpMethod = 'PROPFIND';  // custom token — still valid
 * ```
 */
export type HttpMethod =
  | 'GET'
  | 'HEAD'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'OPTIONS'
  | (string & {});
