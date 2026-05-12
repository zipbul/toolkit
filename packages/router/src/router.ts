import type { MatchOutput, RouterOptions, RouterPublicApi } from './types';
import type { MatchCacheEntry, MatchConfig } from './codegen/emitter';
import type { RouterCache, RouterMissCache } from './cache';

import { OptionalParamDefaults } from './builder/optional-param-defaults';
import { PathParser } from './builder/path-parser';
import { RouterError } from './error';
import { compileMatchFn } from './codegen/emitter';
import {
  resetBuildAggregate,
  snapshotBuildAggregate,
  type BuildAggregate,
} from './codegen/codegen-telemetry';
import { optimizeNextInvocation } from 'bun:jsc';

import { MethodRegistry } from './method-registry';
import { buildFromRegistration } from './pipeline/build';
import { MatchLayer } from './pipeline/match';
import { Registration } from './pipeline/registration';

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
  /**
   * Codegen aggregate for the most recent build pass: counts of generated
   * vs bailed compiled walkers, total emit/compile/warmup time spent.
   */
  codegenAggregate: BuildAggregate | undefined;
}

interface CacheContainers<T> {
  /**
   * Per-method-code sparse array of hit caches. Indexing by `mc` (a small
   * SMI 0-31) gives the JIT a typed array load instead of the polymorphic
   * `Map<number, …>.get` it would otherwise compile.
   */
  hit: Array<RouterCache<MatchCacheEntry<T>> | undefined>;
  miss: Array<RouterMissCache | undefined>;
  maxSize: number;
}

/**
 * 캐시는 항상 켜진다. 빈 라우터는 빈 캐시(메모리 0)이고, lazy 할당이라
 * 토글의 가치가 없다. 유일한 튜너블은 `cacheSize` — 메서드별 엔트리 상한.
 * Default `1000 = 1000` covers 32 methods × 1000 ×
 * ~80B ≈ 2.5 MB worst-case.
 */
function createCacheContainers<T>(options: RouterOptions): CacheContainers<T> {
  const maxSize = options.cacheSize ?? 1000;

  return {
    hit: [],
    miss: [],
    maxSize,
  };
}

const NUMERIC_OPTION_KEYS = [
  'maxPathLength',
  'maxSegmentLength',
  'maxSegmentCount',
  'maxParams',
  'maxOptionalExpansions',
  'maxExpandedRoutes',
  'maxRegexSiblingsPerSegment',
  'cacheSize',
] as const;

function validateOptions(options: RouterOptions): void {
  const issues: Array<{ option: string; message: string; suggestion?: string }> = [];
  for (const key of NUMERIC_OPTION_KEYS) {
    const v = options[key];
    if (v === undefined) continue;
    if (typeof v !== 'number' || Number.isNaN(v) || v <= 0) {
      issues.push({ option: key, message: `${key} must be a positive number (received ${String(v)}).` });
      continue;
    }
    if (!Number.isFinite(v)) {
      issues.push({
        option: key,
        message: `${key} must be a finite number (received ${String(v)}).`,
        suggestion: 'Provide a finite integer cap; Infinity removes the protective limit.',
      });
      continue;
    }
    if (v >= Number.MAX_SAFE_INTEGER) {
      issues.push({
        option: key,
        message: `${key} = ${String(v)} is treated as unbounded; provide a finite cap below Number.MAX_SAFE_INTEGER.`,
      });
      continue;
    }
    if (!Number.isInteger(v)) {
      issues.push({ option: key, message: `${key} must be an integer (received ${String(v)}).` });
      continue;
    }
  }
  if (options.trailingSlash !== undefined && options.trailingSlash !== 'strict' && options.trailingSlash !== 'ignore') {
    issues.push({
      option: 'trailingSlash',
      message: `trailingSlash must be 'strict' | 'ignore' (received '${String(options.trailingSlash)}').`,
    });
  }
  if (options.pathCaseSensitive !== undefined && typeof options.pathCaseSensitive !== 'boolean') {
    issues.push({
      option: 'pathCaseSensitive',
      message: `pathCaseSensitive must be a boolean (received ${typeof options.pathCaseSensitive} '${String(options.pathCaseSensitive)}').`,
    });
  }
  if (
    options.optionalParamBehavior !== undefined &&
    options.optionalParamBehavior !== 'omit' &&
    options.optionalParamBehavior !== 'set-undefined'
  ) {
    issues.push({
      option: 'optionalParamBehavior',
      message: `optionalParamBehavior must be 'omit' | 'set-undefined' (received '${String(options.optionalParamBehavior)}').`,
    });
  }
  if (issues.length === 0) return;
  throw new RouterError({
    kind: 'route-validation',
    message: `${issues.length} option(s) failed validation.`,
    errors: issues.map((i, idx) => ({
      index: idx,
      method: '',
      path: '',
      error: { kind: 'option-invalid' as const, message: i.message, option: i.option, suggestion: i.suggestion },
    })),
  });
}

