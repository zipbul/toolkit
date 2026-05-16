import type {
  MatchFn,
  MatchOutput,
  MatchState,
  RouteParams,
} from '../types';
import type { RouterCache } from '../cache';

import { CACHE_META, DYNAMIC_META, EMPTY_PARAMS } from '../internal';
import {
  emitLowerCase,
  emitTrailingSlashTrim,
  type NormalizeCfg,
} from './path-normalize';
import { WARMUP_ITERATIONS } from './warmup';

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
  readonly hasAnyStatic: boolean;
  readonly staticOutputsByMethod: Array<Record<string, MatchOutput<T>> | undefined>;
  readonly methodCodes: Readonly<Record<string, number>>;
  /** Per-methodCode active-flag table. `1` if any route is registered under
   *  this method's code, `0` otherwise. `methodCodes` carries 7 HTTP
   *  defaults on every router, so a hit there does not imply the method is
   *  active — the active-method short-circuit in `emitMethodDispatch` reads
   *  this mask to return null in one step for wrong-method calls. */
  readonly activeMethodMask: Int32Array;
  readonly trees: Array<MatchFn | null>;
  readonly matchState: MatchState;
  readonly handlers: T[];
  readonly hitCacheByMethod: Array<RouterCache<MatchCacheEntry<T>> | undefined>;
  readonly activeMethodCodes: ReadonlyArray<readonly [string, number]>;
  /**
   * Packed `Int32Array` slab carrying per-terminal metadata. Two slots
   * per terminal index `t`: `terminalSlab[t*3]` is the handler index,
   * `terminalSlab[t*3+1]` is `1` for wildcard terminals and `0` for
   * non-wildcard, `terminalSlab[t*3+2]` is the present-param bitmask
   * regular ones. Replaces the prior `terminalHandlers: number[]` +
   * `isWildcardByTerminal: boolean[]` parallel arrays so the hot path
   * reads contiguous typed memory.
   */
  readonly terminalSlab: Int32Array;
  readonly paramsFactories: Array<((presentBitmask: number, u: string, v: Int32Array) => RouteParams) | null>;
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
  const singleMethod = cfg.activeMethodCodes.length === 1 ? cfg.activeMethodCodes[0]! : null;

  // Three router shapes get three distinct emitters. Each emits a
  // single-purpose `new Function()` body: no shape branching at runtime,
  // no dead-code closure captures, and JSC ICs stay monomorphic per shape.
  if (cfg.hasAnyStatic && !cfg.hasAnyTree && singleMethod !== null) {
    return compileStaticOnlySingleMethod(cfg, singleMethod);
  }
  if (cfg.hasAnyStatic && !cfg.hasAnyTree) {
    return compileStaticOnlyMultiMethod(cfg);
  }
  return compileMixed(cfg, singleMethod);
}

type SingleMethodSpec = readonly [string, number];

/** Emit method-dispatch prelude. Single-method specialises to a literal compare.
 *  Multi-method form bakes the active-method check into the same branch as the
 *  codeMap miss: `methodCodes` carries 7 default HTTP methods on every router,
 *  so `mc !== undefined` does not imply the method is active. Without the
 *  `activeMethodMask[mc]` guard, wrong-method calls (e.g. DELETE against a
 *  GET-only route set) fall through pre-probe + cache get + walker dispatch
 *  before returning null. Memoirist's `root[method]` short-circuit returns
 *  null in one step; this guard matches that. */
function emitMethodDispatch(singleMethod: SingleMethodSpec | null): string {
  if (singleMethod !== null) {
    const [name, code] = singleMethod;
    return `if (method !== ${JSON.stringify(name)}) return null;\nvar mc = ${code};`;
  }
  return `var mc = methodCodes[method]; if (mc === undefined || activeMethodMask[mc] === 0) return null;`;
}

/** Emit `var sp = path;` plus the active normalization steps. */
function emitNormalize(cfg: NormalizeCfg, outVar: string): string {
  const lines = [`var ${outVar} = path;`];
  const trim = emitTrailingSlashTrim(cfg, outVar);
  if (trim !== '') lines.push(trim);
  const lower = emitLowerCase(cfg, outVar);
  if (lower !== '') lines.push(lower);
  return lines.join('\n');
}

