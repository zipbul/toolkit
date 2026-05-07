import type { MatchFn, MatchState } from '../matcher/match-state';
import type { NormalizeCfg } from '../matcher/path-normalize';
import type { RuntimePathPolicyConfig } from '../matcher/runtime-path-policy';
import type { MatchOutput, RouteParams, RouterProfile } from '../types';

import { performance } from 'node:perf_hooks';
import { RouterCache, RouterMissCache } from '../cache';
import {
  recordCompile,
  recordWarmupCall,
  shapeSignature,
} from './codegen-telemetry';
import {
  CACHE_META,
  DYNAMIC_META,
  EMPTY_PARAMS,
  NullProtoObj,
} from '../internal/null-proto-obj';
import {
  emitPathLenCheck,
  emitSegLenCheck,
} from '../matcher/path-normalize';
import { scanRuntimePath } from '../matcher/runtime-path-policy';

/**
 * Cache entry shape. Attached at lookup time inside emitted matchImpl.
 */
export interface MatchCacheEntry<T> {
  value: T;
  params: RouteParams;
}

/**
 * Configuration for compiled match implementation.
 */
export interface MatchConfig<T> {
  readonly profile: RouterProfile;
  readonly trimSlash: boolean;
  readonly lowerCase: boolean;
  readonly maxPathLen: number;
  readonly maxSegLen: number;
  readonly checkPathLen: boolean;
  readonly checkSegLen: boolean;
  readonly hasAnyTree: boolean;
  readonly anyTester: boolean;
  readonly hasAnyStatic: boolean;
  readonly staticOutputsByMethod: Array<Record<string, MatchOutput<T>> | undefined>;
  readonly methodCodes: Record<string, number>;
  readonly trees: Array<MatchFn | null>;
  readonly matchState: MatchState;
  readonly handlers: T[];
  readonly hitCacheByMethod: Map<number, RouterCache<MatchCacheEntry<T>>> | undefined;
  readonly missCacheByMethod: Map<number, RouterMissCache> | undefined;
  readonly cacheMaxSize: number;
  readonly activeMethodCodes: ReadonlyArray<readonly [string, number]>;
  readonly terminalHandlers: number[];
  readonly isWildcardByTerminal: boolean[];
  readonly paramsFactories: Array<((u: string, v: Int32Array) => RouteParams) | null>;
}

type CompiledMatch<T> = (method: string, path: string) => MatchOutput<T> | null;

/**
 * Compile a specialized match closure via `new Function()`.
 */
export function compileMatchFn<T>(cfg: MatchConfig<T>): CompiledMatch<T> {
  return emitGenericMatchImpl(cfg);
}

/**
 * Emitter for the generic matchImpl. 
 */
