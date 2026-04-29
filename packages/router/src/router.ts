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

export class Router<T = unknown> {
  private readonly options: RouterOptions;
  private readonly methodRegistry = new MethodRegistry();
  /** Owns the registration phase (add/addAll, conflict detection,
   *  segment-tree population). `seal()` returns the build snapshot. */
  private readonly registration: Registration<T>;
  private readonly optionalParamDefaults: OptionalParamDefaults;
  /** Cache containers — created in the constructor when
   *  `enableCache: true`. Lifetime spans add()/build()/match(), and the
   *  references are passed to both the codegen (closure capture) and
   *  MatchLayer (clearCache). */
  private hitCacheByMethod: Map<number, RouterCache<MatchCacheEntry<T>>> | undefined;
  private missCacheByMethod: Map<number, Set<string>> | undefined;
  private cacheMaxSize: number = 1000;

  /** Compiled match closure assembled by compileMatchFn() at build
   *  time. Read directly by `match()` — no MatchLayer indirection on
   *  the hot path (see B4 deviation note in REFACTOR.md). */
  private matchImpl!: (method: string, path: string) => MatchOutput<T> | null;
  /** Cold-path runtime layer — instantiated only when build() succeeds.
   *  Its `undefined` state doubles as the "router is built" sentinel
   *  for `match()` / `allowedMethods()` / `clearCache()`. */
  private matchLayer: MatchLayer<T> | undefined;

  constructor(options: RouterOptions = {}) {
    this.options = options;

    if (options.enableCache === true) {
      this.hitCacheByMethod = new Map();
      this.missCacheByMethod = new Map();
      this.cacheMaxSize = options.cacheSize ?? 1000;
    }

    const regexSafety: RegexSafetyOptions = {
      mode: options.regexSafety?.mode ?? 'error',
      maxLength: options.regexSafety?.maxLength ?? 256,
      forbidBacktrackingTokens: options.regexSafety?.forbidBacktrackingTokens ?? true,
      forbidBackreferences: options.regexSafety?.forbidBackreferences ?? true,
    };

    if (options.regexSafety?.maxExecutionMs !== undefined) {
      regexSafety.maxExecutionMs = options.regexSafety.maxExecutionMs;
    }

    if (options.regexSafety?.validator !== undefined) {
      regexSafety.validator = options.regexSafety.validator;
    }

    this.optionalParamDefaults = new OptionalParamDefaults(options.optionalParamBehavior);

    const pathParser = new PathParser({
      caseSensitive: options.caseSensitive ?? true,
      ignoreTrailingSlash: options.ignoreTrailingSlash ?? true,
      maxSegmentLength: options.maxSegmentLength ?? 256,
      regexSafety,
      regexAnchorPolicy: options.regexAnchorPolicy,
      onWarn: options.onWarn,
    });

    this.registration = new Registration<T>(
      regexSafety,
      this.methodRegistry,
      pathParser,
      this.optionalParamDefaults,
    );
  }

  add(method: HttpMethod | HttpMethod[] | '*', path: string, value: T): void {
    this.registration.add(method, path, value);
  }

  addAll(entries: Array<[HttpMethod, string, T]>): void {
    this.registration.addAll(entries);
  }