function resolveTrailingSlashIgnore(options: RouterOptions): boolean {
  // Default is 'ignore' so `/foo/` and `/foo` map to the same route.
  // Set `trailingSlash: 'strict'` for byte-exact matching.
  return options.trailingSlash !== 'strict';
}

function resolvePathCaseSensitive(options: RouterOptions): boolean {
  return options.pathCaseSensitive ?? true;
}

function createPathParser(options: RouterOptions): PathParser {
  return new PathParser({
    caseSensitive: resolvePathCaseSensitive(options),
    ignoreTrailingSlash: resolveTrailingSlashIgnore(options),
    maxSegmentLength: options.maxSegmentLength ?? 1024,
    maxPathLength: options.maxPathLength ?? 8192,
    maxSegmentCount: options.maxSegmentCount ?? 256,
    maxParams: options.maxParams ?? 64,
  });
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
    validateOptions(options);
    const routerOptions: RouterOptions = { ...options };
    const optionalParamDefaults = new OptionalParamDefaults(routerOptions.optionalParamBehavior);
    const methodRegistry = new MethodRegistry();
    const pathParser = createPathParser(routerOptions);
    const registration = new Registration<T>(
      methodRegistry,
      pathParser,
      optionalParamDefaults,
    );
    const cache = createCacheContainers<T>(routerOptions);

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
      codegenAggregate: undefined,
    };

    Object.defineProperty(this, ROUTER_INTERNALS_KEY, {
      value: internals,
      writable: false,
      enumerable: false,
      configurable: false,
    });

    const performBuild = (): void => {
      resetBuildAggregate();
      const snapshot = registration.seal({
        optionalParamBehavior: routerOptions.optionalParamBehavior,
        maxExpandedRoutes: routerOptions.maxExpandedRoutes,
        maxOptionalExpansions: routerOptions.maxOptionalExpansions,
        maxRegexSiblingsPerSegment: routerOptions.maxRegexSiblingsPerSegment,
      });
      const r = buildFromRegistration<T>(snapshot, routerOptions, methodRegistry);

      let hasAnyStatic = false;

      for (const bucket of r.staticOutputsByMethod) {
        if (bucket !== undefined) { hasAnyStatic = true; break; }
      }

      const cfg: MatchConfig<T> = {
        trimSlash: r.ignoreTrailingSlash,
        lowerCase: !r.caseSensitive,
        hasAnyTree: r.trees.some(t => t != null),
        anyTester: r.anyTester,
        hasAnyStatic,
        staticOutputsByMethod: r.staticOutputsByMethod,
        methodCodes: r.methodCodes,
        trees: r.trees,
        matchState: r.matchState,
        handlers: snapshot.handlers,
        hitCacheByMethod: cache.hit,
        missCacheByMethod: cache.miss,
        cacheMaxSize: cache.maxSize,
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
      internals.codegenAggregate = snapshotBuildAggregate();

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
      return matchImpl(method, path);
    };

    this.allowedMethods = (path) => {
      if (matchLayer === undefined) return [];
      return matchLayer.allowedMethods(path);
    };

    Object.freeze(this);
  }
}
