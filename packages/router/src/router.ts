import type { HttpMethod } from '@zipbul/shared';
import type { Result } from '@zipbul/result';
import type {
  MatchMeta,
  MatchOutput,
  MatchPayload,
  RegexSafetyOptions,
  RouteParams,
  RouterErrData,
  RouterOptions,
} from './types';
import type { MatchFn } from './matcher/match-state';
import type { MatchState } from './matcher/match-state';

import { err, isErr } from '@zipbul/result';
import { RouterError } from './error';
import { PathParser } from './builder/path-parser';
import { OptionalParamDefaults } from './builder/optional-param-defaults';
import { expandOptional } from './builder/route-expand';
import { RouterCache } from './cache';
import { MethodRegistry } from './method-registry';
import { buildDecoder } from './matcher/decoder';
import { createMatchState } from './matcher/match-state';
import {
  buildPathNormalizer,
  emitLowerCase,
  emitPathLenCheck,
  emitQueryStrip,
  emitSegLenCheck,
  emitTrailingSlashTrim,
} from './matcher/path-normalize';
import type { NormalizeCfg, PathNormalizer } from './matcher/path-normalize';
import { createSegmentNode, insertIntoSegmentTree } from './matcher/segment-tree';
import type { SegmentNode } from './matcher/segment-tree';
import { createSegmentWalker, detectWildCodegenSpec } from './matcher/segment-walk';
import type { WildCodegenEntry } from './matcher/segment-walk';
import type { PatternTesterFn } from './types';

const ALL_METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];

// Prototype-less object constructor — `new NullProtoObj()` produces an object
// without Object.prototype lookups (~10-20% faster property access than {}).
// Pattern borrowed from rou3/unjs.
const NullProtoObj: { new (): Record<string, unknown> } = (() => {
  const F = function () {} as unknown as { new (): Record<string, unknown> };
  (F as unknown as { prototype: object }).prototype = Object.freeze(Object.create(null));
  return F;
})();

const EMPTY_PARAMS: RouteParams = Object.freeze(new NullProtoObj()) as RouteParams;
const STATIC_META: MatchMeta = Object.freeze({ source: 'static' } as const);
const CACHE_META: MatchMeta = Object.freeze({ source: 'cache' } as const);
const DYNAMIC_META: MatchMeta = Object.freeze({ source: 'dynamic' } as const);

/**
 * Snapshot of build-time flags + closure references used by the
 * matchImpl emitters. Built once at compile time by `collectMatchConfig`
 * and threaded through the per-shape emit methods. Splitting into a
 * config bag lets the emitters be standalone methods (no implicit
 * coupling to ~12 enclosing-function locals).
 */
interface MatchConfig<T> {
  readonly useCache: boolean;
  readonly trimSlash: boolean;
  readonly lowerCase: boolean;
  readonly maxPathLen: number;
  readonly maxSegLen: number;
  readonly checkPathLen: boolean;
  readonly checkSegLen: boolean;
  readonly hasAnyTree: boolean;
  readonly hasOptDefaults: boolean;
  readonly anyTester: boolean;
  readonly hasAnyStatic: boolean;
  readonly staticOutputsByMethod: Array<Record<string, MatchOutput<T>> | undefined>;
  readonly staticMap: Record<string, Array<T | undefined>>;
  readonly methodCodes: Record<string, number>;
  readonly trees: Array<MatchFn | null>;
  readonly matchState: MatchState;
  readonly handlers: T[];
  readonly optDefaults: OptionalParamDefaults | undefined;
  readonly hitCacheByMethod: Map<number, RouterCache<MatchPayload<T>>> | undefined;
  readonly missCacheByMethod: Map<number, Set<string>> | undefined;
  readonly cacheMaxSize: number;
}

export class Router<T = unknown> {
  private readonly options: RouterOptions;
  private pathParser: PathParser | null;
  private readonly methodRegistry = new MethodRegistry();