  build(): this {
    if (this.registration.isSealed()) {
      return this;
    }

    // Pipeline: seal registration → compile build outputs → assemble
    // codegen cfg → emit matchImpl → spin up cold-path MatchLayer.
    // None of the intermediate values need to live as Router fields:
    // the compiled matchImpl closure-captures every table it reads,
    // and MatchLayer holds its own refs. Router only retains the two
    // call-time entry points (`matchImpl`, `matchLayer`) plus what's
    // needed to reconstruct or guard add/build (`registration`,
    // `optionalParamDefaults`, the cache containers).
    const snapshot = this.registration.seal();
    const r = buildFromRegistration<T>(snapshot, this.options, this.methodRegistry);

    let hasAnyStatic = false;

    for (const bucket of r.staticOutputsByMethod) {
      if (bucket !== undefined) { hasAnyStatic = true; break; }
    }

    const cfg: MatchConfig<T> = {
      useCache: this.hitCacheByMethod !== undefined,
      trimSlash: r.ignoreTrailingSlash,
      lowerCase: !r.caseSensitive,
      maxPathLen: r.maxPathLength,
      maxSegLen: r.maxSegmentLength,
      checkPathLen: Number.isFinite(r.maxPathLength),
      checkSegLen: Number.isFinite(r.maxSegmentLength),
      hasAnyTree: r.trees.some(t => t != null),
      hasOptDefaults: !this.optionalParamDefaults.isEmpty(),
      anyTester: r.anyTester,
      hasAnyStatic,
      staticOutputsByMethod: r.staticOutputsByMethod,
      staticMap: snapshot.staticMap,
      methodCodes: r.methodCodes,
      trees: r.trees,
      matchState: r.matchState,
      handlers: snapshot.handlers,
      optDefaults: this.optionalParamDefaults,
      hitCacheByMethod: this.hitCacheByMethod,
      missCacheByMethod: this.missCacheByMethod,
      cacheMaxSize: this.cacheMaxSize,
      activeMethodCodes: r.activeMethodCodes,
      wildSpecs: r.wildSpecs,
    };

    this.matchImpl = compileMatchFn<T>(cfg);

    this.matchLayer = new MatchLayer<T>({
      normalizePath: r.normalizePath,
      matchState: r.matchState,
      activeMethodCodes: r.activeMethodCodes,
      staticOutputsByMethod: r.staticOutputsByMethod,
      trees: r.trees,
      hitCacheByMethod: this.hitCacheByMethod,
      missCacheByMethod: this.missCacheByMethod,
    });

    // Freeze build-only tables so post-build add/mutate cannot silently
    // drift state away from the compiled matchImpl. Hot-path tables
    // (`handlers`, `trees`, `staticOutputsByMethod`, `methodCodes`) are
    // *not* frozen — JSC inline caches degrade when match() reads from
    // frozen closure-captured objects in tight loops, costing ~5-10 ns
    // per dynamic match (verified via bench against bench/baseline).
    // The hot-path tables are still protected indirectly: nothing
    // mutates them after build() because `sealed` rejects every public
    // code path that would.
    //
    // Cache containers (hit/missCacheByMethod) and matchState are
    // intentionally also excluded — they mutate per match().
    Object.freeze(snapshot.segmentTrees);
    Object.freeze(snapshot.staticMap);
    Object.freeze(snapshot.staticRegistered);
    Object.freeze(r.wildSpecs);
    Object.freeze(r.activeMethodCodes);
    // wildcardNamesByMethod is owned by Registration and frozen there
    // at seal() time.

    return this;
  }


  /**
   * Hot-path: dispatch the compiled matchImpl. Returns null when called
   * before build() (matchImpl not yet compiled).
   *
   * **Important — kept on Router**: routing through `this.matchLayer.
   * match` adds a method-dispatch hop that breaks JSC's monomorphic IC
   * on the hot path (verified end-to-end against bench/baseline:
   * static match 300ps → 13ns, param match +5ns). MatchLayer owns the
   * cold-path concerns (allowedMethods + clearCache) only.
   */
  match(method: HttpMethod, path: string): MatchOutput<T> | null {
    if (this.matchLayer === undefined) return null;

    return this.matchImpl(method, path);
  }

  /**
   * Cold-path: returns the HTTP methods registered for `path`. Used by
   * HTTP adapters to disambiguate 404 vs 405 after match() returns null.
   * See `MatchLayer.allowedMethods` for the cost profile.
   */
  allowedMethods(path: string): HttpMethod[] {
    if (this.matchLayer === undefined) return [];

    return this.matchLayer.allowedMethods(path);
  }

  /** Clear hit + miss caches. No-op before build(). */
  clearCache(): void {
    this.matchLayer?.clearCache();
  }
}
