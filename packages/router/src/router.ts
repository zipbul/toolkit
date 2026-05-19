import { optimizeNextInvocation } from 'bun:jsc';

import type { MatchCacheEntry, MatchConfig } from './codegen';
import type { SegmentNode } from './tree';
import type { MatchOutput, RouterOptions, RouterPublicApi } from './types';

import { OptionalParamDefaults, PathParser } from './builder';
import { RouterCache } from './cache';
import { compileMatchFn } from './codegen';
import { RouterError } from './error';
import { MethodRegistry } from './method-registry';
import { buildFromRegistration, MatchLayer, Registration } from './pipeline';
import { forEachStaticChild } from './tree';
import { RouterErrorKind } from './types';

/**
 * Symbol-keyed slot for the internal-inspection hatch. Symbol identity
 * means external code cannot recreate the key by name, and the slot is
 * non-enumerable. The `@zipbul/router/internal` subpath re-exports this
 * symbol along with `getRouterInternals()` for regression-test access.
 */
const ROUTER_INTERNALS_KEY: unique symbol = Symbol.for('@zipbul/router/internals');

/** Frozen empty-string array returned by `allowedMethods()` before build().
 *  Single shared instance — avoids per-call allocation on the pre-build
 *  stub path. */
const EMPTY_METHODS: readonly string[] = Object.freeze([]);

/** Build the root-fast-miss mask for one method's segment-tree root.
 *  Returns null when the root could route a path the mask cannot prove
 *  absent (param-child / wildcard-store / compacted prefix chain). When
 *  non-null, `mask[byte] === 1` iff at least one root-level static child
 *  starts with that byte — the emitter reads this to skip walker
 *  dispatch on a guaranteed root miss. */
function buildRootFirstCharMask(root: SegmentNode): Int32Array | null {
  if (root.paramChild !== null) {
    return null;
  }
  if (root.wildcardStore !== null) {
    return null;
  }
  if (root.staticPrefix !== null) {
    return null;
  }
  const mask = new Int32Array(256);
  let hasAny = false;
  forEachStaticChild(root, key => {
    if (key.length > 0) {
      mask[key.charCodeAt(0)] = 1;
      hasAny = true;
    }
  });
  return hasAny ? mask : null;
}

interface RouterInternals<T> {
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
class Router<T = unknown> implements RouterPublicApi<T> {
  readonly add: (method: string | readonly string[], path: string, value: T) => void;
  readonly addAll: (entries: ReadonlyArray<readonly [string, string, T]>) => void;
  readonly build: () => RouterPublicApi<T>;
  match: (method: string, path: string) => MatchOutput<T> | null;
  allowedMethods: (path: string) => readonly string[];