function emitGenericMatchImpl<T>(cfg: MatchConfig<T>): CompiledMatch<T> {
  const cacheMaxSize = cfg.cacheMaxSize;

  const src: string[] = [];

  const normCfg: NormalizeCfg = cfg;
  const pathLenJs = emitPathLenCheck(normCfg, 'path', 'return null;');

  if (pathLenJs !== '') src.push(pathLenJs);

  src.push(`var mc = methodCodes[method]; if (mc === undefined) return null;`);

  src.push(`
    var __scan = scanRuntimePath(path, runtimePathPolicyCfg);
    if (__scan.ok !== true) return null;
    var sp = __scan.key;
  `);

  // Adaptive method-order: methods that have no dynamic walker take the
  // static-first fast path (direct table lookup, no cache wrap). Methods
  // with a dynamic walker take cache-first ordering so dynamic-cache hits
  // do not pay an upfront static-bucket miss.
  if (cfg.hasAnyStatic && !cfg.hasAnyTree) {
    src.push(`
      var bucket = staticOutputsByMethod[mc];
      if (bucket !== undefined) {
        var out = bucket[sp];
        if (out !== undefined) return out;
      }
      return null;
    `);

    const body = src.join('\n');
    const factory = new Function(
      'staticOutputsByMethod', 'methodCodes', 'trees', 'matchState', 'handlers',
      'hitCacheByMethod', 'missCacheByMethod', 'RouterCache', 'RouterMissCache',
      'EMPTY_PARAMS', 'CACHE_META', 'DYNAMIC_META', 'terminalHandlers', 'isWildcardByTerminal', 'paramsFactories',
      'scanRuntimePath', 'runtimePathPolicyCfg', 'NullProtoObj',
      `return function match(method, path) {\n${body}\n};`,
    );

    const policyCfg: RuntimePathPolicyConfig = {
      profile: cfg.profile,
      trimTrailingSlash: cfg.trimSlash,
      toLowerCase: cfg.lowerCase,
      maxPathLen: cfg.maxPathLen,
      maxSegLen: cfg.maxSegLen,
      checkPathLen: cfg.checkPathLen,
      checkSegLen: cfg.checkSegLen,
    };

    return factory(
      cfg.staticOutputsByMethod, cfg.methodCodes, cfg.trees, cfg.matchState, cfg.handlers,
      cfg.hitCacheByMethod, cfg.missCacheByMethod, RouterCache, RouterMissCache,
      EMPTY_PARAMS, CACHE_META, DYNAMIC_META, cfg.terminalHandlers, cfg.isWildcardByTerminal, cfg.paramsFactories,
      scanRuntimePath, policyCfg, NullProtoObj,
    ) as CompiledMatch<T>;
  }

  // Cache-first ordering for routers that include any dynamic walker.
  src.push(`
    var ms = missCacheByMethod.get(mc);
    if (ms !== undefined && ms.has(sp)) return null;
    var hc = hitCacheByMethod.get(mc);
    if (hc !== undefined) {
      var cached = hc.get(sp);
      if (cached !== undefined) {
        var cp = cached.params;
        return {
          value: cached.value,
          params: cp === EMPTY_PARAMS ? cp : Object.assign(new NullProtoObj(), cp),
          meta: CACHE_META,
        };
      }
    }
  `);

  // After cache miss, try the static table once (cheaper than the walker).
  if (cfg.hasAnyStatic) {
    src.push(`
      var bucket = staticOutputsByMethod[mc];
      if (bucket !== undefined) {
        var out = bucket[sp];
        if (out !== undefined) return out;
      }
    `);
  }

  const emitMissCacheWrite = (): string => `
    if (ms === undefined) { ms = new RouterMissCache(${cacheMaxSize}); missCacheByMethod.set(mc, ms); }
    ms.add(sp);
  `;

  if (cfg.hasAnyTree) {
    if (cfg.checkSegLen) src.push(emitSegLenCheck(normCfg, 'sp', 'return null;'));

    src.push(`
      var tr = trees[mc];
      if (!tr) {
        ${emitMissCacheWrite()}
        return null;
      }
      var ok = tr(sp, matchState);

      if (ok) {
        var tIdx = matchState.handlerIndex;
        if (!${cfg.trimSlash} && sp.length > 1 && sp.charCodeAt(sp.length - 1) === 47 && !isWildcardByTerminal[tIdx]) {
          ok = false;
        }
      }

      if (!ok) {
        ${emitMissCacheWrite()}
        return null;
      }

      var tIdx = matchState.handlerIndex;
      var hIdx = terminalHandlers[tIdx];
      var factory = paramsFactories[tIdx];
      var params = (factory !== undefined && factory !== null)
        ? factory(sp, matchState.paramOffsets)
        : EMPTY_PARAMS;

      var val = handlers[hIdx];
      if (hc === undefined) {
        hc = new RouterCache(${cacheMaxSize});
        hitCacheByMethod.set(mc, hc);
      }
      hc.set(sp, { value: val, params: params });
      return {
        value: val,
        params: params === EMPTY_PARAMS ? params : Object.assign(new NullProtoObj(), params),
        meta: DYNAMIC_META,
      };
    `);
  } else {
    src.push(emitMissCacheWrite());
    src.push(`return null;`);
  }

  const body = src.join('\n');
  const factory = new Function(
    'staticOutputsByMethod', 'methodCodes', 'trees', 'matchState', 'handlers',
    'hitCacheByMethod', 'missCacheByMethod', 'RouterCache', 'RouterMissCache',
    'EMPTY_PARAMS', 'CACHE_META', 'DYNAMIC_META', 'terminalHandlers', 'isWildcardByTerminal', 'paramsFactories',
    'scanRuntimePath', 'runtimePathPolicyCfg', 'NullProtoObj',
    `return function match(method, path) {\n${body}\n};`,
  );

  const policyCfg: RuntimePathPolicyConfig = {
    profile: cfg.profile,
    trimTrailingSlash: cfg.trimSlash,
    toLowerCase: cfg.lowerCase,
    maxPathLen: cfg.maxPathLen,
    maxSegLen: cfg.maxSegLen,
    checkPathLen: cfg.checkPathLen,
    checkSegLen: cfg.checkSegLen,
  };

  const compileStart = performance.now();
  const compiled = factory(
    cfg.staticOutputsByMethod, cfg.methodCodes, cfg.trees, cfg.matchState, cfg.handlers,
    cfg.hitCacheByMethod, cfg.missCacheByMethod, RouterCache, RouterMissCache,
    EMPTY_PARAMS, CACHE_META, DYNAMIC_META, cfg.terminalHandlers, cfg.isWildcardByTerminal, cfg.paramsFactories,
    scanRuntimePath, policyCfg, NullProtoObj,
  ) as CompiledMatch<T>;
  const matchImplShape = shapeSignature(
    cfg.activeMethodCodes.length,
    cfg.trees.filter(t => t != null).length,
    cfg.handlers.length,
  );
  recordCompile(matchImplShape, performance.now() - compileStart, 0);

  // Warm the freshly-compiled match implementation across the major
  // branches of the emitted code (one synthetic call per active method)
  // so JSC IC reaches tier-up on each branch the user will actually hit.
  // A single-input warmup leaves sibling-method branches cold, which shows
  // up as a multi-µs first-call tail under multi-method workloads.
  //
  // Iteration count drives JSC IC past its baseline thresholds so the hot
  // path is at least baseline-compiled by the time the first user request
  // arrives. Tier-up to DFG is best-effort — the runtime engine controls
  // when that promotion fires.
  const warmPaths = ['/__zipbul_warmup__', '/__zipbul_warmup__/sub'];
  const WARMUP_ITERATIONS = 20;
  for (let it = 0; it < WARMUP_ITERATIONS; it++) {
    for (const [methodName] of cfg.activeMethodCodes) {
      for (const p of warmPaths) {
        try { compiled(methodName, p); } catch { /* warmup non-fatal */ }
      }
    }
  }
  // Telemetry: record only the final call latency so the row reflects the
  // post-tier-up cost rather than the cold first-call cost.
  for (const [methodName] of cfg.activeMethodCodes) {
    for (const p of warmPaths) {
      const t0 = performance.now();
      try { compiled(methodName, p); } catch { /* warmup non-fatal */ }
      recordWarmupCall(matchImplShape, (performance.now() - t0) * 1e6);
    }
  }

  return compiled;
}
