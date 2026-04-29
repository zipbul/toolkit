/**
 * Convert a string into a JS source-level string literal safe to embed
 * in emitted code. Equivalent to `JSON.stringify(s)` for the inputs the
 * codegen layer actually passes (always strings — never `undefined`,
 * symbols, or cyclic objects).
 *
 * # Why a named alias instead of inline `JSON.stringify`?
 *
 * Codegen routes *user-supplied* values into emitted source — param
 * names, wildcard names, static prefixes, HTTP method literals. Naming
 * the call site makes the safety contract grep-able: every place that
 * embeds external input in emitted JS reads `escapeJsString(...)`,
 * never raw `JSON.stringify`. A future audit can verify the policy
 * with a single search instead of inspecting each site individually.
 *
 * # Safety contract
 *
 * Callers MUST pass values that the path-parser has already accepted.
 * `validateParamName` (`builder/path-parser.ts`) rejects names
 * containing router metacharacters (`:` `*` `?` `+` `/` `(` `)`);
 * static prefixes derive from already-normalized paths; method
 * literals come from the registered HttpMethod set. Whatever else the
 * input might contain (Unicode, control chars, quotes, backslashes)
 * `JSON.stringify` escapes correctly into a valid JS string literal.
 *
 * # Why not a typed emit IR?
 *
 * F28 (stage F's F4 — typed emit IR) replaces this hand-rolled choke
 * point with a structural guarantee. Until that lands, the named alias
 * is the minimum-noise way to express the policy.
 */
export function escapeJsString(s: string): string {
  return JSON.stringify(s);
}
