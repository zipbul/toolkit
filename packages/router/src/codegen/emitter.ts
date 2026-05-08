import type { MatchFn, MatchState } from '../matcher/match-state';
import type { NormalizeCfg } from '../matcher/path-normalize';
import type { MatchOutput, RouteParams } from '../types';

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
  emitLowerCase,
  emitPathLenCheck,
  emitQueryStrip,
  emitSegLenCheck,
  emitTrailingSlashTrim,
} from '../matcher/path-normalize';

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
 *
 * Emission strategy:
 *   - Single active method: emit `if (method !== "<lit>") return null; var mc = <code>;`
 *     so JSC can fold both branches and the static bucket lookup
 *     becomes a closure-captured constant access.
 *   - Multi-method: dispatch through `methodCodes[method]`.
 *
 * Path normalization is intentionally minimal: query strip, optional
 * trailing-slash trim, optional case-fold, optional length guards. Heavy
 * URL validation (raw `#`, malformed percent, dot segments, encoded
 * slashes, UTF-8 well-formedness, etc.) is not the router's job — it
 * belongs to the HTTP server / framework layer above. The router
 * trusts that match() inputs are already RFC-compliant pathnames.
 */
export function compileMatchFn<T>(cfg: MatchConfig<T>): CompiledMatch<T> {
  return emitGenericMatchImpl(cfg);
}

