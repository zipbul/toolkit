import type { RouteParams } from '../types';
import { NullProtoObj } from '../internal';

/**
 * Super-factory cache: one compiled `(presentBitmask, u, v) => RouteParams`
 * function per route shape, NOT per expansion variant. The bitmask gates
 * per-name assignment at match time; absent names are either dropped
 * (omitBehavior=true) or written as `undefined` (omitBehavior=false).
 *
 * For a route with N optional segments, the previous design generated
 * up to 2^N distinct closures (one per `present` permutation). The
 * super-factory collapses that to O(1) per shape — N=20 went from
 * ~1M unique functions to 1 (RSS −33% measured).
 */
export type SuperFactoryFn = (
  presentBitmask: number,
  u: string,
  v: Int32Array,
) => RouteParams;

export type FactoryCache = Map<string, SuperFactoryFn>;

export function createFactoryCache(): FactoryCache {
  return new Map();
}

/**
 * Build (or return cached) the super-factory for a route shape.
 *
 * cacheKey is variant-independent: only the `originalNames` /
 * `originalTypes` shape matters. All 2^N expansion variants of one
 * optional-heavy route share the same compiled function and select
 * which fields to assign through `presentBitmask`.
 */
export function getOrCreateSuperFactory(
  cache: FactoryCache,
  originalNames: ReadonlyArray<string>,
  originalTypes: ReadonlyArray<'param' | 'wildcard'>,
  omitBehavior: boolean,
  decoder: (s: string) => string,
): SuperFactoryFn {
  let cacheKey = omitBehavior ? 'O:' : 'S:';
  for (let n = 0; n < originalNames.length; n++) {
    if (n > 0) cacheKey += ',';
    cacheKey += originalNames[n]!;
    cacheKey += originalTypes[n] === 'wildcard' ? '#w' : '#p';
  }
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  // Super-factory body: walks originalNames in order, gates each
  // assignment on the corresponding bit in `m` (presentBitmask).
  // `s` is a sliding paramOffsets cursor — only the present slots
  // were filled by the walker, so absent ones must be skipped.
  let body = 'var p = new NullProtoObj();\nvar s = 0;\n';
  for (let n = 0; n < originalNames.length; n++) {
    const name = originalNames[n]!;
    const isWild = originalTypes[n] === 'wildcard';
    const val = `u.substring(v[s*2], v[s*2+1])`;
    const assign = isWild ? val : `decoder(${val})`;
    body += `if (m & ${1 << n}) { p[${JSON.stringify(name)}] = ${assign}; s++; }`;
    if (!omitBehavior) {
      body += ` else { p[${JSON.stringify(name)}] = undefined; }`;
    }
    body += '\n';
  }
  body += 'return p;';
  const fresh = new Function('decoder', 'NullProtoObj', 'm', 'u', 'v', body)
    .bind(null, decoder, NullProtoObj) as SuperFactoryFn;
  cache.set(cacheKey, fresh);
  return fresh;
}

/**
 * Compute the present-bitmask for an expansion variant.
 * Bit `i` is set iff `originalNames[i]` is captured in this variant.
 *
 * Caller bears the 31-bit ceiling: routes with more than 31 captures
 * must be rejected upstream so `1 << origIdx` never wraps.
 */
export function computePresentBitmask(
  originalNames: ReadonlyArray<string>,
  present: ReadonlyArray<{ name: string }>,
): number {
  let mask = 0;
  for (let origIdx = 0; origIdx < originalNames.length; origIdx++) {
    const origName = originalNames[origIdx]!;
    for (let p = 0; p < present.length; p++) {
      if (present[p]!.name === origName) {
        mask |= (1 << origIdx);
        break;
      }
    }
  }
  return mask;
}
