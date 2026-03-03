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
import { createMatchState, resetMatchState } from './matcher/match-state';

const ALL_METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];

const EMPTY_PARAMS: RouteParams = Object.freeze({});
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
  private _decodeParams = true;
  private _maxPathLength = 2048;
  private _maxSegmentLength = 256;
  private hitCacheByMethod: Map<number, RouterCache<CachedMatchEntry<T>>> | undefined;
  private missCacheByMethod: Map<number, Set<string>> | undefined;
  private cacheMaxSize: number = 1000;
  private sealed = false;

  private handlers: T[] = [];
  private optionalParamDefaults: OptionalParamDefaults | undefined;
  private trees: Array<RadixMatchFn | null> = [];
  private matchState!: MatchState;

  private staticMap: Map<string, Array<T | undefined>> = new Map();
  private methodCodes: ReadonlyMap<string, number> = new Map();
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
    this.methodCodes = allCodes;

    this.optionalParamDefaults = this.radixBuilder!.optionalParamDefaults;

    const decoder = buildDecoder();
    const decodeParams = this.options.decodeParams ?? true;

    for (const [, code] of allCodes) {
      const root = this.radixBuilder!.getRoot(code);

      if (!root) {
        this.trees[code] = null;
        continue;
      }

      const testers = this.radixBuilder!.getTesters(code);
      this.trees[code] = createRadixWalker(root, testers, decoder, decodeParams);
    }

    this.matchState = createMatchState();

    this._ignoreTrailingSlash = this.options.ignoreTrailingSlash ?? true;
    this._caseSensitive = this.options.caseSensitive ?? true;
    this._decodeParams = this.options.decodeParams ?? true;
    this._maxPathLength = this.options.maxPathLength ?? 2048;
    this._maxSegmentLength = this.options.maxSegmentLength ?? 256;

    this.pathParser = null;
    this.radixBuilder = null;

    return this;
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
    if (!this.sealed) {
      throw new RouterError({
        kind: 'not-built',
        message: 'Router must be built before matching. Call build() first.',
        path,
        method,
        suggestion: 'Call router.build() after adding all routes',
      });
    }

    if (path.length > this._maxPathLength) {
      throw new RouterError({
        kind: 'path-too-long',
        message: `Path length (${path.length}) exceeds maxPathLength (${this._maxPathLength}).`,
        path,
        method,
        suggestion: `Shorten the path or increase maxPathLength in RouterOptions (current: ${this._maxPathLength}).`,
      });
    }

    // Inline resolveMethodCode — avoid function call + Result wrapping
    const methodCode = this.methodCodes.get(method);

    if (methodCode === undefined) {
      throw new RouterError({
        kind: 'method-not-found',
        message: `No routes registered for method '${method}'.`,
        method,
      });
    }

    const searchPath = this.preNormalize(path);

    // 1. Static match O(1)
    const staticHit = this.staticMap.get(searchPath)?.[methodCode];

    if (staticHit !== undefined) {
      return { value: staticHit, params: EMPTY_PARAMS, meta: STATIC_META };
    }

    // 2. Cache lookup
    const cached = this.lookupCache(searchPath, methodCode);

    if (cached !== undefined) {
      if (cached === null) {
        return null;
      }

      return { value: cached.value, params: cached.params, meta: CACHE_META };
    }

    // 3. Segment length validation
    if (!this.checkSegmentLengths(searchPath)) {
      throw new RouterError({
        kind: 'segment-limit',
        message: 'Segment length exceeds limit',
        path,
        method,
        suggestion: `Shorten the path segment to ${this._maxSegmentLength} characters or fewer.`,
      });
    }

    // 4. Radix trie match
    const tree = this.trees[methodCode];

    if (!tree) {
      this.writeCacheEntry(searchPath, methodCode, null);
      return null;
    }

    resetMatchState(this.matchState);
    const matched = tree(searchPath, 0, this.matchState);

    if (!matched) {
      if (this.matchState.errorKind) {
        throw new RouterError({
          kind: this.matchState.errorKind as any,
          message: this.matchState.errorMessage!,
          path,
          method,
        });
      }

      this.writeCacheEntry(searchPath, methodCode, null);
      return null;
    }

    // 5. Build result from match state
    const state = this.matchState;
    const params = this.buildParamsObject(state);

    this.optionalParamDefaults?.apply(state.handlerIndex, params);

    const value = this.handlers[state.handlerIndex];

    if (value === undefined) {
      return null;
    }

    this.writeCacheEntry(searchPath, methodCode, { value, params });

    return { value, params, meta: DYNAMIC_META };
  }

  private buildParamsObject(state: MatchState): RouteParams {
    const params: RouteParams = {};

    for (let i = 0; i < state.paramCount; i++) {
      params[state.paramNames[i]!] = state.paramValues[i]!;
    }

    return params;
  }

  /**
   * Validates that no path segment exceeds maxSegmentLength.
   * Returns true if valid, false if any segment is too long.
   */
  private checkSegmentLengths(path: string): boolean {
    const maxLen = this._maxSegmentLength;
    let segLen = 0;

    for (let i = 1; i < path.length; i++) {
      if (path.charCodeAt(i) === 47) { // '/'
        segLen = 0;
      } else {
        segLen++;

        if (segLen > maxLen) return false;
      }
    }

    return true;
  }

  // resolveMethodCode removed — inlined into match() for performance

  private preNormalize(path: string): string {
    let p = path;

    // Query string strip
    const qIdx = p.indexOf('?');

    if (qIdx !== -1) {
      p = p.substring(0, qIdx);
    }

    if (this._ignoreTrailingSlash && p.length > 1 && p.charCodeAt(p.length - 1) === 47) {
      p = p.substring(0, p.length - 1);
    }

    if (!this._caseSensitive) {
      p = p.toLowerCase();
    }

    return p;
  }

  private lookupCache(searchPath: string, methodCode: number): CachedMatchEntry<T> | null | undefined {
    if (!this.hitCacheByMethod) {
      return undefined;
    }

    // Check miss cache first (Set lookup is cheaper)
    const missSet = this.missCacheByMethod!.get(methodCode);

    if (missSet?.has(searchPath)) {
      return null;
    }

    // Check hit cache
    return this.hitCacheByMethod.get(methodCode)?.get(searchPath);
  }

  private writeCacheEntry(searchPath: string, methodCode: number, entry: CachedMatchEntry<T> | null): void {
    if (!this.hitCacheByMethod) {
      return;
    }

    if (entry) {
      let mc = this.hitCacheByMethod.get(methodCode);

      if (!mc) {
        mc = new RouterCache(this.cacheMaxSize);
        this.hitCacheByMethod.set(methodCode, mc);
      }

      mc.set(searchPath, {
        value: entry.value,
        params: { ...entry.params },
      });
    } else {
      let missSet = this.missCacheByMethod!.get(methodCode);

      if (!missSet) {
        missSet = new Set();
        this.missCacheByMethod!.set(methodCode, missSet);
      }

      // Bounded miss set: clear when full to prevent unbounded growth
      if (missSet.size >= this.cacheMaxSize) {
        missSet.clear();
      }

      missSet.add(searchPath);
    }
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

      let arr = this.staticMap.get(normalized);

      if (!arr) {
        arr = [];
        this.staticMap.set(normalized, arr);
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
      return err<RouterErrData>({
        ...insertResult.data,
        path,
        method,
      });
    }
  }
}
