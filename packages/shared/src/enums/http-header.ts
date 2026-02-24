/**
 * Common HTTP header names used internally by `@zipbul/cors`.
 *
 * All values follow lowercase HTTP/2 canonical header casing.
 * Because this is a `const enum`, every member is inlined at compile time
 * with zero runtime overhead.
 */
export const enum HttpHeader {
  Origin = 'origin',
  Vary = 'vary',
  AccessControlAllowOrigin = 'access-control-allow-origin',
  AccessControlAllowMethods = 'access-control-allow-methods',
  AccessControlAllowHeaders = 'access-control-allow-headers',
  AccessControlAllowCredentials = 'access-control-allow-credentials',
  AccessControlExposeHeaders = 'access-control-expose-headers',
  AccessControlMaxAge = 'access-control-max-age',
  AccessControlRequestMethod = 'access-control-request-method',
  AccessControlRequestHeaders = 'access-control-request-headers',
}
