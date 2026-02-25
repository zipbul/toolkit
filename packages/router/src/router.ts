import type { HttpMethod } from '@zipbul/shared';
import type { Result } from '@zipbul/result';
import type {
  DynamicMatchResult,
  MatchMeta,
  MatchOutput,
  RegexSafetyOptions,
  RouterErrData,
  RouterOptions,
} from './types';

import { err, isErr } from '@zipbul/result';
import { Builder, OptionalParamDefaults, type BuilderConfig } from './builder';
import { RouterCache } from './cache';
import { Matcher } from './matcher';
import { buildPatternTester } from './matcher/pattern-tester';
import { MethodRegistry } from './method-registry';
import { Processor, type ProcessorConfig } from './processor';
import { METHOD_OFFSET } from './schema';

export class Router<T = unknown> {
  private readonly options: RouterOptions;
  private readonly processor: Processor;
  private builder: Builder<T> | null;
  private readonly methodRegistry = new MethodRegistry();
  private matcher: Matcher | null = null;
  private cacheByMethod: Map<number, RouterCache<DynamicMatchResult>> | undefined;
  private cacheMaxSize: number = 1000;
  private sealed = false;
  /** build() 후 builder에서 추출. trie는 GC 수거된다. */
  private handlers: T[] = [];
  private optionalParamDefaults: OptionalParamDefaults | undefined;

  private staticMap: Map<string, T[]> = new Map();
  private methodCodes: ReadonlyMap<string, number> = new Map();

  constructor(options: RouterOptions = {}) {
    this.options = options;

    const procConfig: ProcessorConfig = {
      collapseSlashes: options.collapseSlashes ?? true,
      ignoreTrailingSlash: options.ignoreTrailingSlash ?? true,
      blockTraversal: options.blockTraversal ?? true,
      caseSensitive: options.caseSensitive ?? true,
      maxSegmentLength: options.maxSegmentLength ?? 256,
      failFastOnBadEncoding: options.failFastOnBadEncoding ?? false,
    };

    this.processor = new Processor(procConfig);

    if (options.enableCache === true) {
      this.cacheByMethod = new Map();
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

    if (options.strictParamNames !== undefined) {
      buildConfig.strictParamNames = options.strictParamNames;
    }

    this.builder = new Builder<T>(buildConfig);
  }

  add(method: HttpMethod | HttpMethod[] | '*', path: string, value: T): Result<void, RouterErrData> {
    if (this.sealed) {
      return err<RouterErrData>({
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
          return result;
        }
      }

      return;
    }

    if (method === '*') {
      const allMethods: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];

      for (const m of allMethods) {
        const result = this.addOne(m, path, value);

        if (isErr(result)) {
          return result;
        }
      }

      return;
    }

    return this.addOne(method, path, value);
  }

