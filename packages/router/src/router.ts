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
import { createSegmentWalker } from './matcher/segment-walk';
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

const EMPTY_PARAMS: RouteParams = Object.freeze(Object.create(null));
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

  /** Path → per-methodCode handler array. NullProtoObj for proto-free O(1) lookup. */
  private staticMap: Record<string, Array<T | undefined>> = new NullProtoObj() as Record<string, Array<T | undefined>>;
  /** Pre-built MatchOutput per static (path, methodCode). Returned directly
   *  from match() — eliminates one object-literal allocation per static hit. */
  private staticOutputs: Record<string, Array<MatchOutput<T> | undefined>> = new NullProtoObj() as Record<string, Array<MatchOutput<T> | undefined>>;
  /** Method name → numeric code. NullProtoObj for proto-free O(1) lookup. */
  private methodCodes: Record<string, number> = new NullProtoObj() as Record<string, number>;
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
        this.trees[code] = createSegmentWalker(segRoot, decoder, decodeParams);
        continue;
      }

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

    // Pre-build the static MatchOutput objects so the match() hot path can
    // return them directly without allocating { value, params, meta } per hit.
    const staticOutputs = new NullProtoObj() as Record<string, Array<MatchOutput<T> | undefined>>;

    for (const path in this.staticMap) {
      const arr = this.staticMap[path]!;
      // JSC degrades arrays with holes via prototype-chain walks on access.
      // Build a packed array (no holes) by initializing all slots up-front.
      const outArr: Array<MatchOutput<T> | undefined> = [];

      for (let i = 0; i < arr.length; i++) {
        const value = arr[i];

        outArr.push(
          value === undefined
            ? undefined
            : Object.freeze({ value, params: EMPTY_PARAMS, meta: STATIC_META }) as MatchOutput<T>,
        );
      }

      staticOutputs[path] = outArr;
    }

    this.staticOutputs = staticOutputs;

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
    const hasOptDefaults = this.optionalParamDefaults !== undefined;
    const allSegment = this.allSegmentTrees;
    const anyTester = this.anyTester;

    // Closure captures (all read-only at match time)
    const staticOutputs = this.staticOutputs;
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

    const src: string[] = [];

    if (checkPathLen) src.push(`if (path.length > ${maxPathLen}) return null;`);

    // Single-method optimization: skip the full lookup when the router was
    // configured with exactly one HTTP method. We still verify the incoming
    // method matches that one — anything else is null.
    const allCodeEntries = Object.entries(this.methodCodes);

    if (allCodeEntries.length === 1) {
      const [theMethod, theCode] = allCodeEntries[0]!;

      src.push(`if (method !== ${JSON.stringify(theMethod)}) return null;`);
      src.push(`var mc = ${theCode};`);
    } else {
      src.push(`var mc = methodCodes[method]; if (mc === undefined) return null;`);
    }
    src.push(`var sp = path;`);
    src.push(`var qi = sp.indexOf('?'); if (qi !== -1) sp = sp.substring(0, qi);`);

    if (trimSlash) {
      src.push(`if (sp.length > 1 && sp.charCodeAt(sp.length - 1) === 47) sp = sp.substring(0, sp.length - 1);`);
    }

    if (lowerCase) src.push(`sp = sp.toLowerCase();`);

    // Static lookup — always first, always inlined
    // Static lookup returns a pre-built (frozen) MatchOutput so we skip the
    // per-call object literal allocation.
    src.push(`
      var so = staticOutputs[sp];
      if (so !== undefined) {
        var out = so[mc];
        if (out !== undefined) return out;
      }
    `);

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
          var params = Object.create(null);
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
              params = Object.create(null);
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
              params = Object.create(null);
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
            cachedParams = Object.create(null);
            for (var cpk in params) cachedParams[cpk] = params[cpk];
          }
          hc.set(sp, { value: val, params: cachedParams });
        `);
      }

      src.push(`return { value: val, params: params, meta: DYNAMIC_META };`);
    }

    const body = src.join('\n');
    const factory = new Function(
      'staticOutputs', 'staticMap', 'methodCodes', 'trees', 'matchState', 'handlers',
      'optDefaults', 'hitCacheByMethod', 'missCacheByMethod', 'RouterCacheCtor',
      'EMPTY_PARAMS', 'STATIC_META', 'CACHE_META', 'DYNAMIC_META',
      `return function match(method, path) {\n${body}\n};`,
    );

    return factory(
      staticOutputs, staticMap, methodCodes, trees, matchState, handlers,
      optDefaults, hitCacheByMethod, missCacheByMethod, RouterCacheCtor,
      EMPTY_PARAMS, STATIC_META, CACHE_META, DYNAMIC_META,
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

      if (!arr) {
        arr = [];
        this.staticMap[normalized] = arr;
      }

      if (arr[offsetResult] !== undefined) {
        return err<RouterErrData>({
          kind: 'route-duplicate',
          message: `Route already exists for ${method} ${normalized}`,
          path,
          method,
          suggestion: 'Use a different path or HTTP method',
        });
      }

      arr[offsetResult] = value;
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
