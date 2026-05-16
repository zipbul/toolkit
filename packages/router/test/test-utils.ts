/**
 * Shared test helpers. Every test file imports from here so the
 * boilerplate (router construction, RouterError catching, validation
 * issue extraction, match assertions) lives in one place.
 *
 * No per-file `function catchRouterError(...) { ... }` redefinitions —
 * this module is the single source.
 */
import { expect } from 'bun:test';

import { Router } from '../src/router';
import { RouterError } from '../src/error';
import type { RouterErrorData, RouterOptions } from '../src/types';

type HttpMethodArg = string | readonly string[];

/** A `[method, path, value]` tuple — the minimal route registration. */
export type RouteSpec<T> = readonly [HttpMethodArg, string, T];

/**
 * Build a router from a flat tuple list. Equivalent to manual
 * `new Router(opts)` + N `add()` calls + `build()` — the form most
 * tests need.
 */
export function buildRouter<T>(
  routes: ReadonlyArray<RouteSpec<T>>,
  opts: RouterOptions = {},
): Router<T> {
  const r = new Router<T>(opts);
  for (const [method, path, value] of routes) {
    r.add(method, path, value);
  }
  r.build();
  return r;
}

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
 * and return the first per-route issue's error payload. Folds the
 * `try { build() } catch { ... narrow to route-validation ... pick [0] }`
 * pattern that many error specs were repeating verbatim.
 */
export function firstBuildIssue<T>(router: Router<T>): RouterErrorData {
  const err = catchRouterError(() => router.build());
  expect(err.data.kind).toBe('route-validation');
  if (err.data.kind !== 'route-validation') throw err;
  return err.data.errors[0]!.error;
}

/**
 * Assert `router.match(method, path)` returns a non-null result whose
 * `.value` equals `expectedValue`. Returns the full MatchOutput so the
 * caller can chain extra assertions on `params` / `meta`.
 */
export function expectMatch<T>(
  router: Router<T>,
  method: string,
  path: string,
  expectedValue: T,
): { value: T; params: Record<string, string | undefined>; meta: { source: 'static' | 'cache' | 'dynamic' } } {
  const out = router.match(method, path);
  expect(out).not.toBeNull();
  expect(out!.value).toBe(expectedValue);
  return out!;
}

/** Assert `router.match(method, path)` returns null (no route matched). */
export function expectMiss<T>(router: Router<T>, method: string, path: string): void {
  expect(router.match(method, path)).toBeNull();
}

/**
 * Reach into the registration's private `snapshot` field for tests that
 * need to inspect the post-seal terminal-slab / handlers / segmentTrees
 * tables. Centralizes the boundary cast so test files do not sprinkle
 * `as any` accesses across the suite.
 */
export function getRegistrationSnapshot<T>(router: Router<T>): {
  handlers: T[];
  terminalSlab: Int32Array;
  segmentTrees: ReadonlyArray<unknown>;
  staticByMethod: ReadonlyArray<unknown>;
} {
  const internals = getRouterInternalsLocal(router);
  const snap = (internals.registration as unknown as { snapshot: {
    handlers: T[];
    terminalSlab: Int32Array;
    segmentTrees: ReadonlyArray<unknown>;
    staticByMethod: ReadonlyArray<unknown>;
  } | null }).snapshot;
  if (snap === null) throw new Error('Router not built — snapshot unavailable');
  return snap;
}

// Local typed import to avoid a circular type dependency between this
// helper and `internal.ts`.
import { getRouterInternals as getRouterInternalsLocal } from '../internal';

/** Assert that calling `fn` throws a `RouterError` with the given `kind`. */
export function expectRouterErrorKind(
  fn: () => void,
  kind: RouterErrorData['kind'],
): RouterError {
  const err = catchRouterError(fn);
  expect(err.data.kind).toBe(kind);
  return err;
}

/**
 * Trigger `router.build()`, expect it to throw, and assert the first
 * per-route validation issue carries the given error kind. Most
 * error tests want this single assertion.
 */
export function expectFirstBuildIssueKind<T>(
  router: Router<T>,
  kind: RouterErrorData['kind'],
): RouterErrorData {
  const issue = firstBuildIssue(router);
  expect(issue.kind).toBe(kind);
  return issue;
}
