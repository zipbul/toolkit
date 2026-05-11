import { MUST_STRIP_HEADERS, OWASP_REMOVE_HEADERS } from '../constants';
import type { RemoveHeadersOptions } from '../interfaces';
import type { ResolvedRemoveHeadersOptions } from '../types';

/**
 * Resolve the `removeHeaders` option into a frozen lowercase list.
 *
 * - `true` (or omitted): OWASP must-strip 4 headers
 * - `false`: empty list (no removal)
 * - `'owasp'`: full OWASP `headers_remove.json`
 * - object: explicit `headers` (replaces default) and/or `additional` (merges)
 */
export function resolveRemoveHeaders(
  input: boolean | 'owasp' | RemoveHeadersOptions | undefined,
): ResolvedRemoveHeadersOptions {
  if (input === false) return Object.freeze({ headers: Object.freeze([]) });
  if (input === undefined || input === true) {
    return Object.freeze({ headers: Object.freeze(MUST_STRIP_HEADERS.slice()) });
  }
  if (input === 'owasp') {
    return Object.freeze({ headers: Object.freeze(OWASP_REMOVE_HEADERS.slice()) });
  }

  const set = new Set<string>();
  const base =
    input.headers !== undefined ? input.headers.map(toLower) : MUST_STRIP_HEADERS.slice();
  for (const h of base) set.add(h);
  if (input.additional !== undefined) {
    for (const h of input.additional) set.add(toLower(h));
  }
  return Object.freeze({ headers: Object.freeze([...set]) });
}

function toLower(value: string): string {
  return value.toLowerCase();
}
