import type { OptionalParamDefaults } from '../builder/optional-param-defaults';
import type { RouterCache } from '../cache';
import type { MatchFn, MatchState } from '../matcher/match-state';
import type { NormalizeCfg } from '../matcher/path-normalize';
import type { WildCodegenEntry } from '../matcher/segment-walk';
import type { MatchOutput, RouteParams } from '../types';

import {
  CACHE_META,
  DYNAMIC_META,
  EMPTY_PARAMS,
  NullProtoObj,
  STATIC_META,
} from '../internal/null-proto-obj';
import { RouterCache as RouterCacheCtor } from '../cache';
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
export interface CacheEntry<T> {
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
  readonly useCache: boolean;
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
  readonly hitCacheByMethod: Map<number, RouterCache<CacheEntry<T>>> | undefined;
  readonly missCacheByMethod: Map<number, Set<string>> | undefined;
  readonly cacheMaxSize: number;
  // Build-output extras consumed only by codegen — not part of the closure
  // payload but needed to choose the emit shape.
  readonly activeMethodCodes: ReadonlyArray<readonly [string, number]>;
  readonly wildSpecs: Array<WildCodegenEntry[] | null>;
}

type CompiledMatch<T> = (method: string, path: string) => MatchOutput<T> | null;

/**
 * Compile a specialized match closure via `new Function()` based on the
 * router's actual config and registered routes. Dead code paths
 * (disabled cache, default case sensitivity, empty tree, no optional
 * defaults, etc.) are omitted entirely so the hot path only runs guards
 * that can fire.
 *
 * Cache read/write is inlined (no bound-method call overhead). All
 * helpers used by the hot path are closure-captured, not
 * `this.*`-dispatched.
 *
 * Public entry. Internal step functions (`detectSingleMethodWildSpec`,
 * `emitSpecializedWildMatchImpl`, `emitGenericMatchImpl`) stay file-local.
 */
export function compileMatchFn<T>(cfg: MatchConfig<T>): CompiledMatch<T> {
  const wild = detectSingleMethodWildSpec(cfg);

  if (wild !== null) {
    return emitSpecializedWildMatchImpl(cfg, wild);
  }

  return emitGenericMatchImpl(cfg);
}

/**
 * Shape-specialization gate: returns the wild entry list when this
 * router qualifies for the inline static-prefix wildcard fast path;
 * null otherwise. Conditions: single active method, no statics, no
 * cache, no opt-defaults, no testers, no case-fold, that method's tree
 * IS a static-prefix wildcard, prefix count ≤ 8.
 */
function detectSingleMethodWildSpec<T>(cfg: MatchConfig<T>): WildCodegenEntry[] | null {
  if (cfg.hasAnyStatic) return null;
  if (cfg.useCache) return null;
  if (cfg.hasOptDefaults) return null;
  if (cfg.anyTester) return null;
  if (cfg.lowerCase) return null;
  if (cfg.activeMethodCodes.length !== 1) return null;

  const [, activeCode] = cfg.activeMethodCodes[0]!;

  if (cfg.trees[activeCode] == null) return null;

  const wild = cfg.wildSpecs[activeCode];

  if (wild === null || wild === undefined) return null;
  // Past ~8 prefixes, the inline `startsWith` chain loses to the
  // segment-tree walker's NullProtoObj keying (5× slower at 50 prefixes
  // measured). Cap so file-server style routers (≤8 prefixes) still
  // get the inline win.
  if (wild.length > 8) return null;

  return wild;
}

/**
 * Emitter for the shape-specialized wildcard fast path.
 *
 * For pure static-prefix wildcard routers (file server / asset CDN),
 * emit a tiny matchImpl that returns MatchOutput directly. Skips
 * method-code translation, staticOutputs probe, tree dispatch + tr()
 * call, new ParamsCtor() + matchState.params write, and the
 * matchState.handlerIndex round-trip. The function is small enough
 * for JSC FTL to compile aggressively, matching memoirist's tight
 * `find()` cost profile.
 */
