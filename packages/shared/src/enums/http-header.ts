/**
 * Common HTTP header names used internally by `@zipbul` packages.
 *
 * All values follow lowercase HTTP/2 canonical header casing.
 */
export enum HttpHeader {
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
  ContentType = 'content-type',
  ContentDisposition = 'content-disposition',
}
