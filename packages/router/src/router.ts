import type { HttpMethod } from '@zipbul/shared';
import type { MatchOutput, RouterOptions } from './types';
import type { MatchCacheEntry, MatchConfig } from './codegen/emitter';
import type { RouterCache, RouterMissCache } from './cache';

import { OptionalParamDefaults } from './builder/optional-param-defaults';
import { PathParser } from './builder/path-parser';
import { RouterError } from './error';
import { compileMatchFn } from './codegen/emitter';
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
  matchLayer: MatchLayer<T> | undefined;
  registration: Registration<T>;
}

interface CacheContainers<T> {
  hit: Map<number, RouterCache<MatchCacheEntry<T>>>;
  miss: Map<number, RouterMissCache>;
  maxSize: number;
}

/**
 * Default per-method match-cache entry limit when `RouterOptions.cacheSize`
 * is omitted. 32 methods × 1000 × ~80B ≈ 2.5MB worst-case — covers 99% of
 * workloads. Not a hard upper bound — `cacheSize` accepts any positive
 * integer; truly pathological cardinality should layer an external LRU on top.
 */
const DEFAULT_CACHE_SIZE = 1000;

/**
 * 캐시는 항상 켜진다. 빈 라우터는 빈 캐시(메모리 0)이고, lazy 할당이라
 * 토글의 가치가 없다. 유일한 튜너블은 `cacheSize` — 메서드별 엔트리 상한.
 */
function createCacheContainers<T>(options: RouterOptions): CacheContainers<T> {
  const maxSize = options.cacheSize ?? DEFAULT_CACHE_SIZE;

  return {
    hit: new Map(),
    miss: new Map(),
    maxSize,
  };
}

