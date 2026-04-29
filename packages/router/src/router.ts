import type { HttpMethod } from '@zipbul/shared';
import type { MatchOutput, RegexSafetyOptions, RouterOptions } from './types';
import type { MatchFn, MatchState } from './matcher/match-state';
import type { PathNormalizer } from './matcher/path-normalize';
import type { SegmentNode } from './matcher/segment-tree';
import type { WildCodegenEntry } from './matcher/segment-walk';
import type { CacheEntry, MatchConfig } from './codegen/emitter';

import { OptionalParamDefaults } from './builder/optional-param-defaults';
import { PathParser } from './builder/path-parser';
import { RouterCache } from './cache';
import { compileMatchFn } from './codegen/emitter';
import { NullProtoObj } from './internal/null-proto-obj';
import { MethodRegistry } from './method-registry';
import { buildFromRegistration } from './pipeline/build';
import { MatchLayer } from './pipeline/match';
import { Registration } from './pipeline/registration';

export class Router<T = unknown> {
  private readonly options: RouterOptions;
  private readonly methodRegistry = new MethodRegistry();
  /** Owns the registration phase (add/addAll, conflict detection,
   *  segment-tree population). After build() seals it, the snapshot
   *  references are transferred to this Router for closure capture by
   *  the compiled matchImpl. */
  private readonly registration: Registration<T>;

  private ignoreTrailingSlash = true;
  private caseSensitive = true;
  private maxPathLength = 2048;
  private maxSegmentLength = 256;
  /** Compiled at seal time from the same emit helpers used by compileMatchFn,
   *  so the cold `allowedMethods` lookup cannot drift from the hot match path.
   *  Definite-assignment: pre-build access is blocked by `match()` /
   *  `allowedMethods()` checking `registration.isSealed()` first, so an
   *  identity-arrow fallback would be unreachable. */
  private normalizePath!: PathNormalizer;
  private hitCacheByMethod: Map<number, RouterCache<CacheEntry<T>>> | undefined;
  private missCacheByMethod: Map<number, Set<string>> | undefined;
  private cacheMaxSize: number = 1000;

  /** Snapshot fields populated from `registration.seal()` at build() time.
   *  They are kept on Router so the compiled matchImpl can closure-capture
   *  them directly — closures cannot reach through `this.registration.x`
   *  without paying a property-access tax on every match. */
  private handlers: T[] = [];
  private readonly optionalParamDefaults: OptionalParamDefaults;
  private trees: Array<MatchFn | null> = [];
  /** Per-method wildcard codegen entries when the segment tree is a pure
   *  static-prefix wildcard pattern (e.g. file-server style). When all
   *  per-router conditions allow it, compileMatchFn emits a fully specialized
   *  matchImpl that inlines these probes and skips the generic pipeline —
   *  shape-tailored codegen lets JSC FTL the entire match path. */
  private wildSpecs: Array<WildCodegenEntry[] | null> = [];
  /** True when at least one route has a regex pattern. When false, the
   *  TIMEOUT signalling path is dead — match() can skip errorKind reset. */
  private anyTester = false;
  private segmentTrees: Array<SegmentNode | null> = [];
  /** Specialized match closure assembled by compileMatchFn() at build time. */
  private matchImpl!: (method: string, path: string) => MatchOutput<T> | null;
  private matchState!: MatchState;

  /** Path → per-methodCode handler array. Owned by Registration during
   *  add(), transferred here at seal() time. */
  private staticMap: Record<string, Array<T | undefined>> = new NullProtoObj() as Record<string, Array<T | undefined>>;
  private staticRegistered: Record<string, boolean[]> = new NullProtoObj() as Record<string, boolean[]>;
  /** Pre-built MatchOutput indexed by [methodCode][path]. Layout chosen so
   *  the single-method-optimized matchImpl can closure-capture the inner
   *  bucket as a constant, collapsing the static lookup to a single
   *  property access. */
  private staticOutputsByMethod: Array<Record<string, MatchOutput<T>> | undefined> = [];
  /** Method name → numeric code. NullProtoObj for proto-free O(1) lookup. */
  private methodCodes: Record<string, number> = new NullProtoObj() as Record<string, number>;
  /** Methods that actually received at least one route registration (in
   *  declaration order). Cached at build() so `allowedMethods()` skips the
   *  six pre-registered-but-unused HTTP verbs without an Object.entries
   *  call per invocation. Tuple form keeps name+code together for the
   *  tight loop in allowedMethods. */
  private activeMethodCodes: ReadonlyArray<readonly [string, number]> = [];
  /** Runtime match layer — instantiated at the end of build() once
   *  matchImpl is compiled. `undefined` before build() means
   *  match()/allowedMethods() / clearCache() return null/[]/no-op. */
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
      { regexSafety },
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

