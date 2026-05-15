import { optimizeNextInvocation } from 'bun:jsc';

import type { MatchOutput, RouterOptions, RouterPublicApi } from './types';
import { RouterCache } from './cache';
import { RouterError } from './error';
import { MethodRegistry } from './method-registry';
import { OptionalParamDefaults, PathParser } from './builder';
import {
  compileMatchFn,
  type MatchCacheEntry,
  type MatchConfig,
} from './codegen';
import {
  buildFromRegistration,
  MatchLayer,
  Registration,
} from './pipeline';

/**
 * Symbol-keyed slot for the internal-inspection hatch. Symbol identity
 * means external code cannot recreate the key by name, and the slot is
 * non-enumerable. The `@zipbul/router/internal` subpath re-exports this
 * symbol along with `getRouterInternals()` for regression-test access.
 */
export const ROUTER_INTERNALS_KEY: unique symbol = Symbol.for('@zipbul/router/internals');

export interface RouterInternals<T> {
  matchImpl: ((method: string, path: string) => MatchOutput<T> | null) | undefined;
  matchLayer: MatchLayer | undefined;
  registration: Registration<T>;
}

interface CacheContainers<T> {
  /**
   * Per-method-code sparse array of hit caches. Indexing by `mc` (a small
   * SMI 0-31) gives the JIT a typed array load instead of the polymorphic
   * `Map<number, …>.get` it would otherwise compile.
   */
  hit: Array<RouterCache<MatchCacheEntry<T>> | undefined>;
  maxSize: number;
}

/**
 * HTTP router with build-once / match-many semantics. Methods are
 * declared as arrow-function fields rather than prototype methods so
 * detached calls (`const m = router.match; m(...)`) work without
 * `bind()` — every method closes over the constructor's locals and
 * never reads `this`. The instance is `Object.freeze`d at the end of
 * the constructor; the caches and other build-time state live in the
 * closure scope where external code cannot reach them.
 */
export class Router<T = unknown> implements RouterPublicApi<T> {
  readonly add: (
    method: string | readonly string[],
    path: string,
    value: T,
  ) => void;
  readonly addAll: (entries: ReadonlyArray<readonly [string, string, T]>) => void;
  readonly build: () => RouterPublicApi<T>;
  readonly match: (method: string, path: string) => MatchOutput<T> | null;
  readonly allowedMethods: (path: string) => readonly string[];

