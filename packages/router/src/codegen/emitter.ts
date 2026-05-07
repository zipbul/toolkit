import type { MatchFn, MatchState } from '../matcher/match-state';
import type { NormalizeCfg } from '../matcher/path-normalize';
import type { RuntimePathPolicyConfig } from '../matcher/runtime-path-policy';
import type { MatchOutput, RouteParams, RouterProfile } from '../types';

import { RouterCache, RouterMissCache } from '../cache';
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
  readonly staticMap: Record<string, Array<T | undefined>>;
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

  // 1. Static cache lookup
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
    if (ms === undefined) { ms = new RouterMissCache(${cacheMaxSize}); missCacheByMethod.set(mc, ms); }
    ms.add(sp);
  `;

  // 3. Dynamic tree walk
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

  return factory(
    cfg.staticOutputsByMethod, cfg.methodCodes, cfg.trees, cfg.matchState, cfg.handlers,
    cfg.hitCacheByMethod, cfg.missCacheByMethod, RouterCache, RouterMissCache,
    EMPTY_PARAMS, CACHE_META, DYNAMIC_META, cfg.terminalHandlers, cfg.isWildcardByTerminal, cfg.paramsFactories,
    scanRuntimePath, policyCfg, NullProtoObj,
  ) as CompiledMatch<T>;
}