function emitGenericMatchImpl<T>(cfg: MatchConfig<T>): CompiledMatch<T> {
  const cacheMaxSize = cfg.cacheMaxSize;

  const activeMethodCount = cfg.activeMethodCodes.length;
  const singleMethod = activeMethodCount === 1 ? cfg.activeMethodCodes[0]! : null;

  const src: string[] = [];
  const normCfg: NormalizeCfg = cfg;
  const pathLenJs = emitPathLenCheck(normCfg, 'path', 'return null;');

  if (pathLenJs !== '') src.push(pathLenJs);

  // Method dispatch — specialised when only one method is active so JSC
  // can fold the literal compare and the `mc` constant.
  if (singleMethod !== null) {
    const [name, code] = singleMethod;
    src.push(`if (method !== ${JSON.stringify(name)}) return null;`);
    src.push(`var mc = ${code};`);
  } else {
    src.push(`var mc = methodCodes[method]; if (mc === undefined) return null;`);
  }

  // Inline path normalization (no function call): query strip, optional
  // trailing slash trim, optional case fold.
  src.push(emitQueryStrip('path', 'sp'));
  const trimJs = emitTrailingSlashTrim(normCfg, 'sp');
  if (trimJs !== '') src.push(trimJs);
  const lowerJs = emitLowerCase(normCfg, 'sp');
  if (lowerJs !== '') src.push(lowerJs);

  // Single-method static-only fast path: closure-captures the bucket
  // resolved for that method so the lookup is a single property access.
  if (cfg.hasAnyStatic && !cfg.hasAnyTree && singleMethod !== null) {
    src.push(`
      var out = activeBucket[sp];
      if (out !== undefined) return out;
      return null;
    `);

    const body = src.join('\n');
    const factory = new Function(
      'activeBucket', 'methodCodes', 'staticOutputsByMethod',
      `return function match(method, path) {\n${body}\n};`,
    );

    const compiled = factory(
      cfg.staticOutputsByMethod[singleMethod[1]] ?? Object.create(null),
      cfg.methodCodes,
      cfg.staticOutputsByMethod,
    ) as CompiledMatch<T>;

    runWarmup(compiled, cfg, shapeSignature(activeMethodCount, 0, cfg.handlers.length));
    return compiled;
  }

  // Static-only, multi-method.
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
      'staticOutputsByMethod', 'methodCodes',
      `return function match(method, path) {\n${body}\n};`,
    );

    const compiled = factory(
      cfg.staticOutputsByMethod, cfg.methodCodes,
    ) as CompiledMatch<T>;

    runWarmup(compiled, cfg, shapeSignature(activeMethodCount, 0, cfg.handlers.length));
    return compiled;
  }

  // Dynamic walker present — cache-first ordering. Cache hits skip the
  // static lookup entirely; dynamic-only routers never pay a static-bucket
  // miss on the hot path.
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

  // Cache miss: try static once before invoking the walker.
  if (cfg.hasAnyStatic) {
    if (singleMethod !== null) {
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

  const emitMissCacheWrite = (): string => `
    if (ms === undefined) { ms = new RouterMissCache(${cacheMaxSize}); missCacheByMethod.set(mc, ms); }
    ms.add(sp);
  `;

  if (cfg.hasAnyTree) {
    if (cfg.checkSegLen) src.push(emitSegLenCheck(normCfg, 'sp', 'return null;'));

    // Single-method router: closure-capture the per-method walker as a
    // constant `tr0` so JSC folds the dispatch and inlines the call site.
    // Multi-method router still indexes into the trees array per call.
    if (singleMethod !== null) {
      src.push(`
        var ok = tr0 !== null ? tr0(sp, matchState) : false;
      `);
    } else {
      src.push(`
        var tr = trees[mc];
        if (!tr) {
          ${emitMissCacheWrite()}
          return null;
        }
        var ok = tr(sp, matchState);
      `);
    }

    src.push(`
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
    src.push('return null;');
  }

  const body = src.join('\n');
  const factory = new Function(
    'activeBucket', 'tr0', 'staticOutputsByMethod', 'methodCodes', 'trees', 'matchState', 'handlers',
    'hitCacheByMethod', 'missCacheByMethod', 'RouterCache', 'RouterMissCache',
    'EMPTY_PARAMS', 'CACHE_META', 'DYNAMIC_META', 'terminalHandlers', 'isWildcardByTerminal', 'paramsFactories',
    'NullProtoObj',
    `return function match(method, path) {\n${body}\n};`,
  );

  const activeBucket = singleMethod !== null
    ? cfg.staticOutputsByMethod[singleMethod[1]] ?? Object.create(null)
    : Object.create(null);
  const tr0 = singleMethod !== null ? (cfg.trees[singleMethod[1]] ?? null) : null;

  const compiled = factory(
    activeBucket, tr0, cfg.staticOutputsByMethod, cfg.methodCodes, cfg.trees, cfg.matchState, cfg.handlers,
    cfg.hitCacheByMethod, cfg.missCacheByMethod, RouterCache, RouterMissCache,
    EMPTY_PARAMS, CACHE_META, DYNAMIC_META, cfg.terminalHandlers, cfg.isWildcardByTerminal, cfg.paramsFactories,
    NullProtoObj,
  ) as CompiledMatch<T>;

  runWarmup(
    compiled,
    cfg,
    shapeSignature(activeMethodCount, cfg.trees.filter(t => t != null).length, cfg.handlers.length),
  );
  return compiled;
}

/**
 * Warm the compiled match implementation past JSC's baseline thresholds
 * across each active method so the first user request lands on at least
 * baseline-compiled code rather than the cold first-call path.
 */
function runWarmup<T>(compiled: CompiledMatch<T>, cfg: MatchConfig<T>, shape: string): void {
  const compileMs = 0;
  recordCompile(shape, compileMs, 0);

  const warmPaths = ['/__zipbul_warmup__', '/__zipbul_warmup__/sub'];
  const WARMUP_ITERATIONS = 20;
  for (let it = 0; it < WARMUP_ITERATIONS; it++) {
    for (const [methodName] of cfg.activeMethodCodes) {
      for (const p of warmPaths) {
        try { compiled(methodName, p); } catch { /* warmup non-fatal */ }
      }
    }
  }
  for (const [methodName] of cfg.activeMethodCodes) {
    for (const p of warmPaths) {
      const t0 = performance.now();
      try { compiled(methodName, p); } catch { /* warmup non-fatal */ }
      recordWarmupCall(shape, (performance.now() - t0) * 1e6);
    }
  }
}
