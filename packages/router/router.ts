import type { HttpMethod, MatchResult } from '../types';
import type { DynamicMatchResult, Handler, MatchResultMeta, RegexSafetyOptions, RouterOptions } from './types';

import { Builder, OptionalParamDefaults, type BuilderConfig } from './builder';
import { RouterCache } from './cache';
import { Matcher } from './matcher';
import { buildPatternTester } from './matcher/pattern-tester';
import { Processor, type ProcessorConfig } from './processor';
import { METHOD_OFFSET } from './schema';

export class Router<R = MatchResult> {
  private readonly options: RouterOptions;
  private readonly processor: Processor;
  private readonly builder: Builder<Handler<R>>;
  private matcher: Matcher | null = null;
  private cache: RouterCache<DynamicMatchResult> | undefined;

  private staticMap: Map<string, Handler<R>[]> = new Map();

  constructor(options: RouterOptions = {}) {
    this.options = options;

    const procConfig: ProcessorConfig = {
      collapseSlashes: options.collapseSlashes ?? options.ignoreTrailingSlash ?? true,
      ignoreTrailingSlash: options.ignoreTrailingSlash ?? true,
      blockTraversal: options.blockTraversal ?? true,
      caseSensitive: options.caseSensitive ?? true,
      maxSegmentLength: options.maxSegmentLength ?? 256,
      failFastOnBadEncoding: options.failFastOnBadEncoding ?? false,
    };

    this.processor = new Processor(procConfig);

    if (options.enableCache === true) {
      this.cache = new RouterCache(options.cacheSize);
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

    this.builder = new Builder<Handler<R>>(buildConfig);
  }

  add(method: HttpMethod | HttpMethod[] | '*', path: string, handler: Handler<R>): void {
    // If the router is already built, we cannot add more routes safely without rebuilding
    // or invalidating internal structures. For now, assume mutable phase only before build()
    // or allow add() but warn/reset matcher.
    if (this.matcher) {
      // For this implementation, we simply allow adding.
      // Real-world would likely throw or rebuild.
      this.matcher = null; // Invalidate
    }

    if (Array.isArray(method)) {
      method.forEach(m => {
        this.addOne(m, path, handler);
      });

      return;
    }

    if (method === '*') {
      const allMethods: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];

      allMethods.forEach(m => {
        this.addOne(m, path, handler);
      });

      return;
    }

    this.addOne(method, path, handler);
  }

  /**
   * Batch registration.
   */
  addAll(entries: Array<[HttpMethod, string, Handler<R>]>): void {
    for (const [method, path, handler] of entries) {
      this.add(method, path, handler);
    }
  }

  /**
   * Finalizes the router and prepares for matching.
   */
  build(): this {
    if (this.matcher) {
      return this;
    }

    const layout = this.builder.build();
    const testers = layout.patterns.map(p => {
      if (!p.source) {
        return undefined;
      }

      // Re-compile regex for runtime
      const regex = new RegExp(`^(?:${p.source})$`, p.flags);

      return buildPatternTester(p.source, regex, undefined);
    });

    this.matcher = new Matcher(layout, {
      patternTesters: testers,
      encodedSlashBehavior: this.options.encodedSlashBehavior ?? 'decode',
      failFastOnBadEncoding: this.options.failFastOnBadEncoding ?? false,
    });

    return this;
  }

