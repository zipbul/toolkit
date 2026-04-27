import type { HttpMethod } from '@zipbul/shared';
import type { Result } from '@zipbul/result';
import type {
  MatchMeta,
  MatchOutput,
  RegexSafetyOptions,
  RouteParams,
  RouterErrData,
  RouterOptions,
} from './types';
import type { RadixMatchFn } from './matcher/radix-matcher';
import type { MatchState } from './matcher/match-state';
import type { BuilderConfig } from './builder/types';

import { err, isErr } from '@zipbul/result';
import { RouterError } from './error';
import { PathParser } from './builder/path-parser';
import { RadixBuilder } from './builder/radix-builder';
import { OptionalParamDefaults } from './builder/optional-param-defaults';
import { RouterCache } from './cache';
import { MethodRegistry } from './method-registry';
import { buildDecoder } from './processor/decoder';
import { createRadixWalker } from './matcher/radix-walk';
import { createMatchState } from './matcher/match-state';
import { createSegmentNode, insertIntoSegmentTree } from './matcher/segment-tree';
import type { SegmentNode } from './matcher/segment-tree';
import { createSegmentWalker, detectWildCodegenSpec } from './matcher/segment-walk';
import type { WildCodegenEntry } from './matcher/segment-walk';
import type { PathPart } from './builder/path-parser';
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

interface CachedMatchEntry<T> {
  value: T;
  params: RouteParams;
}

export class Router<T = unknown> {
  private readonly options: RouterOptions;
  private pathParser: PathParser | null;
  private radixBuilder: RadixBuilder | null;
  private readonly methodRegistry = new MethodRegistry();

  private _ignoreTrailingSlash = true;
  private _caseSensitive = true;
  private _maxPathLength = 2048;
  private _maxSegmentLength = 256;
  private hitCacheByMethod: Map<number, RouterCache<CachedMatchEntry<T>>> | undefined;
  private missCacheByMethod: Map<number, Set<string>> | undefined;
  private cacheMaxSize: number = 1000;
  private sealed = false;

  private handlers: T[] = [];
  private optionalParamDefaults: OptionalParamDefaults | undefined;
  private trees: Array<RadixMatchFn | null> = [];
  /** Per-method wildcard codegen entries when the segment tree is a pure
   *  static-prefix wildcard pattern (e.g. file-server style). When all
   *  per-router conditions allow it, compileMatchFn emits a fully specialized
   *  matchImpl that inlines these probes and skips the generic pipeline —
   *  shape-tailored codegen lets JSC FTL the entire match path. */
  private wildSpecs: Array<WildCodegenEntry[] | null> = [];
  /** True when every method's tree uses the segment walker (params written
   *  directly into state.params). False when any method falls back to the
   *  array-based radix walker. */
  private allSegmentTrees = true;
  /** True when at least one route has a regex pattern. When false, the
   *  TIMEOUT signalling path is dead — match() can skip errorKind reset. */
  private anyTester = false;
  /** Per-method registered routes — used to build the segment tree at seal. */
  private readonly routeRecords: Array<{ methodCode: number; parts: PathPart[]; handlerIndex: number }> = [];
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

    const buildConfig: BuilderConfig = {
      regexSafety,
      optionalParamDefaults: new OptionalParamDefaults(options.optionalParamBehavior),
    };

    if (options.regexAnchorPolicy !== undefined) {
      buildConfig.regexAnchorPolicy = options.regexAnchorPolicy;
    }

    if (options.onWarn !== undefined) {
      buildConfig.onWarn = options.onWarn;
    }

    this.pathParser = new PathParser({
      caseSensitive: options.caseSensitive ?? true,
      ignoreTrailingSlash: options.ignoreTrailingSlash ?? true,
      maxSegmentLength: options.maxSegmentLength ?? 256,
      regexSafety,
      regexAnchorPolicy: options.regexAnchorPolicy,
      onWarn: options.onWarn,
    });

    this.radixBuilder = new RadixBuilder(buildConfig);
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

    this.optionalParamDefaults = this.radixBuilder!.optionalParamDefaults;