  addAll(entries: Array<[HttpMethod, string, T]>): Result<void, RouterErrData> {
    if (this.sealed) {
      return err<RouterErrData>({
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
        return err<RouterErrData>({
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

    const b = this.builder!;
    this.handlers = b.handlers;
    this.optionalParamDefaults = b.config.optionalParamDefaults;

    const allCodes = this.methodRegistry.getAllCodes();
    this.methodCodes = allCodes;

    const layout = b.build(allCodes);
    const testers = layout.patterns.map(p => {
      if (!p.source) {
        return undefined;
      }

      const regex = new RegExp(`^(?:${p.source})$`, p.flags);

      return buildPatternTester(p.source, regex, undefined);
    });

    this.matcher = new Matcher(layout, {
      patternTesters: testers,
      encodedSlashBehavior: this.options.encodedSlashBehavior ?? 'decode',
      failFastOnBadEncoding: this.options.failFastOnBadEncoding ?? false,
      methodCodes: allCodes,
    });

    // trie 해제 — Matcher가 layout(binary)을 소유하므로 builder 참조 불필요
    this.builder = null;

    return this;
  }

  match(method: HttpMethod, path: string): Result<MatchOutput<T> | null, RouterErrData> {
    if (!this.sealed) {
      return err<RouterErrData>({
        kind: 'not-built',
        message: 'Router must be built before matching. Call build() first.',
        path,
        method,
        suggestion: 'Call router.build() after adding all routes',
      });
    }

    let searchPath = path;

    if (this.options.ignoreTrailingSlash === true && searchPath.length > 1 && searchPath.endsWith('/')) {
      searchPath = searchPath.slice(0, -1);
    }

    if (this.options.caseSensitive === false) {
      searchPath = searchPath.toLowerCase();
    }

    // Static fast-path: clean path starting with '/'
    if (searchPath.charCodeAt(0) === 47 /* '/' */) {
      const staticValues = this.staticMap.get(searchPath);

      if (staticValues) {
        const offset = this.methodCodes.get(method) ?? METHOD_OFFSET[method];

        if (offset !== undefined) {
          const value = staticValues[offset];

          if (value !== undefined) {
            return { value, params: {}, meta: { source: 'static' } };
          }
        }
      }
    }

    // Cache lookup
    if (this.cacheByMethod) {
      const methodCode = this.methodCodes.get(method) ?? METHOD_OFFSET[method];

      if (methodCode !== undefined) {
        const methodCache = this.cacheByMethod.get(methodCode);

        if (methodCache) {
          const cached = methodCache.get(searchPath);

          if (cached !== undefined) {
            if (cached === null) {
              return null;
            }

            const value = this.handlers[cached.handlerIndex];

            if (value === undefined) {
              return null;
            }

            return { value, params: { ...cached.params }, meta: { source: 'cache' } };
          }
        }
      }
    }

    const matcher = this.matcher;

    if (!matcher) {
      return null;
    }

    // Normalize path
    const normalizeResult = this.processor.normalize(searchPath);

    if (isErr(normalizeResult)) {
      return err<RouterErrData>({
        ...normalizeResult.data,
        path,
        method,
      });
    }

    const { segments, segmentDecodeHints, normalized } = normalizeResult;

    // Static fallback for normalized paths
    if (normalized !== searchPath) {
      const staticValues = this.staticMap.get(normalized);

      if (staticValues) {
        const offset = this.methodCodes.get(method) ?? METHOD_OFFSET[method];

        if (offset !== undefined) {
          const value = staticValues[offset];

          if (value !== undefined) {
            return { value, params: {}, meta: { source: 'static' } };
          }
        }
      }
    }

    // Dynamic match
    const matchResult = matcher.match(
      method,
      segments,
      normalized,
      segmentDecodeHints,
      this.options.decodeParams ?? true,
      false,
    );

    if (isErr(matchResult)) {
      return err<RouterErrData>({
        ...matchResult.data,
        path,
        method,
      });
    }

    if (matchResult) {
      const handlerIndex = matcher.getHandlerIndex();
      const params = matcher.getParams();
      const defaults = this.optionalParamDefaults;

      if (defaults) {
        defaults.apply(handlerIndex, params);
      }

      const value = this.handlers[handlerIndex];

      if (value === undefined) {
        return null;
      }

      const meta: MatchMeta = { source: 'dynamic' };

      if (this.cacheByMethod) {
        const methodCode = this.methodCodes.get(method) ?? METHOD_OFFSET[method];

        if (methodCode !== undefined) {
          let mc = this.cacheByMethod.get(methodCode);

          if (!mc) {
            mc = new RouterCache(this.cacheMaxSize);
            this.cacheByMethod.set(methodCode, mc);
          }

          mc.set(searchPath, {
            handlerIndex,
            params: { ...params },
          });
        }
      }

      return { value, params, meta };
    }

    // Cache miss
    if (this.cacheByMethod) {
      const methodCode = this.methodCodes.get(method) ?? METHOD_OFFSET[method];

      if (methodCode !== undefined) {
        let mc = this.cacheByMethod.get(methodCode);

        if (!mc) {
          mc = new RouterCache(this.cacheMaxSize);
          this.cacheByMethod.set(methodCode, mc);
        }

        mc.set(searchPath, null);
      }
    }

    return null;
  }

  private addOne(method: HttpMethod, path: string, value: T): Result<void, RouterErrData> {
    const offsetResult = this.methodRegistry.getOrCreate(method);

    if (isErr(offsetResult)) {
      return err<RouterErrData>({
        ...offsetResult.data,
        path,
      });
    }

    const normalizeResult = this.processor.normalize(path, false);

    if (isErr(normalizeResult)) {
      return err<RouterErrData>({
        ...normalizeResult.data,
        path,
        method,
      });
    }

    const { segments, normalized } = normalizeResult;

    let isDynamic = false;

    for (const segment of segments) {
      const firstChar = segment.charCodeAt(0);

      if (firstChar === 42 || firstChar === 58) {
        isDynamic = true;

        break;
      }
    }

    if (!isDynamic) {
      let values = this.staticMap.get(normalized);

      if (!values) {
        values = [];

        this.staticMap.set(normalized, values);
      }

      values[offsetResult] = value;
    }

    const addResult = this.builder!.add(method, segments, value);

    if (isErr(addResult)) {
      return err<RouterErrData>({
        ...addResult.data,
        path,
        method,
      });
    }
  }
}