  /**
   * Resolve a request. Executes the matched handler.
   */
  match(method: HttpMethod, path: string): R | null {
    // 1. Pre-process
    // We don't have full path normalization here yet (handled by builder for registration).
    // But for matching, we need to pass the raw path to matcher?
    // Matcher expects decoded logic or raw string? Matcher.walk takes (decodeParams).
    // We need to handle `ignoreTrailingSlash` etc. which are partially handled by structure but also inputs.

    // Simplification: Processor should arguably run on input path too?
    // If we have `Processor.process(path) -> segments[]`, we could use that.
    // usage: `matcher.match(segments)`?
    // Current `matcher.match` takes `path: string` (and internally slices it?).
    // No, `matcher.exec(method, segments)`.
    // Wait, Router implementation of `match` previously called `matcher.exec`.

    // See lines 122+ of original `Router`.
    // It normalized path manually?
    // "path" argument is assumed to be the URL pathname.

    let searchPath = path;

    // Fast-path: Trailing slash
    if (this.options.ignoreTrailingSlash === true && searchPath.length > 1 && searchPath.endsWith('/')) {
      searchPath = searchPath.slice(0, -1);
    }

    // Case sensitivity
    if (this.options.caseSensitive === false) {
      searchPath = searchPath.toLowerCase();
    }

    // Optimization: Raw Static Lookup
    // If the path is "clean" (already normalized), we can skip Processor.normalize().
    // We only check if searchPath starts with '/' to match our normalized keys.
    if (searchPath.charCodeAt(0) === 47 /* '/' */) {
      const staticHandlers = this.staticMap.get(searchPath);

      if (staticHandlers) {
        const handler = staticHandlers[METHOD_OFFSET[method]];

        if (handler) {
          return handler({}, { source: 'static-fast' });
        }
      }
    }

    // Cache Lookup
    if (this.cache) {
      const cacheKey = `${method}:${searchPath}`;
      const cached = this.cache.get(cacheKey);

      if (cached !== undefined) {
        if (cached === null) {
          return null;
        }

        // Execute Handler
        const handler = this.builder.handlers[cached.handlerIndex];

        if (handler === undefined) {
          return null;
        }

        // Params are cloned from cache for safety (users might mutate)
        return handler({ ...cached.params }, { source: 'cache' });
      }
    }

    if (!this.matcher) {
      this.build();
    }

    const matcher = this.matcher;

    if (!matcher) {
      return null;
    }

    // Process Segments
    // "segments" are needed for Matcher.
    // `processor.process(searchPath)` returns string[].
    const { segments, segmentDecodeHints, normalized } = this.processor.normalize(searchPath);

    // Static Fast-path (Fallback for normalized paths)
    // Only check if normalized != searchPath (otherwise we already checked)
    if (normalized !== searchPath) {
      const staticHandlers = this.staticMap.get(normalized);

      if (staticHandlers) {
        const handler = staticHandlers[METHOD_OFFSET[method]];

        if (handler) {
          return handler({}, { source: 'static-fast' });
        }
      }
    }

    // Dynamic Match
    const matched = matcher.match(
      method,
      segments,
      normalized,
      segmentDecodeHints,
      this.options.decodeParams ?? true,
      false, // captureSnapshot
    );

    if (matched) {
      const handlerIndex = matcher.getHandlerIndex();
      const params = matcher.getParams();
      const defaults = this.builder.config.optionalParamDefaults;

      if (defaults) {
        defaults.apply(handlerIndex, params);
      }

      // Execute Handler
      const handler = this.builder.handlers[handlerIndex];

      // Handlers are guaranteed by build process but array access returns potential undefined
      if (!handler) {
        return null;
      }

      const meta: MatchResultMeta = { source: 'dynamic' };

      // Update Cache
      if (this.cache) {
        const cacheKey = `${method}:${searchPath}`;

        this.cache.set(cacheKey, {
          handlerIndex: handlerIndex,
          params: { ...params }, // Clone for safety
        });
      }

      // Optimization: Reuse params object directly.
      return handler(params, meta);
    }

    // Cache Miss
    if (this.cache) {
      const cacheKey = `${method}:${searchPath}`;

      this.cache.set(cacheKey, null);
    }

    return null;
  }

  private addOne(method: HttpMethod, path: string, handler: Handler<R>): void {
    const { segments, normalized } = this.processor.normalize(path, false);
    // Check for dynamic segments (*, :)
    let isDynamic = false;

    for (const segment of segments) {
      const firstChar = segment.charCodeAt(0);

      if (firstChar === 42 || firstChar === 58) {
        // '*' or ':'
        isDynamic = true;

        break;
      }
    }

    if (!isDynamic) {
      let handlers = this.staticMap.get(normalized);

      if (!handlers) {
        handlers = [];

        this.staticMap.set(normalized, handlers);
      }

      const mOffset = METHOD_OFFSET[method];

      if (mOffset !== undefined) {
        handlers[mOffset] = handler;
      }
    }

    // Trailing slash handled by processor
    this.builder.add(method, segments, handler);
  }
}