/** Emit the post-normalize static-bucket probe. `gateOnNormalize=true`
 *  wraps the probe in `if (sp !== path)` — callers that already ran the
 *  pre-normalize probe should set this so the lookup is skipped when
 *  normalization was a no-op (default config: trim=false, lower=false). */
function emitStaticBucketProbe(
  singleMethod: SingleMethodSpec | null,
  key: string,
  gateOnNormalize: boolean,
): string {
  const open = gateOnNormalize ? `if (${key} !== path) {\n` : '';
  const close = gateOnNormalize ? `\n}` : '';
  if (singleMethod !== null) {
    return `
      ${open}var out = activeBucket[${key}];
      if (out !== undefined) return out;${close}`;
  }
  return `
      ${open}var bucket = staticOutputsByMethod[mc];
      if (bucket !== undefined) {
        var out = bucket[${key}];
        if (out !== undefined) return out;
      }${close}`;
}

/** Emit pre-normalize fast-path bucket probe (mixed routers only). */
function emitPreNormalizeStaticProbe(singleMethod: SingleMethodSpec | null): string {
  if (singleMethod !== null) {
    return `
      var preOut = activeBucket[path];
      if (preOut !== undefined) return preOut;`;
  }
  return `
      var preBucket = staticOutputsByMethod[mc];
      if (preBucket !== undefined) {
        var preOut = preBucket[path];
        if (preOut !== undefined) return preOut;
      }`;
}

/** Emit hit-cache probe — only dynamic results land in the cache. */
function emitHitCacheProbe(): string {
  return `
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
    }`;
}

/**
 * Emit walker dispatch + terminal-slab unpack + cache write. Only used
 * by the mixed/dynamic compiler; static-only emitters never reach here.
 */
function emitWalkerAndPack(cfg: MatchConfig<unknown>, singleMethod: SingleMethodSpec | null): string {
  const dispatch = singleMethod !== null
    ? `var ok = tr0(sp, matchState);`
    : `var tr = trees[mc];
       if (!tr) return null;
       var ok = tr(sp, matchState);`;

  // Trailing-slash recheck wrapped in `if (ok)` only matters when the
  // upstream normalizer didn't already trim. Skip the wrapper + dead
  // 4-condition `&&` chain entirely for trim-active routers (default).
  const trimRecheck = cfg.trimSlash
    ? ''
    : `
      if (ok && sp.length > 1 && sp.charCodeAt(sp.length - 1) === 47 && terminalSlab[matchState.handlerIndex * 3 + 1] === 0) {
        ok = false;
      }`;

  return `
    ${dispatch}

    var tIdx = matchState.handlerIndex;
    var slabBase = tIdx * 3;${trimRecheck}

    if (!ok) return null;

    var hIdx = terminalSlab[slabBase];
    var factory = paramsFactories[tIdx];
    var params = factory !== null
      ? factory(terminalSlab[slabBase + 2], sp, matchState.paramOffsets)
      : EMPTY_PARAMS;

    var val = handlers[hIdx];
    if (params !== EMPTY_PARAMS) Object.freeze(params);
    hc.set(sp, { value: val, params: params });
    return {
      value: val,
      params: params,
      meta: DYNAMIC_META,
    };`;
}

/**
 * Static-only, single-method. Pre-probes the closure-captured bucket
 * with the raw path; only normalizes on miss.
 */