    // Closing the registration phase transfers the accumulated state
    // (handlers / trees / static lookup tables) to this Router so the
    // compiled matchImpl can closure-capture them directly.
    const snapshot = this.registration.seal();
    this.handlers = snapshot.handlers;
    this.segmentTrees = snapshot.segmentTrees;
    this.staticMap = snapshot.staticMap;
    this.staticRegistered = snapshot.staticRegistered;

    // Compile the snapshot into runtime-ready tables (trees / static
    // outputs / activeMethodCodes / methodCodes / matchState /
    // normalizePath). The Build layer is a pure factory: it owns no
    // instance state, so its result is just a struct of references that
    // we transfer to this Router for closure capture by the matchImpl.
    const r = buildFromRegistration<T>(snapshot, this.options, this.methodRegistry);

    this.trees = r.trees;
    this.wildSpecs = r.wildSpecs;
    this.anyTester = r.anyTester;
    this.staticOutputsByMethod = r.staticOutputsByMethod;
    this.activeMethodCodes = r.activeMethodCodes;
    this.methodCodes = r.methodCodes;
    this.matchState = r.matchState;
    this.normalizePath = r.normalizePath;
    this.ignoreTrailingSlash = r.ignoreTrailingSlash;
    this.caseSensitive = r.caseSensitive;
    this.maxPathLength = r.maxPathLength;
    this.maxSegmentLength = r.maxSegmentLength;

    this.matchImpl = compileMatchFn<T>(this.collectMatchConfig());

    this.matchLayer = new MatchLayer<T>({
      normalizePath: this.normalizePath,
      matchState: this.matchState,
      activeMethodCodes: this.activeMethodCodes,
      staticOutputsByMethod: this.staticOutputsByMethod,
      trees: this.trees,
      hitCacheByMethod: this.hitCacheByMethod,
      missCacheByMethod: this.missCacheByMethod,
    });

    // Freeze build-only tables so post-build add/mutate cannot silently
    // drift state away from the compiled matchImpl. Hot-path tables
    // (`handlers`, `trees`, `staticOutputsByMethod`, `methodCodes`) are
    // *not* frozen — JSC inline caches degrade when match() reads from
    // frozen closure-captured objects in tight loops, costing ~5-10 ns
    // per dynamic match (verified via bench against bench/baseline).
    // Notably the emitted matchImpl reads `handlers[state.handlerIndex]`
    // on every dynamic hit. The hot-path tables are still protected
    // indirectly: nothing mutates them after build() because `sealed`
    // rejects every public code path that would.
    //
    // Cache containers (hit/missCacheByMethod) and matchState are
    // intentionally also excluded — they mutate per match().
    Object.freeze(this.segmentTrees);
    Object.freeze(this.wildSpecs);
    Object.freeze(this.staticMap);
    Object.freeze(this.staticRegistered);
    Object.freeze(this.activeMethodCodes);
    // wildcardNamesByMethod is owned by Registration and frozen there at
    // seal() time — this Router never reads it post-build.

    return this;
  }

  /** Build a `MatchConfig` from the router's current state for the
   *  codegen layer. Pure read — never mutates `this`. The cfg is
   *  consumed exactly once (compileMatchFn in `codegen/emitter.ts`) and
   *  then discarded. */
  private collectMatchConfig(): MatchConfig<T> {
    const useCache = this.hitCacheByMethod !== undefined;
    let hasAnyStatic = false;

    for (const bucket of this.staticOutputsByMethod) {
      if (bucket !== undefined) { hasAnyStatic = true; break; }
    }

    return {
      useCache,
      trimSlash: this.ignoreTrailingSlash,
      lowerCase: !this.caseSensitive,
      maxPathLen: this.maxPathLength,
      maxSegLen: this.maxSegmentLength,
      checkPathLen: Number.isFinite(this.maxPathLength),
      checkSegLen: Number.isFinite(this.maxSegmentLength),
      hasAnyTree: this.trees.some(t => t != null),
      hasOptDefaults: this.optionalParamDefaults !== undefined
        && !this.optionalParamDefaults.isEmpty(),
      anyTester: this.anyTester,
      hasAnyStatic,
      staticOutputsByMethod: this.staticOutputsByMethod,
      staticMap: this.staticMap,
      methodCodes: this.methodCodes,
      trees: this.trees,
      matchState: this.matchState,
      handlers: this.handlers,
      optDefaults: this.optionalParamDefaults,
      hitCacheByMethod: this.hitCacheByMethod,
      missCacheByMethod: this.missCacheByMethod,
      cacheMaxSize: this.cacheMaxSize,
      activeMethodCodes: this.activeMethodCodes,
      wildSpecs: this.wildSpecs,
    };
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
