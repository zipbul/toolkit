/**
 * Convert a string into a JS source-level string literal safe to embed
 * in emitted code. Equivalent to `JSON.stringify(s)` for inputs that are
 * guaranteed strings (no `undefined`, no symbols, no cycles).
 *
 * # Why a named alias instead of inline `JSON.stringify`?
 *
 * The codegen layer routes *user-supplied* values into emitted source
 * — param names, wildcard names, static prefixes — via this helper.
 * Naming the call site makes the safety contract explicit at every
 * usage instead of leaving it tacit:
 *
 * # Safety contract
 *
 * Caller MUST guarantee the input is a value the path-parser already
 * accepted. The parser's `validateParamName`
 * (`builder/path-parser.ts`) rejects any name containing router
 * metacharacters (`:` `*` `?` `+` `/` `(` `)`); static prefixes are
 * derived from already-normalized paths. Anything that reaches this
 * helper is therefore inert to JS lexer escapes that
 * `JSON.stringify` would mis-handle (it never receives ` `,
 * ` ` directly, but those are valid in a JS string anyway —
 * `JSON.stringify` correctly emits them as escape sequences).
 *
 * # Why not template-tag or AST?
 *
 * F28 (stage F4 / phase 1.0) introduces a typed emit IR that
 * structurally prevents identifier/escape mistakes. Until then this
 * single named choke-point keeps the policy auditable in one grep.
 */
export function escapeJsString(s: string): string {
  return JSON.stringify(s);
}