  constructor(options: RouterOptions = {}) {
    const routerOptions: RouterOptions = { ...options };
    const optionalParamDefaults = new OptionalParamDefaults(routerOptions.optionalParamBehavior);
    const methodRegistry = new MethodRegistry();
    const pathParser = new PathParser({
      caseSensitive: routerOptions.pathCaseSensitive ?? true,
      ignoreTrailingSlash: routerOptions.trailingSlash !== 'strict',
    });
    const registration = new Registration<T>(
      methodRegistry,
      pathParser,
      optionalParamDefaults,
    );
    // Validate cacheSize before passing it to RouterCache. nextPow2 silently
    // converts garbage (negative/NaN/non-integer) into a 1-slot cache and
    // rounds 1000 to 1024 — explicit guard for actionable errors.
    const requestedCacheSize = routerOptions.cacheSize ?? 1000;
    if (
      !Number.isInteger(requestedCacheSize) ||
      requestedCacheSize < 1 ||
      requestedCacheSize > 0x4000_0000
    ) {
      throw new RouterError({
        kind: 'router-options-invalid',
        message: `cacheSize must be a positive integer (received: ${String(requestedCacheSize)})`,
        suggestion: 'Pass a positive integer between 1 and 2^30.',
      });
    }
    const cache: CacheContainers<T> = {
      hit: [],
      maxSize: requestedCacheSize,
    };

    let matchImpl: ((method: string, path: string) => MatchOutput<T> | null) | undefined;
    let matchLayer: MatchLayer | undefined;

    // Internal inspection hatch for regression guards (walker tier
    // detection, handler rollback, etc). NOT part of the public API —
    // external code must access this through the `@zipbul/router/internal`
    // subpath via `getRouterInternals(router)`. Defined non-enumerable so
    // `Object.keys(router)` does not surface it; the wrapper itself is
    // unfrozen so build() can populate fields, while the Router instance
    // is frozen to prevent wrapper substitution.
    const internals: RouterInternals<T> = {
      matchImpl: undefined,
      matchLayer: undefined,
      registration,
    };

    Object.defineProperty(this, ROUTER_INTERNALS_KEY, {
      value: internals,
      writable: false,
      enumerable: false,
      configurable: false,
    });

    const performBuild = (): void => {
      const snapshot = registration.seal({
        optionalParamBehavior: routerOptions.optionalParamBehavior,
      });
      const r = buildFromRegistration<T>(snapshot, routerOptions, methodRegistry);

      let hasAnyStatic = false;

      for (const bucket of r.staticOutputsByMethod) {
        if (bucket !== undefined) { hasAnyStatic = true; break; }
      }

      // Pre-allocate per-method hit caches now so the hot path can drop
      // its `if (hc === undefined)` lazy-init branch — every active
      // method gets a slot and the matchImpl always sees a non-null hc.
      for (let i = 0; i < r.activeMethodCodes.length; i++) {
        const code = r.activeMethodCodes[i]![1];
        if (cache.hit[code] === undefined) {
          cache.hit[code] = new RouterCache(cache.maxSize);
        }
      }

      const cfg: MatchConfig<T> = {
        trimSlash: r.ignoreTrailingSlash,
        lowerCase: !r.caseSensitive,
        hasAnyTree: r.trees.some(t => t != null),
        hasAnyStatic,
        staticOutputsByMethod: r.staticOutputsByMethod,
        methodCodes: r.methodCodes,
        trees: r.trees,
        matchState: r.matchState,
        handlers: snapshot.handlers,
        hitCacheByMethod: cache.hit,
        activeMethodCodes: r.activeMethodCodes,
        terminalSlab: r.terminalSlab,
        paramsFactories: r.paramsFactories,
      };

      matchImpl = compileMatchFn<T>(cfg);
      // Force JSC tier-up on the next match() call. Empirical (100k tenant):
      // first-call ~110µs → ~63µs (-43%), p50 ~3µs → ~2µs (-30%). No
      // hot-path regression — JSC re-tiers regardless; this just front-
      // loads the cost into build().
      optimizeNextInvocation(matchImpl);
      matchLayer = new MatchLayer({
        normalizePath: r.normalizePath,
        matchState: r.matchState,
        activeMethodCodes: r.activeMethodCodes,
        trees: r.trees,
        staticPathMethodMask: r.staticPathMethodMask,
      });

      // Build-only tables are frozen as a partition.
      Object.freeze(snapshot.segmentTrees);
      Object.freeze(snapshot.staticByMethod);
      Object.freeze(r.activeMethodCodes);

      internals.matchImpl = matchImpl;
      internals.matchLayer = matchLayer;

      // Build pushes the JSC heap commit to a high-water mark (transient
      // parser/expand/prefix-index/insertion allocations on the order of
      // 100s of MB at 100k routes). `Bun.gc(true)` runs JSC's full
      // collect AND mimalloc's fragmented-memory cleanup in one call;
      // libpas's scavenger tick then returns the empty pages to the OS
      // asynchronously. Hot path is unaffected — the JIT lazily re-tiers
      // on the next match.
      Bun.gc(true);
    };

    this.add = (method, path, value) => {
      registration.add(method, path, value);
    };

    this.addAll = (entries) => {
      registration.addAll(entries);
    };

    this.build = () => {
      if (!registration.isSealed()) performBuild();
      // No post-build compactMemory call. The single `Bun.gc(true)` inside
      // performBuild collects the orphan heap synchronously; libpas's
      // scavenger runs every ~300ms on its own and decommits the freed
      // pages back to the OS without us having to poll. Empirical (100k
      // tenant param + factor): RSS settles to 53 MB within 500 ms of
      // build() returning, identical to the prior fire-and-forget polling
      // path, but without the GC-during-traffic race that polled 100ms
      // intervals introduced (p50 first-200 async matches: 218 → 157 ns).
      return this;
    };

    // Hot-path: dispatch the compiled matchImpl directly. Routing
    // through `matchLayer.match` would add a method-dispatch hop that
    // breaks JSC's monomorphic IC (verified: static match 300 ps → 13 ns,
    // param match +5 ns). MatchLayer owns cold-path concerns only.
    this.match = (method, path) => {
      if (matchImpl === undefined) return null;
      // Pathname must start with `/` per RFC 3986 origin-form. Without
      // this guard, the iterative/recursive fallback walkers (which
      // start `pos = 1` and skip the loop when `pos >= len`) can match
      // an empty string against a root-bearing dynamic tree (e.g.
      // `/:id?`) and return the wrong handler. The compiled codegen
      // tier already rejects `len < 2` upstream — the guard here
      // brings every walker tier in line.
      if (path.length === 0 || path.charCodeAt(0) !== 47) return null;
      return matchImpl(method, path);
    };

    this.allowedMethods = (path) => {
      if (matchLayer === undefined) return [];
      return matchLayer.allowedMethods(path);
    };

    Object.freeze(this);
  }
}