    const decoder = buildDecoder();
    const decodeParams = this.options.decodeParams ?? true;

    // Build one segment tree per method, seeded from the raw registered parts
    // (not the LCP-compressed radix tree — walking that would conflate
    // partial-segment splits with real segment boundaries).
    const segmentTrees: Array<SegmentNode | null> = [];
    const segmentBuildOk: boolean[] = [];
    const testerCache = new Map<string, PatternTesterFn>();

    for (const rec of this.routeRecords) {
      if (segmentTrees[rec.methodCode] === undefined) {
        segmentTrees[rec.methodCode] = createSegmentNode();
        segmentBuildOk[rec.methodCode] = true;
      }

      if (!segmentBuildOk[rec.methodCode]) continue;

      // Re-expand optional params the same way the radix insert did. We use
      // the radixBuilder's expansion helper to stay consistent.
      const expansions = this.radixBuilder!.expandOptionalPublic(rec.parts, rec.handlerIndex);

      for (const { parts: expParts, handlerIndex: hIdx } of expansions) {
        const ok = insertIntoSegmentTree(
          segmentTrees[rec.methodCode]!,
          expParts,
          hIdx,
          this.options.regexSafety,
          testerCache,
        );

        if (!ok) {
          segmentBuildOk[rec.methodCode] = false;
          break;
        }
      }
    }

    let allSegment = true;

    for (const [, code] of allCodes) {
      const segRoot = segmentTrees[code];

      if (segRoot !== undefined && segRoot !== null && segmentBuildOk[code]) {
        // Detect static-prefix wildcard shape — when the entire router shape
        // satisfies certain conditions (single method, no statics, etc.),
        // compileMatchFn will inline these probes directly into matchImpl.
        this.wildSpecs[code] = detectWildCodegenSpec(segRoot);
        this.trees[code] = createSegmentWalker(segRoot, decoder, decodeParams);
        continue;
      }

      this.wildSpecs[code] = null;

      const root = this.radixBuilder!.getRoot(code);

      if (!root) {
        this.trees[code] = null;
        continue;
      }

      // At least one method falls back to radix walker; compileMatchFn must
      // emit the array-based params build path that radix walkers expect.
      allSegment = false;
      const testers = this.radixBuilder!.getTesters(code);
      this.trees[code] = createRadixWalker(root, testers, decoder, decodeParams);
    }

    this.allSegmentTrees = allSegment;
    this.anyTester = testerCache.size > 0;

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
    this.radixBuilder = null;

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
    const useCache = this.hitCacheByMethod !== undefined;
    const trimSlash = this._ignoreTrailingSlash;
    const lowerCase = !this._caseSensitive;
    const maxPathLen = this._maxPathLength;
    const maxSegLen = this._maxSegmentLength;
    const checkPathLen = Number.isFinite(maxPathLen);
    const checkSegLen = Number.isFinite(maxSegLen);

    const hasAnyTree = this.trees.some(t => t != null);
    // True only when at least one route registered `:name?` optional params.
    // The OptionalParamDefaults instance is always constructed, so a defined
    // check would always be true and force the dead-branch into hot codegen.
    const hasOptDefaults = this.optionalParamDefaults !== undefined
      && !this.optionalParamDefaults.isEmpty();
    const allSegment = this.allSegmentTrees;
    const anyTester = this.anyTester;
    // When no static routes are registered, the staticOutputs probe is dead
    // weight on every dynamic call — skip emitting it entirely. Saves 1-2 ns
    // on routers that are pure wildcard/param (e.g. file servers).
    let hasAnyStatic = false;
    for (const bucket of this.staticOutputsByMethod) {
      if (bucket !== undefined) { hasAnyStatic = true; break; }
    }

    // Closure captures (all read-only at match time)
    const staticOutputsByMethod = this.staticOutputsByMethod;
    const staticMap = this.staticMap;
    const methodCodes = this.methodCodes;
    const trees = this.trees;
    const matchState = this.matchState;
    const handlers = this.handlers;
    const optDefaults = this.optionalParamDefaults;
    const hitCacheByMethod = this.hitCacheByMethod;
    const missCacheByMethod = this.missCacheByMethod;
    const cacheMaxSize = this.cacheMaxSize;
    const RouterCacheCtor = RouterCache;
    const ParamsCtor = NullProtoObj;