  constructor(options: RouterOptions = {}) {
    const routerOptions: RouterOptions = { ...options };
    const methodRegistry = new MethodRegistry();
    const registration = new Registration<T>(
      methodRegistry,
      new PathParser({
        caseSensitive: routerOptions.pathCaseSensitive ?? true,
        ignoreTrailingSlash: routerOptions.ignoreTrailingSlash ?? true,
      }),
      new OptionalParamDefaults(routerOptions.omitMissingOptional ?? true),
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
      // Hot-path: rebind this.match directly to the compiled implementation.
      // The earlier `(m, p) => internals.matchImpl(m, p)` arrow added a
      // closure-call hop on every dispatch; rebinding skips the hop and
      // exposes matchImpl as a monomorphic call site to JSC. The layer
      // facade keeps allowedMethods cold-path correct.
      this.match = built.matchImpl;
      this.allowedMethods = path => built.matchLayer.allowedMethods(path);
      // Re-freeze after rebind so the post-build surface stays immutable.
      Object.freeze(this);
    };

    this.add = (method, path, value) => {
      registration.add(method, path, value);
    };
    this.addAll = entries => {
      registration.addAll(entries);
    };
    this.build = () => {
      if (!registration.isSealed()) {
        performBuild();
      }
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

    // Pre-build stubs. match() before build() returns null; allowedMethods
    // returns []. Both are replaced in performBuild() with direct closure
    // captures of the compiled implementation.
    //
    // No leading-slash guard. Standard HTTP server boundaries
    // (Node `req.url`, Bun `URL(...).pathname`, Express/Fastify/Hono
    // request handlers) all guarantee origin-form pathnames per RFC 7230
    // §5.3.1, and our peer routers (find-my-way, hono, rou3) skip the
    // check for the same reason. Callers handing the router a non-`/`
    // input is undefined behavior.
    this.match = () => null;
    this.allowedMethods = () => EMPTY_METHODS;
  }
}

/**
 * Validate `cacheSize` before handing it to `RouterCache`. nextPow2 silently
 * converts garbage (negative/NaN/non-integer) into a 1-slot cache and rounds
 * 1000 → 1024; this guard surfaces actionable errors instead.
 *
 * @internal exported for unit tests.
 */
function validateCacheSize(rawCacheSize: number | undefined): number {
  const requested = rawCacheSize ?? 1000;
  if (!Number.isInteger(requested) || requested < 1 || requested > 0x4000_0000) {
    throw new RouterError({
      kind: RouterErrorKind.RouterOptionsInvalid,
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
    omitMissingOptional: routerOptions.omitMissingOptional,
  });
  const r = buildFromRegistration<T>(snapshot, routerOptions, methodRegistry);

  let hasAnyStatic = false;
  for (const bucket of r.staticOutputsByMethod) {
    if (bucket !== undefined) {
      hasAnyStatic = true;
      break;
    }
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
  // Per-method active-flag table for the emitter's wrong-method fast path.
  // `methodCodes` carries 7 default HTTP method codes on every router, so
  // `methodCodes[method] !== undefined` is necessary but not sufficient —
  // the emitted prelude reads activeMethodMask[mc] to short-circuit a
  // wrong-method dispatch in one branch instead of falling through pre-probe,
  // cache get, and walker dispatch. Sized to MAX_METHODS (32) so a typed-array
  // index never goes out of bounds.
  const activeMethodMask = new Int32Array(32);
  for (let i = 0; i < r.activeMethodCodes.length; i++) {
    activeMethodMask[r.activeMethodCodes[i]![1]] = 1;
  }

  // Root-fast-miss mask: per-method byte-keyed presence table of the root
  // segment-tree's static children. Null when the root carries a param,
  // wildcard, or compacted prefix that could route an unknown byte (the
  // mask cannot prove a miss in those cases). The emitter's walker
  // prelude reads this mask to skip walker dispatch entirely when the
  // first path byte is unknown.
  const rootFirstCharMaskByMethod: Array<Int32Array | null> = [];
  for (let i = 0; i < 32; i++) {
    rootFirstCharMaskByMethod[i] = null;
  }
  for (let i = 0; i < r.activeMethodCodes.length; i++) {
    const code = r.activeMethodCodes[i]![1];
    const root = snapshot.segmentTrees[code];
    if (root != null) {
      rootFirstCharMaskByMethod[code] = buildRootFirstCharMask(root);
    }
  }

  return {
    trimSlash: r.ignoreTrailingSlash,
    lowerCase: !r.caseSensitive,
    hasAnyTree: r.trees.some(t => t != null),
    hasAnyStatic,
    staticOutputsByMethod: r.staticOutputsByMethod,
    staticByPath: r.staticByPath,
    methodCodes: r.methodCodes,
    activeMethodMask,
    rootFirstCharMaskByMethod,
    trees: r.trees,
    matchState: r.matchState,
    handlers: snapshot.handlers,
    hitCacheByMethod: cache.hit,
    activeMethodCodes: r.activeMethodCodes,
    terminalSlab: r.terminalSlab,
    paramsFactories: r.paramsFactories,
  };
}

export { ROUTER_INTERNALS_KEY, Router, validateCacheSize };
export type { RouterInternals };
