import type { OptionalParamDefaults } from '../builder/optional-param-defaults';
import type { MatchFn, MatchState } from '../matcher/match-state';
import type { NormalizeCfg } from '../matcher/path-normalize';
import type { MatchOutput, RouteParams } from '../types';

import { RouterCache } from '../cache';
import {
  CACHE_META,
  DYNAMIC_META,
  EMPTY_PARAMS,
  NullProtoObj,
} from '../internal/null-proto-obj';
import {
  emitLowerCase,
  emitPathLenCheck,
  emitQueryStrip,
  emitSegLenCheck,
  emitTrailingSlashTrim,
} from '../matcher/path-normalize';

/**
 * Cache entry shape — value+params only. The CACHE_META singleton is
 * attached at lookup time inside the emitted matchImpl, so cache writes
 * never store it.
 *
 * File-local to codegen because MatchConfig consumes it; not part of the
 * public API.
 */
export interface MatchCacheEntry<T> {
  value: T;
  params: RouteParams;
}

/**
 * Snapshot of build-time flags + closure-captured references that drive
 * matchImpl emission. Built once by Router.collectMatchConfig() at
 * build time and threaded through the per-shape emitters.
 *
 * Structurally a NormalizeCfg superset (the path-normalize emit helpers
 * read trimSlash/lowerCase/maxPathLen/etc. from any compatible cfg).
 */
export interface MatchConfig<T> {
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
  readonly hitCacheByMethod: Map<number, RouterCache<MatchCacheEntry<T>>> | undefined;
  readonly missCacheByMethod: Map<number, Set<string>> | undefined;
  readonly cacheMaxSize: number;
  // Build-output extras consumed only by codegen — not part of the closure
  // payload but needed to choose the emit shape.
  readonly activeMethodCodes: ReadonlyArray<readonly [string, number]>;
}

type CompiledMatch<T> = (method: string, path: string) => MatchOutput<T> | null;

/**
 * Compile a specialized match closure via `new Function()` based on the
 * router's actual config and registered routes. Dead code paths
 * (default case sensitivity, empty tree, no optional
 * defaults, etc.) are omitted entirely so the hot path only runs guards
 * that can fire.
 *
 * Cache read/write is inlined (no bound-method call overhead). All
 * helpers used by the hot path are closure-captured, not
 * `this.*`-dispatched.
 *
 * Public entry.
 */
export function compileMatchFn<T>(cfg: MatchConfig<T>): CompiledMatch<T> {
  return emitGenericMatchImpl(cfg);
}

/**
 * Emitter for the generic matchImpl — every router that doesn't qualify
 * for a shape-specialized fast path (currently none, as cache is always
 * enabled) flows through here.
 *
 * Generates a flat function that handles:
 *   1. Path normalization (strip query, trim slash, case fold, etc.)
 *   2. Method-code lookup (O(1) from closure-captured methodCodes)
 *   3. Static-route hit cache lookup
 *   4. Static-route record lookup (staticOutputsByMethod)
 *   5. Dynamic-route tree walk (method-specific walker)
 *   6. Miss cache write / Hit cache write on success.
 */
function emitGenericMatchImpl<T>(cfg: MatchConfig<T>): CompiledMatch<T> {
  const activeMethodCount = cfg.activeMethodCodes.length;
  const cacheMaxSize = cfg.cacheMaxSize;
  const hasOptDefaults = cfg.hasOptDefaults;

  const src: string[] = [];

  const normCfg: NormalizeCfg = cfg;
  const pathLenJs = emitPathLenCheck(normCfg, 'path', 'return null;');

  if (pathLenJs !== '') src.push(pathLenJs);

  src.push(`var mc = methodCodes[method]; if (mc === undefined) return null;`);

  src.push(emitQueryStrip('path', 'sp'));

  const trimJs = emitTrailingSlashTrim(normCfg, 'sp');

  if (trimJs !== '') src.push(trimJs);

  const lowerJs = emitLowerCase(normCfg, 'sp');

  if (lowerJs !== '') src.push(lowerJs);

  // 1. Static cache lookup (Always enabled)
  src.push(`
    var ms = missCacheByMethod.get(mc);
    if (ms !== undefined && ms.has(sp)) return null;
    var hc = hitCacheByMethod.get(mc);
    if (hc !== undefined) {
      var cached = hc.get(sp);
      if (cached !== undefined) {
        return { value: cached.value, params: cached.params, meta: CACHE_META };
      }
    }
  `);

  // 2. Static map lookup
  if (cfg.hasAnyStatic) {
    src.push(`
      var bucket = staticOutputsByMethod[mc];
      if (bucket !== undefined) {
        var out = bucket[sp];
        if (out !== undefined) {
          if (hc === undefined) {
            hc = new RouterCache(${cacheMaxSize});
            hitCacheByMethod.set(mc, hc);
          }
          hc.set(sp, { value: out.value, params: EMPTY_PARAMS });
          return out;
        }
      }
    `);
  }

  const emitMissCacheWrite = (): string => `
    if (ms === undefined) { ms = new Set(); missCacheByMethod.set(mc, ms); }
    if (ms.size >= ${cacheMaxSize}) {
      var oldest = ms.values().next().value;
      if (oldest !== undefined) ms.delete(oldest);
    }
    ms.add(sp);
  `;

  // 3. Dynamic tree walk
  if (cfg.hasAnyTree) {
    // Per-segment length scan, deferred until after static lookup so
    // static cache hits skip it.
    const segJs = emitSegLenCheck(normCfg, 'sp', 'return null;');

    if (segJs !== '') src.push(segJs);

    src.push(`
      var tr = trees[mc];
      if (!tr) {
        ${emitMissCacheWrite()}
        return null;
      }
      var params = new ParamsCtor();
      matchState.params = params;
      var ok = tr(sp, matchState);
      if (!ok) {
        ${emitMissCacheWrite()}
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

    src.push(`
      var val = handlers[matchState.handlerIndex];
      if (hc === undefined) {
        hc = new RouterCache(${cacheMaxSize});
        hitCacheByMethod.set(mc, hc);
      }
      var cachedParams = new ParamsCtor();
      for (var cpk in params) cachedParams[cpk] = params[cpk];
      hc.set(sp, { value: val, params: cachedParams });
      return { value: val, params: params, meta: DYNAMIC_META };
    `);
  } else {
    src.push(emitMissCacheWrite());
    src.push(`return null;`);
  }

  const body = src.join('\n');
  const factory = new Function(
    'staticOutputsByMethod', 'methodCodes', 'trees', 'matchState', 'handlers',
    'optDefaults', 'hitCacheByMethod', 'missCacheByMethod', 'RouterCache',
    'EMPTY_PARAMS', 'CACHE_META', 'DYNAMIC_META', 'ParamsCtor',
    `return function match(method, path) {\n${body}\n};`,
  );

  return factory(
    cfg.staticOutputsByMethod, cfg.methodCodes, cfg.trees, cfg.matchState, cfg.handlers,
    cfg.optDefaults, cfg.hitCacheByMethod, cfg.missCacheByMethod, RouterCache,
    EMPTY_PARAMS, CACHE_META, DYNAMIC_META, NullProtoObj,
  ) as CompiledMatch<T>;
}
