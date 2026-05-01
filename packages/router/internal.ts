// ── Internal API (NOT semver-protected) ──
//
// This subpath is intended for regression tests, internal benchmarks,
// and tooling that needs to inspect the compiled walker / match impl /
// registration state. External code MUST NOT depend on these symbols —
// the shape can change in any patch release.

import type { Router, RouterInternals } from './src/router';

import { ROUTER_INTERNALS_KEY } from './src/router';

export type { RouterInternals } from './src/router';

/**
 * Type-safe accessor for a Router's internal regression-guard hatch.
 * Returns the live wrapper — the `matchImpl`/`matchLayer` slots are
 * populated by `router.build()`; calling this before `build()` returns
 * undefined for those slots. The wrapper itself is stable.
 */
export function getRouterInternals<T>(router: Router<T>): RouterInternals<T> {
  const internals = (router as unknown as Record<symbol, RouterInternals<T> | undefined>)[ROUTER_INTERNALS_KEY];
  if (internals === undefined) {
    throw new Error('Router internals slot missing — instance was not constructed by @zipbul/router');
  }
  return internals;
}
