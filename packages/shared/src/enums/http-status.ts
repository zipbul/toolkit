/**
 * A small set of HTTP status codes used as defaults across `@zipbul` packages.
 *
 * Because this is a `const enum`, every member is inlined at compile time
 * with zero runtime overhead.
 */
export const enum HttpStatus {
  Ok = 200,
  NoContent = 204,
}