  private _ignoreTrailingSlash = true;
  private _caseSensitive = true;
  private _maxPathLength = 2048;
  private _maxSegmentLength = 256;
  /** Compiled at seal time from the same emit helpers used by compileMatchFn,
   *  so the cold `allowedMethods` lookup cannot drift from the hot match path.
   *  Identity normalizer (returns input unchanged) before build(). */
  private _normalizePath: PathNormalizer = path => path;
  private hitCacheByMethod: Map<number, RouterCache<MatchPayload<T>>> | undefined;
  private missCacheByMethod: Map<number, Set<string>> | undefined;
  private cacheMaxSize: number = 1000;
  private sealed = false;

  private handlers: T[] = [];
  private optionalParamDefaults: OptionalParamDefaults;
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
  /** Per-method segment-tree root, populated incrementally as add() is called. */
  private readonly segmentTrees: Array<SegmentNode | null> = [];
  /** Tester cache shared across registrations so identical regex patterns
   *  compile only once. Reset to empty after build() releases parser state. */
  private testerCache: Map<string, PatternTesterFn> = new Map();
  /** Specialized match closure assembled by compileMatchFn() at build time. */
  private matchImpl!: (method: string, path: string) => MatchOutput<T> | null;
  private matchState!: MatchState;

  /** Path → per-methodCode handler array. NullProtoObj for proto-free O(1) lookup.
   *  Slot value alone cannot distinguish "registered with undefined" from
   *  "not registered" — `staticRegistered` tracks the latter explicitly so
   *  callers can register `undefined` (or any value where T includes it)
   *  without it being silently treated as an empty slot. */
  private staticMap: Record<string, Array<T | undefined>> = new NullProtoObj() as Record<string, Array<T | undefined>>;
  /** Path → method codes that have actually been registered. Parallel to
   *  `staticMap`. Without this, `arr[mc] === undefined` ambiguously means
   *  either "not registered" or "registered with undefined value". */
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
  /** Track wildcard names per normalized prefix for cross-method conflict detection */
  private wildcardNames: Map<string, string> = new Map();

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