const NUMERIC_OPTION_KEYS = [
  'maxMethodLength',
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
  const allowUnbounded = options.unsafeAllowUnboundedLimits === true;
  const issues: Array<{ option: string; message: string; suggestion?: string }> = [];
  for (const key of NUMERIC_OPTION_KEYS) {
    const v = options[key];
    if (v === undefined) continue;
    if (typeof v !== 'number' || Number.isNaN(v) || v <= 0) {
      issues.push({ option: key, message: `${key} must be a positive number (received ${String(v)}).` });
      continue;
    }
    if (!Number.isFinite(v) && !allowUnbounded) {
      issues.push({
        option: key,
        message: `${key} must be finite (received Infinity).`,
        suggestion: 'Provide a finite cap, or opt in via unsafeAllowUnboundedLimits=true (drops secure-profile guarantees).',
      });
      continue;
    }
    if (v === Number.MAX_SAFE_INTEGER && !allowUnbounded) {
      issues.push({
        option: key,
        message: `${key} = Number.MAX_SAFE_INTEGER is treated as unbounded.`,
        suggestion: 'Provide a finite cap, or opt in via unsafeAllowUnboundedLimits=true.',
      });
      continue;
    }
    if (Number.isFinite(v) && !Number.isInteger(v)) {
      issues.push({ option: key, message: `${key} must be an integer (received ${String(v)}).` });
      continue;
    }
  }
  if (options.profile === 'secure' && options.unsafeAllowUnboundedLimits === true) {
    issues.push({
      option: 'profile',
      message: 'profile="secure" is incompatible with unsafeAllowUnboundedLimits=true.',
      suggestion: 'Choose profile="compat" or profile="unsafe" to allow unbounded limits.',
    });
  }
  if (options.profile === 'secure' && (options.pathCaseSensitive === false || options.caseSensitive === false)) {
    issues.push({
      option: 'pathCaseSensitive',
      message: 'profile="secure" requires path case-sensitivity (pathCaseSensitive must not be false).',
      suggestion: 'Switch to profile="compat" or remove pathCaseSensitive=false.',
    });
  }
  if (options.profile !== undefined && !['secure', 'compat', 'unsafe'].includes(options.profile)) {
    issues.push({
      option: 'profile',
      message: `profile must be 'secure' | 'compat' | 'unsafe' (received '${String(options.profile)}').`,
    });
  }
  if (options.trailingSlash !== undefined && options.trailingSlash !== 'strict' && options.trailingSlash !== 'ignore') {
    issues.push({
      option: 'trailingSlash',
      message: `trailingSlash must be 'strict' | 'ignore' (received '${String(options.trailingSlash)}').`,
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
  if (options.trailingSlash !== undefined) return options.trailingSlash === 'ignore';
  if (options.ignoreTrailingSlash !== undefined) return options.ignoreTrailingSlash;
  return options.profile === 'secure' ? false : true; // secure default = strict
}

function resolvePathCaseSensitive(options: RouterOptions): boolean {
  if (options.pathCaseSensitive !== undefined) return options.pathCaseSensitive;
  if (options.caseSensitive !== undefined) return options.caseSensitive;
  return true;
}

function createPathParser(options: RouterOptions): PathParser {
  return new PathParser({
    caseSensitive: resolvePathCaseSensitive(options),
    ignoreTrailingSlash: resolveTrailingSlashIgnore(options),
    maxSegmentLength: options.maxSegmentLength ?? 1024,
    maxPathLength: options.maxPathLength ?? 8192,
    maxSegmentCount: options.maxSegmentCount ?? 256,
    maxParams: options.maxParams ?? 64,
    profile: options.profile ?? 'secure',
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
export class Router<T = unknown> {
  readonly add: (
    method: HttpMethod | HttpMethod[] | '*',
    path: string,
    value: T,
  ) => void;
  readonly addAll: (entries: Array<[HttpMethod, string, T]>) => void;
  readonly build: () => this;
  readonly match: (method: HttpMethod, path: string) => MatchOutput<T> | null;
  readonly allowedMethods: (path: string) => HttpMethod[];

  constructor(options: RouterOptions = {}) {
    validateOptions(options);
    const routerOptions: RouterOptions = { ...options };
    const optionalParamDefaults = new OptionalParamDefaults(routerOptions.optionalParamBehavior);
    const methodRegistry = new MethodRegistry(routerOptions.profile ?? 'secure');
    const pathParser = createPathParser(routerOptions);
    const registration = new Registration<T>(
      methodRegistry,
      pathParser,
      optionalParamDefaults,
    );
    const cache = createCacheContainers<T>(routerOptions);

    let matchImpl: ((method: string, path: string) => MatchOutput<T> | null) | undefined;
    let matchLayer: MatchLayer<T> | undefined;

    // Internal inspection hatch for regression guards (walker tier
    // detection, handler rollback, etc). NOT part of the public API —
    // external code must access this through the `@zipbul/router/internal`
    // subpath via `getRouterInternals(router)`. Defined non-enumerable so
    // `Object.keys(router)` does not surface it; the wrapper itself is
    // unfrozen so build() can populate fields, while the Router instance
    // is frozen to prevent wrapper substitution.
    const internals = {
      matchImpl: undefined as ((method: string, path: string) => MatchOutput<T> | null) | undefined,
      matchLayer: undefined as MatchLayer<T> | undefined,
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
        maxExpandedRoutes: routerOptions.maxExpandedRoutes,
        maxOptionalExpansions: routerOptions.maxOptionalExpansions,
      });
      const r = buildFromRegistration<T>(snapshot, routerOptions, methodRegistry);

      let hasAnyStatic = false;

      for (const bucket of r.staticOutputsByMethod) {
        if (bucket !== undefined) { hasAnyStatic = true; break; }
      }

      const cfg: MatchConfig<T> = {
        trimSlash: r.ignoreTrailingSlash,
        lowerCase: !r.caseSensitive,
        maxPathLen: r.maxPathLength,
        maxSegLen: r.maxSegmentLength,
        checkPathLen: Number.isFinite(r.maxPathLength),
        checkSegLen: Number.isFinite(r.maxSegmentLength),
        hasAnyTree: r.trees.some(t => t != null),
        anyTester: r.anyTester,
        hasAnyStatic,
        staticOutputsByMethod: r.staticOutputsByMethod,
        staticMap: snapshot.staticMap,
        methodCodes: r.methodCodes,
        trees: r.trees,
        matchState: r.matchState,
        handlers: snapshot.handlers,
        hitCacheByMethod: cache.hit,
        missCacheByMethod: cache.miss,
        cacheMaxSize: cache.maxSize,
        activeMethodCodes: r.activeMethodCodes,
        terminalHandlers: r.terminalHandlers,
        isWildcardByTerminal: r.isWildcardByTerminal,
        paramsFactories: r.paramsFactories,
      };

      matchImpl = compileMatchFn<T>(cfg);
      matchLayer = new MatchLayer<T>({
        normalizePath: r.normalizePath,
        matchState: r.matchState,
        activeMethodCodes: r.activeMethodCodes,
        staticOutputsByMethod: r.staticOutputsByMethod,
        trees: r.trees,
      });

      // Build-only tables are frozen as a partition.
      Object.freeze(snapshot.segmentTrees);
      Object.freeze(snapshot.staticMap);
      Object.freeze(snapshot.staticRegistered);
      Object.freeze(r.activeMethodCodes);

      internals.matchImpl = matchImpl;
      internals.matchLayer = matchLayer;
    };

    this.add = (method, path, value) => {
      registration.add(method, path, value);
    };

    this.addAll = (entries) => {
      registration.addAll(entries);
    };

    this.build = () => {
      if (!registration.isSealed()) performBuild();
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