    // ───────────────────────────────────────────────────────────────────
    // Shape-specialized fast path: pure static-prefix wildcard router.
    //
    // When the router is single-method, has zero static routes, no cache, no
    // opt-defaults, no regex testers, no case folding, and the only tree is a
    // static-prefix wildcard pattern (file server / asset CDN style), emit a
    // tiny matchImpl that directly returns MatchOutput. This skips:
    //   - method-code translation (replaced with literal === check)
    //   - staticOutputs probe (no statics → dead branch)
    //   - tree dispatch + tr() function call
    //   - new ParamsCtor() + matchState.params write
    //   - matchState.handlerIndex round-trip + handlers[] indirection
    //
    // Result: a function small enough for JSC FTL to compile aggressively,
    // matching memoirist's tight `find()` cost profile.
    // ───────────────────────────────────────────────────────────────────
    const singleMethodWild = (() => {
      if (hasAnyStatic) return null;
      if (useCache) return null;
      if (hasOptDefaults) return null;
      if (anyTester) return null;
      if (lowerCase) return null;
      if (!allSegment) return null;

      // Single-method gate. `activeMethodCodes` was filtered at build()
      // to only methods that actually received routes (skip the six
      // pre-registered-but-unused default verbs). One entry = single
      // active method.
      if (this.activeMethodCodes.length !== 1) return null;

      const [activeMethod, activeCode] = this.activeMethodCodes[0]!;

      // wild specialization needs a tree; static-only methods have no tree
      // and shouldn't reach here (hasAnyStatic gate would already exclude).
      if (this.trees[activeCode] == null) return null;

      const wild = this.wildSpecs[activeCode];

      if (wild === null || wild === undefined) return null;

      // Specialization emits one or two `startsWith` probes per prefix.
      // Past ~8 prefixes the sequential dispatch loses to the segment-tree
      // walker's O(1) NullProtoObj lookup — measured at 50 prefixes the
      // inline path is ~5× slower than the walker. Cap so file-server style
      // routers (≤8 prefixes) still get the inline win, but large prefix
      // sets fall back to the walker (which the segment-tree codegen will
      // turn into a `compiledWildWalk` with the same NullProtoObj keying
      // memoirist uses).
      if (wild.length > 8) return null;

      return { method: activeMethod, entries: wild };
    })();

