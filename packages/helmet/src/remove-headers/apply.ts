/**
 * Remove the configured information-disclosure headers from a Headers
 * instance, in place. Header names are matched case-insensitively because
 * `Headers.prototype.delete` already normalises to lowercase.
 */
export function applyRemoveHeaders(headers: Headers, names: readonly string[]): void {
  for (const name of names) {
    headers.delete(name);
  }
}
