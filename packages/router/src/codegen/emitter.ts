import type { MatchFn, MatchState } from '../matcher/match-state';
import type { NormalizeCfg } from '../matcher/path-normalize';
import type { MatchOutput, RouteParams } from '../types';

import { RouterCache } from '../cache';
import { WARMUP_ITERATIONS } from './warmup';
import {
  CACHE_META,
  DYNAMIC_META,
  EMPTY_PARAMS,
} from '../internal/null-proto-obj';
import {
  emitLowerCase,
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
  readonly hasAnyTree: boolean;
  readonly anyTester: boolean;
  readonly hasAnyStatic: boolean;
  readonly staticOutputsByMethod: Array<Record<string, MatchOutput<T>> | undefined>;
  readonly methodCodes: Record<string, number>;
  readonly trees: Array<MatchFn | null>;
  readonly matchState: MatchState;
  readonly handlers: T[];
  readonly hitCacheByMethod: Array<RouterCache<MatchCacheEntry<T>> | undefined>;
  readonly cacheMaxSize: number;
  readonly activeMethodCodes: ReadonlyArray<readonly [string, number]>;
  /**
   * Packed `Int32Array` slab carrying per-terminal metadata. Two slots
   * per terminal index `t`: `terminalSlab[t*2]` is the handler index,
   * `terminalSlab[t*2+1]` is `1` for wildcard terminals and `0` for
   * regular ones. Replaces the prior `terminalHandlers: number[]` +
   * `isWildcardByTerminal: boolean[]` parallel arrays so the hot path
   * reads contiguous typed memory.
   */
  readonly terminalSlab: Int32Array;
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
 * Path normalization is intentionally minimal: optional trailing-slash
 * trim and optional case-fold. Heavy URL validation (raw `#`, malformed
 * percent, dot segments, encoded slashes, UTF-8 well-formedness, etc.)
 * is not the router's job — it belongs to the HTTP server / framework
 * layer above. The router trusts that match() inputs are already
 * RFC-compliant pathnames.
 */
export function compileMatchFn<T>(cfg: MatchConfig<T>): CompiledMatch<T> {
  const activeMethodCount = cfg.activeMethodCodes.length;
  const singleMethod = activeMethodCount === 1 ? cfg.activeMethodCodes[0]! : null;

  const src: string[] = [];
  const normCfg: NormalizeCfg = cfg;

  // Path validation (length, percent encoding, etc.) is the upstream
  // framework / HTTP server's responsibility. The router accepts the
  // pathname as given and normalizes only what is policy: trailing slash
  // and case folding. No `?` stripping; no per-call length guards.

  // Method dispatch — specialised when only one method is active so JSC
  // can fold the literal compare and the `mc` constant.
  if (singleMethod !== null) {
    const [name, code] = singleMethod;
    src.push(`if (method !== ${JSON.stringify(name)}) return null;`);
    src.push(`var mc = ${code};`);
  } else {
    src.push(`var mc = methodCodes[method]; if (mc === undefined) return null;`);
  }

  // Single-method static-only fast path: closure-captures the bucket
  // resolved for that method so the lookup is a single property access.
  //
  // Bun/JSC optimization: the overwhelmingly common case is that callers
  // pass canonical paths — no `?` query, no trailing slash, no uppercase.
  // We probe `activeBucket[path]` *before* paying any normalization cost
  // so that path becomes a single object property load with zero
  // substring/indexOf/toLowerCase work. Only on miss do we run the full
  // normalization and retry.
  if (cfg.hasAnyStatic && !cfg.hasAnyTree && singleMethod !== null) {
    src.push(`
      var out = activeBucket[path];
      if (out !== undefined) return out;
    `);
    src.push('var sp = path;');
    const trimJs0 = emitTrailingSlashTrim(normCfg, 'sp');
    if (trimJs0 !== '') src.push(trimJs0);
    const lowerJs0 = emitLowerCase(normCfg, 'sp');
    if (lowerJs0 !== '') src.push(lowerJs0);
    src.push(`
      if (sp !== path) {
        out = activeBucket[sp];
        if (out !== undefined) return out;
      }
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

    runWarmup(compiled, cfg);
    return compiled;
  }

  // Bun/JSC fast path for mixed (static + dynamic) routers: try the
  // canonical-path static bucket *before* normalization so static hits
  // skip the indexOf/substring/Map.get chain entirely. Object property
  // load is one IC slot; on miss we fall through to the existing
  // normalize → cache → walker pipeline with `sp` populated identically.
  // Single-method case uses the closure-captured `activeBucket`; multi-
  // method case must resolve the per-method bucket from the dispatched mc.
  if (cfg.hasAnyStatic && cfg.hasAnyTree) {
    if (singleMethod !== null) {
      src.push(`
        var preOut = activeBucket[path];
        if (preOut !== undefined) return preOut;
      `);
    } else {
      src.push(`
        var preBucket = staticOutputsByMethod[mc];
        if (preBucket !== undefined) {
          var preOut = preBucket[path];
          if (preOut !== undefined) return preOut;
        }
      `);
    }
  }

  // Inline path normalization: only router-policy steps run here
  // (trailing-slash trim and case folding). Query stripping is not the
  // router's job — the framework hands us a pathname.
  src.push('var sp = path;');
  const trimJs = emitTrailingSlashTrim(normCfg, 'sp');
  if (trimJs !== '') src.push(trimJs);
  const lowerJs = emitLowerCase(normCfg, 'sp');
  if (lowerJs !== '') src.push(lowerJs);

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

    runWarmup(compiled, cfg);
    return compiled;
  }

  // Static-first on the normalized path: an object property load (one IC
  // slot) beats both branches of the cache check, and static results are
  // never stored in the cache, so probing static before the cache costs
  // nothing on a cache hit and saves the cache lookups on a static hit
  // for non-canonical inputs (e.g., trailing slash that got trimmed).
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

  // Cache probe (after static). Static hits already returned above; only
  // dynamic results live in the cache. Sparse-array indexing by mc keeps
  // each lookup as a typed-array load rather than a `Map.get` dispatch.
  // Cache entries are frozen at write time so subsequent hits can return
  // their `params` reference directly without paying for a per-match
  // clone. `EMPTY_PARAMS` is already frozen module-init. Caller mutation
  // of returned params throws TypeError instead of silently corrupting
  // the cached entry.
  // hit-cache probe (after static). missCache was removed — measured
  // dead weight across hit / unique-miss / Zipf workloads (bench/cache-bypass).
  src.push(`
    var hc = hitCacheByMethod[mc];
    if (hc !== undefined) {
      var cached = hc.get(sp);
      if (cached !== undefined) {
        return {
          value: cached.value,
          params: cached.params,
          meta: CACHE_META,
        };
      }
    }
  `);

  if (cfg.hasAnyTree) {
    // Single-method router: closure-capture the per-method walker as a
    // constant `tr0` so JSC folds the dispatch and inlines the call site.
    // Multi-method router still indexes into the trees array per call.
    if (singleMethod !== null) {
      // tr0 is guaranteed non-null here: singleMethod implies the only
      // active method, and hasAnyTree being true means *its* tree slot
      // is populated. The defensive `tr0 !== null ?` ternary the
      // emitter used to carry was dead in this branch.
      src.push(`
        var ok = tr0(sp, matchState);
      `);
    } else {
      src.push(`
        var tr = trees[mc];
        if (!tr) return null;
        var ok = tr(sp, matchState);
      `);
    }

    // Trailing-slash recheck wrapped in `if (ok)` only matters when the
    // upstream normalizer didn't already trim. Skip the wrapper + dead
    // 4-condition `&&` chain entirely for trim-active routers (default).
    const trimRecheck = cfg.trimSlash
      ? ''
      : `
      if (ok && sp.length > 1 && sp.charCodeAt(sp.length - 1) === 47 && terminalSlab[(matchState.handlerIndex << 1) + 1] === 0) {
        ok = false;
      }`;
    src.push(`
      var tIdx = matchState.handlerIndex;
      var slabBase = tIdx << 1;${trimRecheck}

      if (!ok) return null;

      var hIdx = terminalSlab[slabBase];
      var factory = paramsFactories[tIdx];
      var params = factory !== null
        ? factory(sp, matchState.paramOffsets)
        : EMPTY_PARAMS;

      var val = handlers[hIdx];
      if (params !== EMPTY_PARAMS) Object.freeze(params);
      hc.set(sp, { value: val, params: params });
      return {
        value: val,
        params: params,
        meta: DYNAMIC_META,
      };
    `);
  } else {
    src.push('return null;');
  }

  const body = src.join('\n');
  const factory = new Function(
    'activeBucket', 'tr0', 'staticOutputsByMethod', 'methodCodes', 'trees', 'matchState', 'handlers',
    'hitCacheByMethod', 'RouterCache',
    'EMPTY_PARAMS', 'CACHE_META', 'DYNAMIC_META', 'terminalSlab', 'paramsFactories',
    `return function match(method, path) {\n${body}\n};`,
  );

  const activeBucket = singleMethod !== null
    ? cfg.staticOutputsByMethod[singleMethod[1]] ?? Object.create(null)
    : Object.create(null);
  const tr0 = singleMethod !== null ? (cfg.trees[singleMethod[1]] ?? null) : null;

  const compiled = factory(
    activeBucket, tr0, cfg.staticOutputsByMethod, cfg.methodCodes, cfg.trees, cfg.matchState, cfg.handlers,
    cfg.hitCacheByMethod, RouterCache,
    EMPTY_PARAMS, CACHE_META, DYNAMIC_META, cfg.terminalSlab, cfg.paramsFactories,
  ) as CompiledMatch<T>;

  runWarmup(compiled, cfg);
  return compiled;
}

/**
 * Warm the compiled match implementation past JSC's baseline thresholds
 * across each active method so the first user request lands on at least
 * baseline-compiled code rather than the cold first-call path.
 */
function runWarmup<T>(compiled: CompiledMatch<T>, cfg: MatchConfig<T>): void {
  const warmPaths = ['/__zipbul_warmup__', '/__zipbul_warmup__/sub'];
  for (let it = 0; it < WARMUP_ITERATIONS; it++) {
    for (const [methodName] of cfg.activeMethodCodes) {
      for (const p of warmPaths) {
        try { compiled(methodName, p); } catch { /* warmup non-fatal */ }
      }
    }
  }
}
