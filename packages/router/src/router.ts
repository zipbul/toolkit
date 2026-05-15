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
    const methodRegistry = new MethodRegistry();
    const registration = new Registration<T>(
      methodRegistry,
      new PathParser({
        caseSensitive: routerOptions.pathCaseSensitive ?? true,
        ignoreTrailingSlash: routerOptions.trailingSlash !== 'strict',
      }),
      new OptionalParamDefaults(routerOptions.optionalParamBehavior),
    );
    const cache: CacheContainers<T> = {
      hit: [],
      maxSize: validateCacheSize(routerOptions.cacheSize),
    };
    const internals: RouterInternals<T> = {
      matchImpl: undefined,
      matchLayer: undefined,
      registration,
    };
    installInternalsSlot(this, internals);

    const performBuild = (): void => {
      const built = runBuildPipeline<T>(registration, methodRegistry, routerOptions, cache);
      internals.matchImpl = built.matchImpl;
      internals.matchLayer = built.matchLayer;
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

    // Hot-path: dispatch the compiled matchImpl directly. Routing through
    // `matchLayer.match` would add a method-dispatch hop that breaks JSC's
    // monomorphic IC (verified: static match 300 ps → 13 ns, param match
    // +5 ns). MatchLayer owns cold-path concerns only.
    //
    // No leading-slash guard. Standard HTTP server boundaries
    // (Node `req.url`, Bun `URL(...).pathname`, Express/Fastify/Hono
    // request handlers) all guarantee origin-form pathnames per RFC 7230
    // §5.3.1, and our peer routers (find-my-way, hono, rou3) skip the
    // check for the same reason. Callers handing the router a non-`/`
    // input is undefined behavior.
    this.match = (method, path) => {
      const impl = internals.matchImpl;
      return impl === undefined ? null : impl(method, path);
    };
    this.allowedMethods = (path) => {
      const layer = internals.matchLayer;
      return layer === undefined ? [] : layer.allowedMethods(path);
    };

    Object.freeze(this);
  }
}

/**
 * Validate `cacheSize` before handing it to `RouterCache`. nextPow2 silently
 * converts garbage (negative/NaN/non-integer) into a 1-slot cache and rounds
 * 1000 → 1024; this guard surfaces actionable errors instead.
 */
function validateCacheSize(rawCacheSize: number | undefined): number {
  const requested = rawCacheSize ?? 1000;
  if (
    !Number.isInteger(requested) ||
    requested < 1 ||
    requested > 0x4000_0000
  ) {
    throw new RouterError({
      kind: 'router-options-invalid',
      message: `cacheSize must be a positive integer (received: ${String(requested)})`,
      suggestion: 'Pass a positive integer between 1 and 2^30.',
    });
  }
  return requested;
}

/**
 * Internal-inspection hatch wiring. Symbol-keyed slot, non-enumerable +
 * non-configurable so external code cannot recreate the key by name and
 * `Object.keys(router)` does not surface it. The `internals` wrapper
 * itself stays unfrozen so build() can populate matchImpl/matchLayer
 * after the Router instance is frozen.
 */
function installInternalsSlot<T>(target: object, internals: RouterInternals<T>): void {
  Object.defineProperty(target, ROUTER_INTERNALS_KEY, {
    value: internals,
    writable: false,
    enumerable: false,
    configurable: false,
  });
}

interface BuildPipelineResult<T> {
  matchImpl: (method: string, path: string) => MatchOutput<T> | null;
  matchLayer: MatchLayer;
}

/**
 * Drive one build cycle: seal registration → produce runtime tables →
 * pre-allocate per-method caches → compile matchImpl → freeze read-only
 * partitions → run the single mimalloc/JSC GC drain. Returns the freshly
 * built matchImpl/matchLayer pair so the caller can publish them into
 * the internals slot.
 */
function runBuildPipeline<T>(
  registration: Registration<T>,
  methodRegistry: MethodRegistry,
  routerOptions: RouterOptions,
  cache: CacheContainers<T>,
): BuildPipelineResult<T> {
  const snapshot = registration.seal({
    optionalParamBehavior: routerOptions.optionalParamBehavior,
  });
  const r = buildFromRegistration<T>(snapshot, routerOptions, methodRegistry);

  let hasAnyStatic = false;
  for (const bucket of r.staticOutputsByMethod) {
    if (bucket !== undefined) { hasAnyStatic = true; break; }
  }

  // Pre-allocate per-method hit caches so the hot path can drop its
  // `if (hc === undefined)` lazy-init branch — every active method gets
  // a slot and the matchImpl always sees a non-null hc.
  for (let i = 0; i < r.activeMethodCodes.length; i++) {
    const code = r.activeMethodCodes[i]![1];
    if (cache.hit[code] === undefined) {
      cache.hit[code] = new RouterCache(cache.maxSize);
    }
  }

  const matchImpl = compileMatchFn<T>(buildMatchConfig(snapshot, r, cache, hasAnyStatic));
  // Force JSC tier-up on the next match() call. Empirical (100k tenant):
  // first-call ~110µs → ~63µs (-43%), p50 ~3µs → ~2µs (-30%). No hot-path
  // regression — JSC re-tiers regardless; this just front-loads the cost
  // into build().
  optimizeNextInvocation(matchImpl);
  const matchLayer = new MatchLayer({
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

  // Build pushes the JSC heap commit to a high-water mark (transient
  // parser/expand/prefix-index/insertion allocations on the order of 100s
  // of MB at 100k routes). `Bun.gc(true)` runs JSC's full collect AND
  // mimalloc's fragmented-memory cleanup in one call; libpas's scavenger
  // tick then returns the empty pages to the OS asynchronously. Hot path
  // is unaffected — the JIT lazily re-tiers on the next match.
  Bun.gc(true);

  return { matchImpl, matchLayer };
}

/** Pure projection: snapshot + BuildResult + cache → MatchConfig. */
function buildMatchConfig<T>(
  snapshot: ReturnType<Registration<T>['seal']>,
  r: ReturnType<typeof buildFromRegistration<T>>,
  cache: CacheContainers<T>,
  hasAnyStatic: boolean,
): MatchConfig<T> {
  return {
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
}