    if (singleMethodWild !== null) {
      const { method: theMethod, entries: wildEntries } = singleMethodWild;
      const lines: string[] = [];

      if (checkPathLen) lines.push(`if (path.length > ${maxPathLen}) return null;`);
      lines.push(`if (method !== ${JSON.stringify(theMethod)}) return null;`);
      lines.push(`var sp = path;`);
      lines.push(`var qi = sp.indexOf('?'); if (qi !== -1) sp = sp.substring(0, qi);`);

      if (trimSlash) {
        lines.push(`if (sp.length > 1 && sp.charCodeAt(sp.length - 1) === 47) sp = sp.substring(0, sp.length - 1);`);
      }

      if (checkSegLen) {
        lines.push(`
          if (sp.length > ${maxSegLen}) {
            for (var i = 1, sl = 0, ml = ${maxSegLen}; i < sp.length; i++) {
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
          // /prefix (no trailing slash) → empty capture
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

      return tinyFactory(handlers, DYNAMIC_META) as (method: string, path: string) => MatchOutput<T> | null;
    }

    const src: string[] = [];

    if (checkPathLen) src.push(`if (path.length > ${maxPathLen}) return null;`);

    // Single-method optimization. methodCodes always holds all 7 default
    // verbs (MethodRegistry pre-registers them in its constructor), so
    // `allCodeEntries.length === 1` is never true. The signal we want is
    // Active-method count: shared with shape-specialization gate.
    // `activeMethodCodes` was filtered at build() to only methods that
    // actually received routes (tree OR static).
    const activeMethodCount = this.activeMethodCodes.length;
    const activeMethodLiteral = activeMethodCount === 1 ? this.activeMethodCodes[0]![0] : null;
    const activeMethodCode = activeMethodCount === 1 ? this.activeMethodCodes[0]![1] : -1;

    if (activeMethodCount === 1 && activeMethodLiteral !== null) {
      src.push(`if (method !== ${JSON.stringify(activeMethodLiteral)}) return null;`);
      src.push(`var mc = ${activeMethodCode};`);
    } else {
      src.push(`var mc = methodCodes[method]; if (mc === undefined) return null;`);
    }
    src.push(`var sp = path;`);
    src.push(`var qi = sp.indexOf('?'); if (qi !== -1) sp = sp.substring(0, qi);`);

    if (trimSlash) {
      src.push(`if (sp.length > 1 && sp.charCodeAt(sp.length - 1) === 47) sp = sp.substring(0, sp.length - 1);`);
    }

    if (lowerCase) src.push(`sp = sp.toLowerCase();`);

    // Static lookup — always first, always inlined.
    // Pre-built (frozen) MatchOutput is returned directly to skip the per-call
    // `{ value, params, meta }` allocation.
    // Skipped entirely when no static routes are registered (e.g. file-server
    // routers that are pure wildcard) — every cycle counts on the dynamic path.
    if (hasAnyStatic) {
      // Single-method case: closure-capture the resolved bucket directly so
      // the emitted code does ONE property access (`activeBucket[sp]`)
      // instead of two (`staticOutputsByMethod[mc][sp]`). Measured: 12.9ns
      // → 8-9ns at 500 routes, closing most of the gap to rou3's 6.4ns.
      // Multi-method case keeps the dynamic methodCode-indexed access.
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

    // Cache lookup — fully inlined (no bound-method indirection)
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

    if (!hasAnyTree) {
      if (useCache) {
        src.push(emitMissCacheWrite());
      }

      src.push(`return null;`);
    } else {
      if (checkSegLen) {
        // Fast path: a path shorter than maxSegLen cannot possibly contain a
        // segment that exceeds it, so the per-char scan is skipped entirely.
        src.push(`
          if (sp.length > ${maxSegLen}) {
            for (var i = 1, sl = 0, ml = ${maxSegLen}; i < sp.length; i++) {
              if (sp.charCodeAt(i) === 47) { sl = 0; }
              else { sl++; if (sl > ml) return null; }
            }
          }
        `);
      }

      if (allSegment) {
        // Segment walker writes params directly into matchState.params; we
        // pre-allocate it here and the walker mutates on the success-return
        // path only (no commit/rollback dance).
        // errorKind/errorMessage reset is skipped when no route has a regex
        // pattern — TIMEOUT path is dead so the channel never gets dirty.
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
      } else {
        // Radix walker writes to paramNames/paramValues arrays; build params here.
        src.push(`
          var tr = trees[mc];
          if (!tr) {
            ${useCache ? emitMissCacheWrite() : ''}
            return null;
          }
          matchState.handlerIndex = -1;
          matchState.paramCount = 0;
          matchState.errorKind = null;
          matchState.errorMessage = null;
          var ok = tr(sp, matchState);
          if (!ok) {
            ${useCache ? `if (matchState.errorKind === null) { ${emitMissCacheWrite()} }` : ''}
            return null;
          }
        `);

        if (hasOptDefaults) {
          src.push(`
            var nd = optDefaults !== undefined && optDefaults.has(matchState.handlerIndex);
            var params;
            if (matchState.paramCount === 0 && !nd) { params = EMPTY_PARAMS; }
            else {
              params = new ParamsCtor();
              for (var pi = 0; pi < matchState.paramCount; pi++) {
                params[matchState.paramNames[pi]] = matchState.paramValues[pi];
              }
              if (nd) optDefaults.apply(matchState.handlerIndex, params);
            }
          `);
        } else {
          src.push(`
            var params;
            if (matchState.paramCount === 0) { params = EMPTY_PARAMS; }
            else {
              params = new ParamsCtor();
              for (var pi = 0; pi < matchState.paramCount; pi++) {
                params[matchState.paramNames[pi]] = matchState.paramValues[pi];
              }
            }
          `);
        }
      }

      src.push(`
        var val = handlers[matchState.handlerIndex];
      `);

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

    // Resolve the active bucket once for single-method routers so the emitted
    // code has a closure-captured reference (no per-call indexed access into
    // staticOutputsByMethod).
    const activeBucket = activeMethodCount === 1
      ? (staticOutputsByMethod[activeMethodCode] ?? new NullProtoObj() as Record<string, MatchOutput<T>>)
      : new NullProtoObj() as Record<string, MatchOutput<T>>;

    const body = src.join('\n');
    const factory = new Function(
      'staticOutputsByMethod', 'activeBucket', 'staticMap', 'methodCodes', 'trees', 'matchState', 'handlers',
      'optDefaults', 'hitCacheByMethod', 'missCacheByMethod', 'RouterCacheCtor',
      'EMPTY_PARAMS', 'STATIC_META', 'CACHE_META', 'DYNAMIC_META', 'ParamsCtor',
      `return function match(method, path) {\n${body}\n};`,
    );

    return factory(
      staticOutputsByMethod, activeBucket, staticMap, methodCodes, trees, matchState, handlers,
      optDefaults, hitCacheByMethod, missCacheByMethod, RouterCacheCtor,
      EMPTY_PARAMS, STATIC_META, CACHE_META, DYNAMIC_META, ParamsCtor,
    ) as (method: string, path: string) => MatchOutput<T> | null;

    function emitMissCacheWrite(): string {
      return `
        var ms = missCacheByMethod.get(mc);
        if (ms === undefined) { ms = new Set(); missCacheByMethod.set(mc, ms); }
        if (ms.size >= ${cacheMaxSize}) {
          var oldest = ms.values().next().value;
          if (oldest !== undefined) ms.delete(oldest);
        }
        ms.add(sp);
      `;
    }
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
   * Path normalization shared with the codegen-emitted matchImpl logic.
   * Returns the normalized `sp` string for downstream lookup, or `null`
   * when the path violates `maxPathLength` or any segment exceeds
   * `maxSegmentLength`. **MUST stay semantically in sync with the inline
   * code emitted by `compileMatchFn`.** Tests in `allowed-methods.test.ts`
   * cover the option matrix and pin both implementations to the same
   * behavior — change one, change the other.
   */
  private normalizePathForLookup(path: string): string | null {
    if (Number.isFinite(this._maxPathLength) && path.length > this._maxPathLength) {
      return null;
    }

    let sp = path;
    const qi = sp.indexOf('?');

    if (qi !== -1) sp = sp.substring(0, qi);

    if (
      this._ignoreTrailingSlash
      && sp.length > 1
      && sp.charCodeAt(sp.length - 1) === 47
    ) {
      sp = sp.substring(0, sp.length - 1);
    }

    if (!this._caseSensitive) sp = sp.toLowerCase();

    if (Number.isFinite(this._maxSegmentLength) && sp.length > this._maxSegmentLength) {
      const ml = this._maxSegmentLength;
      let sl = 0;

      for (let i = 1; i < sp.length; i++) {
        if (sp.charCodeAt(i) === 47) {
          sl = 0;
        } else {
          sl++;

          if (sl > ml) return null;
        }
      }
    }

    return sp;
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

    const insertResult = this.radixBuilder!.insert(offsetResult, parts, handlerIndex);

    if (isErr(insertResult)) {
      // Roll back the handler slot so failed inserts do not leak storage.
      this.handlers.pop();

      return err<RouterErrData>({
        ...insertResult.data,
        path,
        method,
      });
    }

    // Record parts so seal() can build a segment tree from the original
    // (pre-LCP-split) route shape.
    this.routeRecords.push({ methodCode: offsetResult, parts, handlerIndex });
  }
}