function compileStaticOnlySingleMethod<T>(
  cfg: MatchConfig<T>,
  singleMethod: SingleMethodSpec,
): CompiledMatch<T> {
  const body = [
    emitMethodDispatch(singleMethod),
    `
      var out = activeBucket[path];
      if (out !== undefined) return out;`,
    emitNormalize(cfg, 'sp'),
    `
      if (sp !== path) {
        out = activeBucket[sp];
        if (out !== undefined) return out;
      }
      return null;`,
  ].join('\n');

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

/**
 * Static-only, multi-method. No pre-probe (would need per-mc bucket
 * resolution before normalize); just normalize and dispatch via mc.
 */
function compileStaticOnlyMultiMethod<T>(cfg: MatchConfig<T>): CompiledMatch<T> {
  const body = [
    emitMethodDispatch(null),
    emitNormalize(cfg, 'sp'),
    `
      var bucket = staticOutputsByMethod[mc];
      if (bucket !== undefined) {
        var out = bucket[sp];
        if (out !== undefined) return out;
      }
      return null;`,
  ].join('\n');

  const factory = new Function(
    'staticOutputsByMethod', 'methodCodes', 'activeMethodMask',
    `return function match(method, path) {\n${body}\n};`,
  );

  const compiled = factory(cfg.staticOutputsByMethod, cfg.methodCodes, cfg.activeMethodMask) as CompiledMatch<T>;
  runWarmup(compiled, cfg);
  return compiled;
}

/**
 * Mixed router (any tree, optionally with statics). Pre-probes static on
 * the raw path, normalizes, retries static on the normalized path, then
 * cache, then walker + slab unpack + cache write.
 */
function compileMixed<T>(cfg: MatchConfig<T>, singleMethod: SingleMethodSpec | null): CompiledMatch<T> {
  const lines: string[] = [emitMethodDispatch(singleMethod)];

  if (cfg.hasAnyStatic && cfg.hasAnyTree) {
    lines.push(emitPreNormalizeStaticProbe(singleMethod));
  }
  lines.push(emitNormalize(cfg, 'sp'));
  if (cfg.hasAnyStatic) {
    // Gate the post-normalize probe on `sp !== path` — when normalization
    // is a no-op (default config) the pre-probe already covered this key.
    lines.push(emitStaticBucketProbe(singleMethod, 'sp', /* gateOnNormalize */ true));
  }
  lines.push(emitHitCacheProbe());
  lines.push(cfg.hasAnyTree ? emitWalkerAndPack(cfg, singleMethod) : 'return null;');

  const body = lines.join('\n');
  const factory = new Function(
    'activeBucket', 'tr0', 'staticOutputsByMethod', 'methodCodes', 'activeMethodMask', 'trees', 'matchState', 'handlers',
    'hitCacheByMethod',
    'EMPTY_PARAMS', 'CACHE_META', 'DYNAMIC_META', 'terminalSlab', 'paramsFactories',
    `return function match(method, path) {\n${body}\n};`,
  );

  const activeBucket = singleMethod !== null
    ? cfg.staticOutputsByMethod[singleMethod[1]] ?? Object.create(null)
    : Object.create(null);
  const tr0 = singleMethod !== null ? (cfg.trees[singleMethod[1]] ?? null) : null;

  const compiled = factory(
    activeBucket, tr0, cfg.staticOutputsByMethod, cfg.methodCodes, cfg.activeMethodMask, cfg.trees, cfg.matchState, cfg.handlers,
    cfg.hitCacheByMethod,
    EMPTY_PARAMS, CACHE_META, DYNAMIC_META, cfg.terminalSlab, cfg.paramsFactories,
  ) as CompiledMatch<T>;

  runWarmup(compiled, cfg);
  return compiled;
}

/**
 * Warm the compiled match implementation past JSC's baseline thresholds
 * across each active method so the first user request lands on at least
 * baseline-compiled code rather than the cold first-call path.
 *
 * Exceptions propagate. A throw from `compiled` would mean a defective
 * `new Function()` body or a corrupted closure capture — both real
 * codegen bugs that should crash the build, not be silently swallowed.
 */
function runWarmup<T>(compiled: CompiledMatch<T>, cfg: MatchConfig<T>): void {
  const warmPaths = ['/__zipbul_warmup__', '/__zipbul_warmup__/sub'];
  for (let it = 0; it < WARMUP_ITERATIONS; it++) {
    for (const [methodName] of cfg.activeMethodCodes) {
      for (const p of warmPaths) compiled(methodName, p);
    }
  }
}