    this.pathParser = new PathParser({
      caseSensitive: options.caseSensitive ?? true,
      ignoreTrailingSlash: options.ignoreTrailingSlash ?? true,
      maxSegmentLength: options.maxSegmentLength ?? 256,
      regexSafety,
      regexAnchorPolicy: options.regexAnchorPolicy,
      onWarn: options.onWarn,
    });
  }

  add(method: HttpMethod | HttpMethod[] | '*', path: string, value: T): void {
    if (this.sealed) {
      throw new RouterError({
        kind: 'router-sealed',
        message: 'Cannot add routes after build(). The router is sealed.',
        path,
        method: Array.isArray(method) ? method[0] : method,
        suggestion: 'Create a new Router instance to add more routes',
      });
    }

    if (Array.isArray(method)) {
      for (const m of method) {
        const result = this.addOne(m, path, value);

        if (isErr(result)) {
          throw new RouterError(result.data);
        }
      }

      return;
    }

    if (method === '*') {
      for (const m of ALL_METHODS) {
        const result = this.addOne(m, path, value);

        if (isErr(result)) {
          throw new RouterError(result.data);
        }
      }

      return;
    }

    const result = this.addOne(method, path, value);

    if (isErr(result)) {
      throw new RouterError(result.data);
    }
  }

  addAll(entries: Array<[HttpMethod, string, T]>): void {
    if (this.sealed) {
      throw new RouterError({
        kind: 'router-sealed',
        message: 'Cannot add routes after build(). The router is sealed.',
        registeredCount: 0,
        suggestion: 'Create a new Router instance to add more routes',
      });
    }

    let registeredCount = 0;

    for (const [method, path, value] of entries) {
      const result = this.addOne(method, path, value);

      if (isErr(result)) {
        throw new RouterError({
          ...result.data,
          registeredCount,
        });
      }

      registeredCount++;
    }
  }

  build(): this {
    if (this.sealed) {
      return this;
    }

    this.sealed = true;

    const allCodes = this.methodRegistry.getAllCodes();
    const codes = new NullProtoObj() as Record<string, number>;

    for (const [m, c] of allCodes) codes[m] = c;
    this.methodCodes = codes;

    const decoder = buildDecoder();
    const decodeParams = this.options.decodeParams ?? true;

    // Per-method segment trees were built incrementally during add(); here we
    // just wire up walkers and detect specialized shapes per method.
    for (const [, code] of allCodes) {
      const segRoot = this.segmentTrees[code];

      if (segRoot !== undefined && segRoot !== null) {
        // Detect static-prefix wildcard shape — when the entire router shape
        // satisfies certain conditions (single method, no statics, etc.),
        // compileMatchFn will inline these probes directly into matchImpl.
        this.wildSpecs[code] = detectWildCodegenSpec(segRoot);
        this.trees[code] = createSegmentWalker(segRoot, decoder, decodeParams);
        continue;
      }

      this.wildSpecs[code] = null;
      this.trees[code] = null;
    }

    this.anyTester = this.testerCache.size > 0;

    // Pre-build the static MatchOutput objects so match() can return them
    // directly without allocating { value, params, meta } per hit.
    //
    // Layout: staticOutputs[methodCode] → NullProtoObj { path → MatchOutput }.
    // The compiled matchImpl indexes by methodCode first (constant under the
    // single-method optimization, so the outer access folds away at JIT
    // time) then by path. This is one fewer indirection than the previous
    // `staticOutputs[path][methodCode]` layout for routers that register
    // most paths under one verb (typical REST shapes).
    const staticOutputsByMethod: Array<Record<string, MatchOutput<T>> | undefined> = [];

    for (const path in this.staticMap) {
      const arr = this.staticMap[path]!;
      const registered = this.staticRegistered[path]!;

      for (let mc = 0; mc < arr.length; mc++) {
        if (!registered[mc]) continue;

        let bucket = staticOutputsByMethod[mc];

        if (bucket === undefined) {
          bucket = new NullProtoObj() as Record<string, MatchOutput<T>>;
          staticOutputsByMethod[mc] = bucket;
        }

        bucket[path] = Object.freeze({
          value: arr[mc] as T,
          params: EMPTY_PARAMS,
          meta: STATIC_META,
        }) as MatchOutput<T>;
      }
    }

    this.staticOutputsByMethod = staticOutputsByMethod;

    // Cache the methods that actually received routes — `allowedMethods()`
    // iterates this instead of Object.entries(methodCodes) to skip the
    // six unused default HTTP verbs without per-call allocation.
    const active: Array<readonly [string, number]> = [];

    for (const [name, code] of allCodes) {
      if (this.trees[code] != null || staticOutputsByMethod[code] !== undefined) {
        active.push([name, code]);
      }
    }

    this.activeMethodCodes = active;

    this.matchState = createMatchState();

    this._ignoreTrailingSlash = this.options.ignoreTrailingSlash ?? true;
    this._caseSensitive = this.options.caseSensitive ?? true;
    this._maxPathLength = this.options.maxPathLength ?? 2048;
    this._maxSegmentLength = this.options.maxSegmentLength ?? 256;

    this.pathParser = null;
    // Tester cache held per-route insert during add(); release after seal so
    // dev-mode swap-and-rebuild scenarios start fresh.
    this.testerCache = new Map();

    this._normalizePath = buildPathNormalizer({
      checkPathLen: Number.isFinite(this._maxPathLength),
      maxPathLen: this._maxPathLength,
      trimSlash: this._ignoreTrailingSlash,
      lowerCase: !this._caseSensitive,
      checkSegLen: Number.isFinite(this._maxSegmentLength),
      maxSegLen: this._maxSegmentLength,
    });

    this.matchImpl = this.compileMatchFn();

    return this;
  }

  /**
   * Compile a specialized match closure via `new Function()` based on the
   * router's actual config and registered routes. Dead code paths (disabled
   * cache, default case sensitivity, empty tree, no optional defaults, etc.)
   * are omitted entirely so the hot path only runs guards that can fire.
   *
   * Cache read/write is inlined (no bound-method call overhead). All helpers
   * used by the hot path are closure-captured, not `this.*`-dispatched.
   */
  private compileMatchFn(): (method: string, path: string) => MatchOutput<T> | null {
    const cfg = this.collectMatchConfig();
    const wild = this.detectSingleMethodWildSpec(cfg);

    if (wild !== null) {
      return this.emitSpecializedWildMatchImpl(cfg, wild);
    }

    return this.emitGenericMatchImpl(cfg);
  }

  /** Snapshot of build-time flags + closure-captured references that drive
   *  matchImpl emission. Built once in compileMatchFn and threaded through
   *  the per-shape emitters. */
  private collectMatchConfig(): MatchConfig<T> {
    const useCache = this.hitCacheByMethod !== undefined;
    let hasAnyStatic = false;

    for (const bucket of this.staticOutputsByMethod) {
      if (bucket !== undefined) { hasAnyStatic = true; break; }
    }

    return {
      useCache,
      trimSlash: this._ignoreTrailingSlash,
      lowerCase: !this._caseSensitive,
      maxPathLen: this._maxPathLength,
      maxSegLen: this._maxSegmentLength,
      checkPathLen: Number.isFinite(this._maxPathLength),
      checkSegLen: Number.isFinite(this._maxSegmentLength),
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
    };
  }

  /**
   * Shape-specialization gate: returns the wild entry list when this
   * router qualifies for the inline static-prefix wildcard fast path;
   * null otherwise. Conditions: single active method, no statics, no
   * cache, no opt-defaults, no testers, no case-fold, that method's tree
   * IS a static-prefix wildcard, prefix count ≤ 8.
   */
  private detectSingleMethodWildSpec(cfg: MatchConfig<T>): WildCodegenEntry[] | null {
    if (cfg.hasAnyStatic) return null;
    if (cfg.useCache) return null;
    if (cfg.hasOptDefaults) return null;
    if (cfg.anyTester) return null;
    if (cfg.lowerCase) return null;
    if (this.activeMethodCodes.length !== 1) return null;

    const [, activeCode] = this.activeMethodCodes[0]!;

    if (this.trees[activeCode] == null) return null;

    const wild = this.wildSpecs[activeCode];

    if (wild === null || wild === undefined) return null;
    // Past ~8 prefixes, the inline `startsWith` chain loses to the
    // segment-tree walker's NullProtoObj keying (5× slower at 50 prefixes
    // measured). Cap so file-server style routers (≤8 prefixes) still
    // get the inline win.
    if (wild.length > 8) return null;

    return wild;
  }

  /**
   * Emitter for the shape-specialized wildcard fast path.
   *
   * For pure static-prefix wildcard routers (file server / asset CDN),
   * emit a tiny matchImpl that returns MatchOutput directly. Skips
   * method-code translation, staticOutputs probe, tree dispatch + tr()
   * call, new ParamsCtor() + matchState.params write, and the
   * matchState.handlerIndex round-trip. The function is small enough
   * for JSC FTL to compile aggressively, matching memoirist's tight
   * `find()` cost profile.
   */
  private emitSpecializedWildMatchImpl(
    cfg: MatchConfig<T>,
    wildEntries: WildCodegenEntry[],
  ): (method: string, path: string) => MatchOutput<T> | null {
    const [theMethod] = this.activeMethodCodes[0]!;
    const lines: string[] = [];

    if (cfg.checkPathLen) lines.push(`if (path.length > ${cfg.maxPathLen}) return null;`);
    lines.push(`if (method !== ${JSON.stringify(theMethod)}) return null;`);
    lines.push(`var sp = path;`);
    lines.push(`var qi = sp.indexOf('?'); if (qi !== -1) sp = sp.substring(0, qi);`);

    if (cfg.trimSlash) {
      lines.push(`if (sp.length > 1 && sp.charCodeAt(sp.length - 1) === 47) sp = sp.substring(0, sp.length - 1);`);
    }

    if (cfg.checkSegLen) {
      lines.push(`
        if (sp.length > ${cfg.maxSegLen}) {
          for (var i = 1, sl = 0, ml = ${cfg.maxSegLen}; i < sp.length; i++) {
            if (sp.charCodeAt(i) === 47) { sl = 0; }
            else { sl++; if (sl > ml) return null; }
          }
        }`);
    }

    // Per-prefix probes. Use full-prefix `startsWith('/X/', 0)` to fold the
    // leading-slash check into the same call (one fewer charCodeAt branch).
    // Object literal `{ "name": ... }` (JSON-quoted key) lets JSC pin a
    // stable hidden class while remaining safe for any wildcard name —
    // path-parser permits names that aren't strict JS identifiers, so we
    // can't emit a bare-key literal.
    for (const e of wildEntries) {
      const fullPrefixSlash = '/' + e.prefix + '/';
      const fullPrefixSlashLen = fullPrefixSlash.length;
      const minLen = e.wildcardOrigin === 'multi' ? fullPrefixSlashLen + 1 : fullPrefixSlashLen;
      const sliceStart = fullPrefixSlashLen;
      const nameKey = JSON.stringify(e.wildcardName);

      lines.push(`
        if (sp.length >= ${minLen} && sp.startsWith(${JSON.stringify(fullPrefixSlash)}, 0)) {
          return { value: handlers[${e.wildcardStore}], params: { ${nameKey}: sp.substring(${sliceStart}) }, meta: DYNAMIC_META };
        }`);

      if (e.wildcardOrigin === 'star') {
        const fullPrefix = '/' + e.prefix;

        lines.push(`
        if (sp.length === ${fullPrefix.length} && sp === ${JSON.stringify(fullPrefix)}) {
          return { value: handlers[${e.wildcardStore}], params: { ${nameKey}: '' }, meta: DYNAMIC_META };
        }`);
      }
    }

    lines.push(`return null;`);

    const tinyBody = lines.join('\n');
    const tinyFactory = new Function(
      'handlers', 'DYNAMIC_META',
      `return function match(method, path) {\n${tinyBody}\n};`,
    );

    return tinyFactory(cfg.handlers, DYNAMIC_META) as (method: string, path: string) => MatchOutput<T> | null;
  }

  /**
   * Emitter for the generic matchImpl — every router that doesn't qualify
   * for the wildcard fast path. Assembles emit blocks based on `cfg`
   * flags so dead branches are omitted entirely:
   *
   *   1. method dispatch (single-method literal vs methodCodes lookup)
   *   2. path preprocessing (query strip, slash trim, lowercase)
   *   3. static lookup (closure-captured bucket vs methodCode-indexed)
   *   4. cache lookup (miss-set short-circuit + hit-cache return)
   *   5. dynamic match — segment walker (params written by walker)
   *      OR radix walker (params built from paramNames/paramValues)
   *   6. cache write + final MatchOutput return
   */
  private emitGenericMatchImpl(cfg: MatchConfig<T>): (method: string, path: string) => MatchOutput<T> | null {
    const activeMethodCount = this.activeMethodCodes.length;
    const activeMethodLiteral = activeMethodCount === 1 ? this.activeMethodCodes[0]![0] : null;
    const activeMethodCode = activeMethodCount === 1 ? this.activeMethodCodes[0]![1] : -1;
    const cacheMaxSize = cfg.cacheMaxSize;
    const useCache = cfg.useCache;
    const anyTester = cfg.anyTester;
    const hasOptDefaults = cfg.hasOptDefaults;

    const emitMissCacheWrite = (): string => `
      var ms = missCacheByMethod.get(mc);
      if (ms === undefined) { ms = new Set(); missCacheByMethod.set(mc, ms); }
      if (ms.size >= ${cacheMaxSize}) {
        var oldest = ms.values().next().value;
        if (oldest !== undefined) ms.delete(oldest);
      }
      ms.add(sp);
    `;

    const src: string[] = [];

    const normCfg: NormalizeCfg = cfg;
    const pathLenJs = emitPathLenCheck(normCfg, 'path', 'return null;');

    if (pathLenJs !== '') src.push(pathLenJs);

    if (activeMethodCount === 1 && activeMethodLiteral !== null) {
      src.push(`if (method !== ${JSON.stringify(activeMethodLiteral)}) return null;`);
      src.push(`var mc = ${activeMethodCode};`);
    } else {
      src.push(`var mc = methodCodes[method]; if (mc === undefined) return null;`);
    }

    src.push(emitQueryStrip('path', 'sp'));

    const trimJs = emitTrailingSlashTrim(normCfg, 'sp');

    if (trimJs !== '') src.push(trimJs);

    const lowerJs = emitLowerCase(normCfg, 'sp');

    if (lowerJs !== '') src.push(lowerJs);

    // Static lookup. Single-method case closure-captures the resolved
    // bucket (`activeBucket`) so the lookup collapses to one property
    // access; multi-method indexes by methodCode at runtime.
    if (cfg.hasAnyStatic) {
      if (activeMethodCount === 1) {
        src.push(`
          var out = activeBucket[sp];
          if (out !== undefined) return out;
        `);
      } else {
        src.push(`
          var bucket = staticOutputsByMethod[mc];
          if (bucket !== undefined) {
            var out = bucket[sp];
            if (out !== undefined) return out;
          }
        `);
      }
    }

    if (useCache) {
      src.push(`
        var missSet = missCacheByMethod.get(mc);
        if (missSet !== undefined && missSet.has(sp)) return null;
        var hitCache = hitCacheByMethod.get(mc);
        if (hitCache !== undefined) {
          var cached = hitCache.get(sp);
          if (cached !== undefined) {
            if (cached === null) return null;
            return { value: cached.value, params: cached.params, meta: CACHE_META };
          }
        }
      `);
    }

    if (!cfg.hasAnyTree) {
      if (useCache) src.push(emitMissCacheWrite());
      src.push(`return null;`);
    } else {
      // Per-segment length scan, deferred until after static lookup so
      // static cache hits skip it. Path shorter than maxSegLen cannot have
      // a segment that exceeds it — emitter elides the loop in that case.
      const segJs = emitSegLenCheck(normCfg, 'sp', 'return null;');

      if (segJs !== '') src.push(segJs);

      // Segment walker writes params directly into matchState.params on the
      // success-return path only (no commit/rollback). errorKind/errorMessage
      // reset is skipped when no route has a regex pattern — TIMEOUT path is
      // dead so the channel never gets dirty.
      src.push(`
        var tr = trees[mc];
        if (!tr) {
          ${useCache ? emitMissCacheWrite() : ''}
          return null;
        }
        ${anyTester ? 'matchState.errorKind = null; matchState.errorMessage = null;' : ''}
        var params = new ParamsCtor();
        matchState.params = params;
        var ok = tr(sp, matchState);
        if (!ok) {
          ${useCache ? (anyTester ? `if (matchState.errorKind === null) { ${emitMissCacheWrite()} }` : emitMissCacheWrite()) : ''}
          return null;
        }
      `);

      if (hasOptDefaults) {
        src.push(`
          if (optDefaults !== undefined && optDefaults.has(matchState.handlerIndex)) {
            optDefaults.apply(matchState.handlerIndex, params);
          }
        `);
      }

      src.push(`var val = handlers[matchState.handlerIndex];`);

      if (useCache) {
        src.push(`
          var hc = hitCacheByMethod.get(mc);
          if (hc === undefined) {
            hc = new RouterCacheCtor(${cacheMaxSize});
            hitCacheByMethod.set(mc, hc);
          }
          var cachedParams;
          if (params === EMPTY_PARAMS) { cachedParams = EMPTY_PARAMS; }
          else {
            cachedParams = new ParamsCtor();
            for (var cpk in params) cachedParams[cpk] = params[cpk];
          }
          hc.set(sp, { value: val, params: cachedParams });
        `);
      }

      src.push(`return { value: val, params: params, meta: DYNAMIC_META };`);
    }

    // Resolve the active bucket once for single-method routers so the
    // emitted code has a closure-captured reference (no per-call indexed
    // access into staticOutputsByMethod).
    const activeBucket = activeMethodCount === 1
      ? (cfg.staticOutputsByMethod[activeMethodCode] ?? new NullProtoObj() as Record<string, MatchOutput<T>>)
      : new NullProtoObj() as Record<string, MatchOutput<T>>;

    const body = src.join('\n');
    const factory = new Function(
      'staticOutputsByMethod', 'activeBucket', 'staticMap', 'methodCodes', 'trees', 'matchState', 'handlers',
      'optDefaults', 'hitCacheByMethod', 'missCacheByMethod', 'RouterCacheCtor',
      'EMPTY_PARAMS', 'STATIC_META', 'CACHE_META', 'DYNAMIC_META', 'ParamsCtor',
      `return function match(method, path) {\n${body}\n};`,
    );

    return factory(
      cfg.staticOutputsByMethod, activeBucket, cfg.staticMap, cfg.methodCodes, cfg.trees, cfg.matchState, cfg.handlers,
      cfg.optDefaults, cfg.hitCacheByMethod, cfg.missCacheByMethod, RouterCache,
      EMPTY_PARAMS, STATIC_META, CACHE_META, DYNAMIC_META, NullProtoObj,
    ) as (method: string, path: string) => MatchOutput<T> | null;
  }

  clearCache(): void {
    if (this.hitCacheByMethod) {
      for (const cache of this.hitCacheByMethod.values()) {
        cache.clear();
      }
    }

    if (this.missCacheByMethod) {
      for (const set of this.missCacheByMethod.values()) {
        set.clear();
      }
    }
  }

  match(method: HttpMethod, path: string): MatchOutput<T> | null {
    if (!this.sealed) return null;

    return this.matchImpl(method, path);
  }

  /**
   * Returns the HTTP methods registered for `path`. Cold-path companion to
   * `match()` — HTTP adapters call this only after `match()` returns null
   * to disambiguate "no route at all" from "wrong method on existing path".
   *
   *   const out = router.match(method, path);
   *   if (out !== null) return respond(out);
   *   const allowed = router.allowedMethods(path);
   *   if (allowed.length === 0) return respond404();
   *   return respond405(allowed);   // adapter shapes the 405/Allow header
   *
   * Cost profile:
   *   - Preprocessing (path-length / query strip / slash trim / case fold /
   *     seg-length scan) runs once via `normalizePathForLookup`.
   *   - Iteration is over `activeMethodCodes` only — the six pre-registered
   *     but unused default HTTP verbs are excluded at build time.
   *   - Per active method: O(1) static-map lookup; only when no static hit
   *     does the method's tree walker run (one call), reusing a single
   *     pre-allocated `state.params` across iterations.
   *   - matchImpl is never invoked — no duplicated preprocessing.
   */
  allowedMethods(path: string): HttpMethod[] {
    if (!this.sealed) return [];

    const sp = this.normalizePathForLookup(path);

    if (sp === null) return [];

    const out: HttpMethod[] = [];
    const state = this.matchState;
    // Tree walkers write into `state.params` on success. We never read the
    // params here — only the boolean return — so a single shared container
    // is enough. The next match() call reassigns state.params anyway.
    const sharedParams = new NullProtoObj() as Record<string, string | undefined>;

    state.params = sharedParams;

    const active = this.activeMethodCodes;

    for (let i = 0; i < active.length; i++) {
      const entry = active[i]!;
      const methodCode = entry[1];
      const bucket = this.staticOutputsByMethod[methodCode];

      if (bucket !== undefined && bucket[sp] !== undefined) {
        out.push(entry[0] as HttpMethod);
        continue;
      }

      const tr = this.trees[methodCode];

      if (tr === null || tr === undefined) continue;

      if (tr(sp, state)) {
        out.push(entry[0] as HttpMethod);
      }
    }

    return out;
  }

  /**
   * Path normalization for the cold-path `allowedMethods()` lookup. Returns
   * the normalized `sp` string for downstream lookup, or `null` when the
   * path violates `maxPathLength` or any segment exceeds `maxSegmentLength`.
   *
   * The normalizer body is compiled once at seal time from the *same* emit
   * helpers (`emitPathLenCheck` + `emitQueryStrip` + …) used by the hot
   * `compileMatchFn` codegen — so the two paths cannot drift in semantics
   * even if option handling changes. See `matcher/path-normalize.ts`.
   */
  private normalizePathForLookup(path: string): string | null {
    return this._normalizePath(path);
  }

  private checkWildcardNameConflict(
    parts: import('./builder/path-parser').PathPart[],
    normalized: string,
    method: string,
  ): Result<void, RouterErrData> {
    for (const part of parts) {
      if (part.type === 'wildcard') {
        // Build prefix key (path without wildcard)
        const prefix = normalized.replace(/\/[*:].*$/, '');
        const existing = this.wildcardNames.get(prefix);

        if (existing !== undefined && existing !== part.name) {
          return err<RouterErrData>({
            kind: 'route-conflict',
            message: `Wildcard '*${part.name}' conflicts with existing wildcard '*${existing}' at path prefix '${prefix}'`,
            segment: part.name,
            conflictsWith: existing,
            method,
          });
        }

        this.wildcardNames.set(prefix, part.name);
        break;
      }
    }
  }

  private checkStaticWildcardConflict(
    normalized: string,
    method: string,
  ): Result<void, RouterErrData> {
    // Check if any wildcard prefix is a parent of this static route
    for (const [prefix] of this.wildcardNames) {
      if (normalized.startsWith(prefix + '/') || normalized === prefix) {
        return err<RouterErrData>({
          kind: 'route-conflict',
          message: `Static route '${normalized}' conflicts with existing wildcard at '${prefix}/*'`,
          segment: normalized,
          method,
        });
      }
    }
  }

  private addOne(method: HttpMethod, path: string, value: T): Result<void, RouterErrData> {
    const offsetResult = this.methodRegistry.getOrCreate(method);

    if (isErr(offsetResult)) {
      return err<RouterErrData>({
        ...offsetResult.data,
        path,
      });
    }

    const parseResult = this.pathParser!.parse(path);

    if (isErr(parseResult)) {
      return err<RouterErrData>({
        ...parseResult.data,
        path,
        method,
      });
    }

    const { parts, normalized, isDynamic } = parseResult;

    // Check for wildcard name conflicts across methods
    const wcConflict = this.checkWildcardNameConflict(parts, normalized, method);

    if (isErr(wcConflict)) {
      return wcConflict;
    }

    // Check for static route conflicting with existing wildcard
    if (!isDynamic) {
      const wcBlockConflict = this.checkStaticWildcardConflict(normalized, method);

      if (isErr(wcBlockConflict)) {
        return wcBlockConflict;
      }

      let arr = this.staticMap[normalized];
      let registered = this.staticRegistered[normalized];

      if (!arr) {
        arr = [];
        registered = [];
        this.staticMap[normalized] = arr;
        this.staticRegistered[normalized] = registered;
      }

      if (registered![offsetResult]) {
        return err<RouterErrData>({
          kind: 'route-duplicate',
          message: `Route already exists for ${method} ${normalized}`,
          path,
          method,
          suggestion: 'Use a different path or HTTP method',
        });
      }

      arr[offsetResult] = value;
      registered![offsetResult] = true;
      return;
    }

    const handlerIndex = this.handlers.length;
    this.handlers.push(value);

    const expansion = expandOptional(parts, handlerIndex, this.optionalParamDefaults);

    if (isErr(expansion)) {
      this.handlers.pop();

      return err<RouterErrData>({ ...expansion.data, path, method });
    }

    if (this.segmentTrees[offsetResult] === undefined || this.segmentTrees[offsetResult] === null) {
      this.segmentTrees[offsetResult] = createSegmentNode();
    }

    const root = this.segmentTrees[offsetResult]!;

    for (const { parts: expParts, handlerIndex: hIdx } of expansion) {
      const insertResult = insertIntoSegmentTree(
        root,
        expParts,
        hIdx,
        this.options.regexSafety,
        this.testerCache,
      );

      if (isErr(insertResult)) {
        this.handlers.pop();

        return err<RouterErrData>({ ...insertResult.data, path, method });
      }
    }
  }
}