function emitSpecializedWildMatchImpl<T>(
  cfg: MatchConfig<T>,
  wildEntries: WildCodegenEntry[],
): CompiledMatch<T> {
  const [theMethod] = cfg.activeMethodCodes[0]!;
  const lines: string[] = [];

  if (cfg.checkPathLen) lines.push(`if (path.length > ${cfg.maxPathLen}) return null;`);
  lines.push(`if (method !== ${JSON.stringify(theMethod)}) return null;`);
  lines.push(`var sp = path;`);
  lines.push(`var qi = sp.indexOf('?'); if (qi !== -1) sp = sp.substring(0, qi);`);

  if (cfg.trimSlash) {
    lines.push(`if (sp.length > 1 && sp.charCodeAt(sp.length - 1) === 47) sp = sp.substring(0, sp.length - 1);`);
  }

  if (cfg.checkSegLen) {
    lines.push(`
      if (sp.length > ${cfg.maxSegLen}) {
        for (var i = 1, sl = 0, ml = ${cfg.maxSegLen}; i < sp.length; i++) {
          if (sp.charCodeAt(i) === 47) { sl = 0; }
          else { sl++; if (sl > ml) return null; }
        }
      }`);
  }

  // Per-prefix probes. Use full-prefix `startsWith('/X/', 0)` to fold the
  // leading-slash check into the same call (one fewer charCodeAt branch).
  // Object literal `{ "name": ... }` (JSON-quoted key) lets JSC pin a
  // stable hidden class while remaining safe for any wildcard name —
  // path-parser permits names that aren't strict JS identifiers, so we
  // can't emit a bare-key literal.
  for (const e of wildEntries) {
    const fullPrefixSlash = '/' + e.prefix + '/';
    const fullPrefixSlashLen = fullPrefixSlash.length;
    const minLen = e.wildcardOrigin === 'multi' ? fullPrefixSlashLen + 1 : fullPrefixSlashLen;
    const sliceStart = fullPrefixSlashLen;
    const nameKey = JSON.stringify(e.wildcardName);

    lines.push(`
      if (sp.length >= ${minLen} && sp.startsWith(${JSON.stringify(fullPrefixSlash)}, 0)) {
        return { value: handlers[${e.wildcardStore}], params: { ${nameKey}: sp.substring(${sliceStart}) }, meta: DYNAMIC_META };
      }`);

    if (e.wildcardOrigin === 'star') {
      const fullPrefix = '/' + e.prefix;

      lines.push(`
      if (sp.length === ${fullPrefix.length} && sp === ${JSON.stringify(fullPrefix)}) {
        return { value: handlers[${e.wildcardStore}], params: { ${nameKey}: '' }, meta: DYNAMIC_META };
      }`);
    }
  }

  lines.push(`return null;`);

  const tinyBody = lines.join('\n');
  const tinyFactory = new Function(
    'handlers', 'DYNAMIC_META',
    `return function match(method, path) {\n${tinyBody}\n};`,
  );

  return tinyFactory(cfg.handlers, DYNAMIC_META) as CompiledMatch<T>;
}

/**
 * Emitter for the generic matchImpl — every router that doesn't qualify
 * for the wildcard fast path. Assembles emit blocks based on `cfg`
 * flags so dead branches are omitted entirely:
 *
 *   1. method dispatch (single-method literal vs methodCodes lookup)
 *   2. path preprocessing (query strip, slash trim, lowercase)
 *   3. static lookup (closure-captured bucket vs methodCode-indexed)
 *   4. cache lookup (miss-set short-circuit + hit-cache return)
 *   5. dynamic match — segment walker (params written by walker)
 *      OR radix walker (params built from paramNames/paramValues)
 *   6. cache write + final MatchOutput return
 */
