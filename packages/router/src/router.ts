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

const ROUTER_INTERNALS_KEY: unique symbol = Symbol.for('@zipbul/router/internals');

const EMPTY_METHODS: readonly string[] = Object.freeze([]);

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
  hit: Array<RouterCache<MatchCacheEntry<T>> | undefined>;
  maxSize: number;
}

/**
 * High-performance URL router. Build-once / match-many.
 *
 * Lifecycle:
 * 1. `new Router(options?)` — instantiate.
 * 2. `add(method, path, value)` / `addAll(entries)` — queue routes.
 *    Path syntax, conflict, and duplicate validation is deferred to
 *    `build()`.
 * 3. `build()` — seal the router and emit the specialized match
 *    function. Required before `match()` returns anything but `null`.
 * 4. `match(method, path)` / `allowedMethods(path)` — query at runtime.
 *
 * Once `build()` returns, the instance is frozen and further `add()` /
 * `addAll()` calls throw `RouterError({ kind: 'router-sealed' })`. To
 * register more routes, construct a new `Router`.
 *
 * All instance methods are detachable (`const m = router.match;
 * m('GET', '/x')`) — they do not read `this`.
 *
 * @template T - Type of the value stored with each route.
 */
class Router<T = unknown> implements RouterPublicApi<T> {
  /**
   * Queue a route for registration. Validation is deferred to
   * `build()`; this call only throws if invoked after `build()`.
   *
   * @param method - HTTP method, an array of methods to register the
   *   same route under, or `'*'` to expand at seal time to every
   *   method present at build time (the seven HTTP defaults plus any
   *   custom method introduced by earlier `add()` calls).
   * @param path - Origin-form pathname starting with `/`. May contain
   *   `:name`, `:name?`, `:name(regex)`, `*name`, and `*name+` syntax;
   *   see the README for full pattern reference.
   * @param value - Value to associate with the route. Surfaced as
   *   {@link MatchOutput.value} on a match.
   * @throws {RouterError} `kind: 'router-sealed'` if called after `build()`.
   */
  readonly add: (method: string | readonly string[], path: string, value: T) => void;
  /**
   * Queue multiple routes at once. Behaves like a loop of `add()`
   * calls with shared error context. Validation is deferred to
   * `build()`.
   *
   * @param entries - Array of `[method, path, value]` triples.
   * @throws {RouterError} `kind: 'router-sealed'` if called after `build()`.
   */
  readonly addAll: (entries: ReadonlyArray<readonly [string, string, T]>) => void;
  /**
   * Seal the router and emit the specialized match function. Required
   * before `match()` can return anything but `null`. Returns `this`.
   * The second and subsequent calls are no-ops.
   *
   * Build-time failures across multiple routes are aggregated into a
   * single `RouterError({ kind: 'route-validation', errors: [...] })`
   * rather than thrown one by one.
   *
   * @throws {RouterError} On the first per-route failure encountered,
   *   or `kind: 'route-validation'` for aggregated failures, or any
   *   options-validation error surfaced during sealing.
   */
  readonly build: () => RouterPublicApi<T>;
  /**
   * Match a URL against the registered routes.
   *
   * @param method - HTTP method.
   * @param path - Origin-form pathname (RFC 7230 §5.3.1).
   *   `match()` does not normalize the input — pass the form
   *   produced by `new URL(request.url).pathname`. Param values are
   *   percent-decoded; wildcard captures are returned raw. Malformed
   *   `%xx` inside a captured param slot propagates a `URIError`.
   * @returns A {@link MatchOutput} on a hit, or `null` on a miss
   *   (no route, wrong method, or `build()` not yet called).
   */
  match: (method: string, path: string) => MatchOutput<T> | null;
  /**
   * List the HTTP methods registered for `path`. Used by HTTP
   * adapters to disambiguate `404` (no routes for the path) from
   * `405` (the path exists but not for this method).
   *
   * Walks every registered method's tree, so it is meaningfully
   * slower than `match()` — only call it after `match()` returns
   * `null`. Never call on a hot match path.
   *
   * @param path - Origin-form pathname.
   * @returns A frozen array of method names, possibly empty.
   */
  allowedMethods: (path: string) => readonly string[];

  /**
   * @param options - Optional configuration; see {@link RouterOptions}.
   * @throws {RouterError} `kind: 'router-options-invalid'` if a value
   *   in `options` is out of range (e.g. negative `cacheSize`).
   */
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
      this.match = built.matchImpl;
      this.allowedMethods = path => built.matchLayer.allowedMethods(path);
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
      return this;
    };

    this.match = () => null;
    this.allowedMethods = () => EMPTY_METHODS;
  }
}

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

  for (let i = 0; i < r.activeMethodCodes.length; i++) {
    const code = r.activeMethodCodes[i]![1];
    if (cache.hit[code] === undefined) {
      cache.hit[code] = new RouterCache(cache.maxSize);
    }
  }

  const matchImpl = compileMatchFn<T>(buildMatchConfig(snapshot, r, cache, hasAnyStatic));
  optimizeNextInvocation(matchImpl);
  const matchLayer = new MatchLayer({
    normalizePath: r.normalizePath,
    matchState: r.matchState,
    activeMethodCodes: r.activeMethodCodes,
    trees: r.trees,
    staticPathMethodMask: r.staticPathMethodMask,
  });

  Object.freeze(snapshot.segmentTrees);
  Object.freeze(snapshot.staticByMethod);
  Object.freeze(r.activeMethodCodes);

  Bun.gc(true);

  return { matchImpl, matchLayer };
}

function buildMatchConfig<T>(
  snapshot: ReturnType<Registration<T>['seal']>,
  r: ReturnType<typeof buildFromRegistration<T>>,
  cache: CacheContainers<T>,
  hasAnyStatic: boolean,
): MatchConfig<T> {
  const activeMethodMask = new Int32Array(32);
  for (let i = 0; i < r.activeMethodCodes.length; i++) {
    activeMethodMask[r.activeMethodCodes[i]![1]] = 1;
  }

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
