/**
 * Shared test helpers. Three primitives, no convenience wrappers:
 *
 *   - `catchRouterError(fn)` — unwrap a thrown RouterError so tests can
 *     assert on its `.data` discriminant.
 *   - `firstBuildIssue(router)` — trigger build(), narrow the resulting
 *     RouterError to the route-validation kind, and return the first
 *     per-route issue payload.
 *   - `getRegistrationSnapshot(router)` — typed access to the sealed
 *     snapshot through the internal-inspection hatch.
 *
 * Convenience wrappers (expectMatch / buildRouter / etc.) are
 * intentionally absent — `expect(r.match(...)?.value).toBe(...)` and
 * `new Router(); r.add(...); r.build();` read more clearly than a
 * helper indirection at every call site.
 */
import { expect } from 'bun:test';

import type { Router } from '../src/router';
import type { RouterErrorData } from '../src/types';

import { getRouterInternals } from '../internal';
import { RouterError } from '../src/error';

/**
 * Run `fn` and return the `RouterError` it threw. Fails the surrounding
 * test if `fn` does not throw a RouterError.
 */
export function catchRouterError(fn: () => void): RouterError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(RouterError);
    return e as RouterError;
  }
  throw new Error('Expected RouterError to be thrown');
}

/**
 * Trigger `router.build()`, expect a `route-validation` RouterError,
 * and return the first per-route issue's error payload.
 */
export function firstBuildIssue<T>(router: Router<T>): RouterErrorData {
  const err = catchRouterError(() => router.build());
  expect(err.data.kind).toBe('route-validation');
  if (err.data.kind !== 'route-validation') {
    throw err;
  }
  return err.data.errors[0]!.error;
}

/**
 * Reach into the registration's private `snapshot` field for tests that
 * need to inspect the post-seal terminal-slab / handlers / segmentTrees
 * tables. Single boundary cast lives here so no test file sprinkles
 * `as any` accesses across the suite.
 */
export function getRegistrationSnapshot<T>(router: Router<T>): {
  handlers: T[];
  terminalSlab: Int32Array;
  segmentTrees: ReadonlyArray<unknown>;
  staticByMethod: ReadonlyArray<unknown>;
} {
  const internals = getRouterInternals(router);
  const snap = (
    internals.registration as unknown as {
      snapshot: {
        handlers: T[];
        terminalSlab: Int32Array;
        segmentTrees: ReadonlyArray<unknown>;
        staticByMethod: ReadonlyArray<unknown>;
      } | null;
    }
  ).snapshot;
  if (snap === null) {
    throw new Error('Router not built — snapshot unavailable');
  }
  return snap;
}