function emitGenericMatchImpl<T>(cfg: MatchConfig<T>): CompiledMatch<T> {
  const activeMethodCount = cfg.activeMethodCodes.length;
  const activeMethodLiteral = activeMethodCount === 1 ? cfg.activeMethodCodes[0]![0] : null;
  const activeMethodCode = activeMethodCount === 1 ? cfg.activeMethodCodes[0]![1] : -1;
  const cacheMaxSize = cfg.cacheMaxSize;
  const useCache = cfg.useCache;
  const anyTester = cfg.anyTester;
  const hasOptDefaults = cfg.hasOptDefaults;

  const emitMissCacheWrite = (): string => `
    var ms = missCacheByMethod.get(mc);
    if (ms === undefined) { ms = new Set(); missCacheByMethod.set(mc, ms); }
    if (ms.size >= ${cacheMaxSize}) {
      var oldest = ms.values().next().value;
      if (oldest !== undefined) ms.delete(oldest);
    }
    ms.add(sp);
  `;

  const src: string[] = [];

  const normCfg: NormalizeCfg = cfg;
  const pathLenJs = emitPathLenCheck(normCfg, 'path', 'return null;');

  if (pathLenJs !== '') src.push(pathLenJs);

  if (activeMethodCount === 1 && activeMethodLiteral !== null) {
    src.push(`if (method !== ${JSON.stringify(activeMethodLiteral)}) return null;`);
    src.push(`var mc = ${activeMethodCode};`);
  } else {
    src.push(`var mc = methodCodes[method]; if (mc === undefined) return null;`);
  }

  src.push(emitQueryStrip('path', 'sp'));

  const trimJs = emitTrailingSlashTrim(normCfg, 'sp');

  if (trimJs !== '') src.push(trimJs);

  const lowerJs = emitLowerCase(normCfg, 'sp');

  if (lowerJs !== '') src.push(lowerJs);

  // Static lookup. Single-method case closure-captures the resolved
  // bucket (`activeBucket`) so the lookup collapses to one property
  // access; multi-method indexes by methodCode at runtime.
  if (cfg.hasAnyStatic) {
    if (activeMethodCount === 1) {
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

  if (!cfg.hasAnyTree) {
    if (useCache) src.push(emitMissCacheWrite());
    src.push(`return null;`);
  } else {
    // Per-segment length scan, deferred until after static lookup so
    // static cache hits skip it. Path shorter than maxSegLen cannot have
    // a segment that exceeds it — emitter elides the loop in that case.
    const segJs = emitSegLenCheck(normCfg, 'sp', 'return null;');

    if (segJs !== '') src.push(segJs);

    // Segment walker writes params directly into matchState.params on the
    // success-return path only (no commit/rollback). errorKind/errorMessage
    // reset is skipped when no route has a regex pattern — TIMEOUT path is
    // dead so the channel never gets dirty.
    src.push(`
      var tr = trees[mc];
      if (!tr) {
        ${useCache ? emitMissCacheWrite() : ''}
        return null;
      }
      ${anyTester ? 'matchState.errorKind = null; matchState.errorMessage = null;' : ''}
      var params = new ParamsCtor();
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

    src.push(`var val = handlers[matchState.handlerIndex];`);

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
          cachedParams = new ParamsCtor();
          for (var cpk in params) cachedParams[cpk] = params[cpk];
        }
        hc.set(sp, { value: val, params: cachedParams });
      `);
    }

    src.push(`return { value: val, params: params, meta: DYNAMIC_META };`);
  }

  // Resolve the active bucket once for single-method routers so the
  // emitted code has a closure-captured reference (no per-call indexed
  // access into staticOutputsByMethod).
  const activeBucket = activeMethodCount === 1
    ? (cfg.staticOutputsByMethod[activeMethodCode] ?? new NullProtoObj() as Record<string, MatchOutput<T>>)
    : new NullProtoObj() as Record<string, MatchOutput<T>>;

  const body = src.join('\n');
  const factory = new Function(
    'staticOutputsByMethod', 'activeBucket', 'staticMap', 'methodCodes', 'trees', 'matchState', 'handlers',
    'optDefaults', 'hitCacheByMethod', 'missCacheByMethod', 'RouterCacheCtor',
    'EMPTY_PARAMS', 'STATIC_META', 'CACHE_META', 'DYNAMIC_META', 'ParamsCtor',
    `return function match(method, path) {\n${body}\n};`,
  );

  return factory(
    cfg.staticOutputsByMethod, activeBucket, cfg.staticMap, cfg.methodCodes, cfg.trees, cfg.matchState, cfg.handlers,
    cfg.optDefaults, cfg.hitCacheByMethod, cfg.missCacheByMethod, RouterCacheCtor,
    EMPTY_PARAMS, STATIC_META, CACHE_META, DYNAMIC_META, NullProtoObj,
  ) as CompiledMatch<T>;
}
