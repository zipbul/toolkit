import type { HttpMethod } from '@zipbul/shared';
import type { MatchOutput, RegexSafetyOptions, RouterOptions } from './types';
import type { MatchCacheEntry, MatchConfig } from './codegen/emitter';
import type { RouterCache } from './cache';

import { OptionalParamDefaults } from './builder/optional-param-defaults';
import { PathParser } from './builder/path-parser';
import { compileMatchFn } from './codegen/emitter';
import { MethodRegistry } from './method-registry';
import { buildFromRegistration } from './pipeline/build';
import { MatchLayer } from './pipeline/match';
import { Registration } from './pipeline/registration';

interface CacheContainers<T> {
  hit: Map<number, RouterCache<MatchCacheEntry<T>>>;
  miss: Map<number, Set<string>>;
  maxSize: number;
}

function normalizeRegexSafety(opts: RegexSafetyOptions | undefined): RegexSafetyOptions {
  const out: RegexSafetyOptions = {
    mode: opts?.mode ?? 'error',
    maxLength: opts?.maxLength ?? 256,
    forbidBacktrackingTokens: opts?.forbidBacktrackingTokens ?? true,
    forbidBackreferences: opts?.forbidBackreferences ?? true,
  };

  if (opts?.maxExecutionMs !== undefined) out.maxExecutionMs = opts.maxExecutionMs;
  if (opts?.validator !== undefined) out.validator = opts.validator;

  return out;
}

function createCacheContainers<T>(options: RouterOptions): CacheContainers<T> | undefined {
  if (options.enableCache !== true) return undefined;

  return {
    hit: new Map(),
    miss: new Map(),
    maxSize: options.cacheSize ?? 1000,
  };
}

function createPathParser(options: RouterOptions, regexSafety: RegexSafetyOptions): PathParser {
  return new PathParser({
    caseSensitive: options.caseSensitive ?? true,
    ignoreTrailingSlash: options.ignoreTrailingSlash ?? true,
    maxSegmentLength: options.maxSegmentLength ?? 256,
    regexSafety,
    regexAnchorPolicy: options.regexAnchorPolicy,
    onWarn: options.onWarn,
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

  /**
   * Inspection hatch for internal regression guards (walker tier
   * detection, handler rollback, etc). Not part of the public API —
   * external code must not depend on the shape. Defined non-enumerable
   * so `Object.keys(router)` does not surface it. The wrapper object
   * itself is unfrozen so build() can populate it; the instance is
   * frozen, which prevents callers from substituting a different
   * wrapper.
   */
  declare readonly _internals: {
    matchImpl: ((method: string, path: string) => MatchOutput<T> | null) | undefined;
    matchLayer: MatchLayer<T> | undefined;
    registration: Registration<T>;
  };

  constructor(options: RouterOptions = {}) {
    const regexSafety = normalizeRegexSafety(options.regexSafety);
    const optionalParamDefaults = new OptionalParamDefaults(options.optionalParamBehavior);
    const methodRegistry = new MethodRegistry();
    const pathParser = createPathParser(options, regexSafety);
    const registration = new Registration<T>(
      regexSafety,
      methodRegistry,
      pathParser,
      optionalParamDefaults,
    );
    const cache = createCacheContainers<T>(options);

    let matchImpl: ((method: string, path: string) => MatchOutput<T> | null) | undefined;
    let matchLayer: MatchLayer<T> | undefined;

    const internals: Router<T>['_internals'] = {
      matchImpl: undefined,
      matchLayer: undefined,
      registration,
    };

    Object.defineProperty(this, '_internals', {
      value: internals,
      writable: false,
      enumerable: false,
      configurable: false,
    });

    const performBuild = (): void => {
      const snapshot = registration.seal();
      const r = buildFromRegistration<T>(snapshot, options, methodRegistry);

      let hasAnyStatic = false;

      for (const bucket of r.staticOutputsByMethod) {
        if (bucket !== undefined) { hasAnyStatic = true; break; }
      }

      const cfg: MatchConfig<T> = {
        useCache: cache !== undefined,
        trimSlash: r.ignoreTrailingSlash,
        lowerCase: !r.caseSensitive,
        maxPathLen: r.maxPathLength,
        maxSegLen: r.maxSegmentLength,
        checkPathLen: Number.isFinite(r.maxPathLength),
        checkSegLen: Number.isFinite(r.maxSegmentLength),
        hasAnyTree: r.trees.some(t => t != null),
        hasOptDefaults: !optionalParamDefaults.isEmpty(),
        anyTester: r.anyTester,
        hasAnyStatic,
        staticOutputsByMethod: r.staticOutputsByMethod,
        staticMap: snapshot.staticMap,
        methodCodes: r.methodCodes,
        trees: r.trees,
        matchState: r.matchState,
        handlers: snapshot.handlers,
        optDefaults: optionalParamDefaults,
        hitCacheByMethod: cache?.hit,
        missCacheByMethod: cache?.miss,
        cacheMaxSize: cache?.maxSize ?? 1000,
        activeMethodCodes: r.activeMethodCodes,
        wildSpecs: r.wildSpecs,
      };

      matchImpl = compileMatchFn<T>(cfg);
      matchLayer = new MatchLayer<T>({
        normalizePath: r.normalizePath,
        matchState: r.matchState,
        activeMethodCodes: r.activeMethodCodes,
        staticOutputsByMethod: r.staticOutputsByMethod,
        trees: r.trees,
      });

      // Build-only tables are frozen as a partition. Hot-path tables
      // (`handlers`, `trees`, `staticOutputsByMethod`, `methodCodes`)
      // are intentionally *not* frozen — JSC inline caches degrade when
      // match() reads from frozen closure-captured objects in tight
      // loops, costing ~5-10 ns per dynamic match (verified via bench
      // against bench/baseline). Hot-path tables are still protected
      // indirectly: nothing mutates them after build() because `sealed`
      // rejects every public code path that would.
      Object.freeze(snapshot.segmentTrees);
      Object.freeze(snapshot.staticMap);
      Object.freeze(snapshot.staticRegistered);
      Object.freeze(r.wildSpecs);
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
