import type { RouterCache } from '../cache';
import type { MatchFn, MatchOutput, MatchState, RouteParams } from '../types';
import type { NormalizeCfg } from './path-normalize';

import { CACHE_META, DYNAMIC_META, EMPTY_PARAMS } from '../internal';
import { emitLowerCase, emitTrailingSlashTrim } from './path-normalize';
import { WARMUP_ITERATIONS } from './warmup';

interface MatchCacheEntry<T> {
  value: T;
  params: RouteParams;
}

interface MatchConfig<T> {
  readonly trimSlash: boolean;
  readonly lowerCase: boolean;
  readonly hasAnyTree: boolean;
  readonly hasAnyStatic: boolean;
  readonly staticOutputsByMethod: Array<Record<string, MatchOutput<T>> | undefined>;
  readonly methodCodes: Readonly<Record<string, number>>;
  readonly activeMethodMask: Int32Array;
  readonly staticByPath: Record<string, { mask: number; outputs: Array<MatchOutput<T> | undefined> }>;
  readonly rootFirstCharMaskByMethod: Array<Int32Array | null>;
  readonly trees: Array<MatchFn | null>;
  readonly matchState: MatchState;
  readonly handlers: T[];
  readonly hitCacheByMethod: Array<RouterCache<MatchCacheEntry<T>> | undefined>;
  readonly activeMethodCodes: ReadonlyArray<readonly [string, number]>;
  readonly terminalSlab: Int32Array;
  readonly paramsFactories: Array<((presentBitmask: number, u: string, v: Int32Array) => RouteParams) | null>;
}

type CompiledMatch<T> = (method: string, path: string) => MatchOutput<T> | null;

function compileMatchFn<T>(cfg: MatchConfig<T>): CompiledMatch<T> {
  const singleMethod = cfg.activeMethodCodes.length === 1 ? cfg.activeMethodCodes[0]! : null;

  if (cfg.hasAnyStatic && !cfg.hasAnyTree && singleMethod !== null) {
    return compileStaticOnlySingleMethod(cfg, singleMethod);
  }
  if (cfg.hasAnyStatic && !cfg.hasAnyTree) {
    return compileStaticOnlyMultiMethod(cfg);
  }
  return compileMixed(cfg, singleMethod);
}

type SingleMethodSpec = readonly [string, number];

function emitMethodDispatch(
  singleMethod: SingleMethodSpec | null,
  activeMethodCodes: ReadonlyArray<readonly [string, number]> | null,
): string {
  if (singleMethod !== null) {
    const [name, code] = singleMethod;
    return `if (method !== ${JSON.stringify(name)}) return null;\nvar mc = ${code};`;
  }
  return `var mc; ${emitMethodCharSwitch(activeMethodCodes, 'mc = $CODE; break;', 'return null;')}`;
}

function emitMethodCharSwitch(
  activeMethodCodes: ReadonlyArray<readonly [string, number]> | null,
  onHit: string,
  onMiss: string,
): string {
  const byFirst = new Map<number, Array<readonly [string, number]>>();
  let lengthMask = 0;
  if (activeMethodCodes !== null) {
    for (const entry of activeMethodCodes) {
      const c = entry[0].charCodeAt(0);
      let bucket = byFirst.get(c);
      if (bucket === undefined) {
        bucket = [];
        byFirst.set(c, bucket);
      }
      bucket.push(entry);
      lengthMask |= 1 << entry[0].length;
    }
  }
  let arms = '';
  for (const [c, bucket] of byFirst) {
    let inner = '';
    for (const [name, code] of bucket) {
      inner += `if (method === ${JSON.stringify(name)}) { ${onHit.replace('$CODE', String(code))} }\n`;
    }
    arms += `case ${c}: {\n${inner}${onMiss}\n}`;
  }
  const lenGate = lengthMask !== 0 ? `if ((${lengthMask} & (1 << method.length)) === 0) { ${onMiss} }\n` : '';
  return `${lenGate}switch (method.charCodeAt(0)) {\n${arms}default: ${onMiss}\n}`;
}

function emitNormalize(cfg: NormalizeCfg, outVar: string): string {
  const lines = [`var ${outVar} = path;`];
  const trim = emitTrailingSlashTrim(cfg, outVar);
  if (trim !== '') {
    lines.push(trim);
  }
  const lower = emitLowerCase(cfg, outVar);
  if (lower !== '') {
    lines.push(lower);
  }
  return lines.join('\n');
}

function emitStaticBucketProbe(singleMethod: SingleMethodSpec | null, key: string, gateOnNormalize: boolean): string {
  const open = gateOnNormalize ? `if (${key} !== path) {\n` : '';
  const close = gateOnNormalize ? `\n}` : '';
  if (singleMethod !== null) {
    return `
      ${open}var out = activeBucket[${key}];
      if (out !== undefined) return out;${close}`;
  }
  return `
      ${open}var entry = staticByPath[${key}];
      if (entry !== undefined && (entry.mask & (1 << mc)) !== 0) {
        return entry.outputs[mc];
      }${close}`;
}

function emitPreNormalizeStaticProbe(singleMethod: SingleMethodSpec | null): string {
  if (singleMethod !== null) {
    return `
      var preOut = activeBucket[path];
      if (preOut !== undefined) return preOut;`;
  }
  return `
      var preEntry = staticByPath[path];
      if (preEntry !== undefined && (preEntry.mask & (1 << mc)) !== 0) {
        return preEntry.outputs[mc];
      }`;
}

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

function emitRootMaskGate(singleMethod: SingleMethodSpec | null): string {
  return singleMethod !== null
    ? `if (rootMaskSingle !== null && sp.length > 1 && rootMaskSingle[sp.charCodeAt(1)] === 0) return null;`
    : `var rm = rootFirstCharMaskByMethod[mc]; if (rm !== null && sp.length > 1 && rm[sp.charCodeAt(1)] === 0) return null;`;
}

function emitWalkerAndPack(cfg: MatchConfig<unknown>, singleMethod: SingleMethodSpec | null): string {
  const dispatch =
    singleMethod !== null
      ? `var ok = tr0(sp, matchState);`
      : `var tr = trees[mc];
       if (!tr) return null;
       var ok = tr(sp, matchState);`;

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

function compileStaticOnlySingleMethod<T>(cfg: MatchConfig<T>, singleMethod: SingleMethodSpec): CompiledMatch<T> {
  const body = [
    emitMethodDispatch(singleMethod, null),
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

  const factory = new Function('activeBucket', `return function match(method, path) {\n${body}\n};`);

  const compiled = factory(cfg.staticOutputsByMethod[singleMethod[1]] ?? Object.create(null)) as CompiledMatch<T>;

  runWarmup(compiled, cfg);
  return compiled;
}

function compileStaticOnlyMultiMethod<T>(cfg: MatchConfig<T>): CompiledMatch<T> {
  const body = [
    emitMethodDispatch(null, cfg.activeMethodCodes),
    emitNormalize(cfg, 'sp'),
    `
      var entry = staticByPath[sp];
      if (entry !== undefined && (entry.mask & (1 << mc)) !== 0) {
        return entry.outputs[mc];
      }
      return null;`,
  ].join('\n');

  const factory = new Function('staticByPath', `return function match(method, path) {\n${body}\n};`);

  const compiled = factory(cfg.staticByPath) as CompiledMatch<T>;
  runWarmup(compiled, cfg);
  return compiled;
}

function compileMixed<T>(cfg: MatchConfig<T>, singleMethod: SingleMethodSpec | null): CompiledMatch<T> {
  function emitBodyLines(specForBody: SingleMethodSpec | null): string[] {
    const out: string[] = [];
    if (cfg.hasAnyStatic && cfg.hasAnyTree) {
      out.push(emitPreNormalizeStaticProbe(specForBody));
    }
    out.push(emitNormalize(cfg, 'sp'));
    if (cfg.hasAnyStatic) {
      out.push(emitStaticBucketProbe(specForBody, 'sp', true));
    }
    if (cfg.hasAnyTree) {
      out.push(emitRootMaskGate(specForBody));
    }
    out.push(emitHitCacheProbe());
    out.push(cfg.hasAnyTree ? emitWalkerAndPack(cfg, specForBody) : 'return null;');
    return out;
  }

  const activeBucket =
    singleMethod !== null ? (cfg.staticOutputsByMethod[singleMethod[1]] ?? Object.create(null)) : Object.create(null);
  const tr0 = singleMethod !== null ? (cfg.trees[singleMethod[1]] ?? null) : null;
  const rootMaskSingle = singleMethod !== null ? (cfg.rootFirstCharMaskByMethod[singleMethod[1]] ?? null) : null;

  let source: string;
  if (singleMethod !== null) {
    const body = [emitMethodDispatch(singleMethod, cfg.activeMethodCodes), ...emitBodyLines(singleMethod)].join('\n');
    source = `return function match(method, path) {\n${body}\n};`;
  } else {
    const activeBody = emitBodyLines(null).join('\n');
    const tableInit = cfg.activeMethodCodes.map(([name, code]) => `mcByMethod[${JSON.stringify(name)}] = ${code};`).join('\n');
    source = `
      function matchActive(mc, path) {
        ${activeBody}
      }
      var mcByMethod = Object.create(null);
      ${tableInit}
      return function match(method, path) {
        var mc = mcByMethod[method];
        return mc === undefined ? null : matchActive(mc, path);
      };
    `;
  }

  const factory = new Function(
    'activeBucket',
    'tr0',
    'rootMaskSingle',
    'staticByPath',
    'rootFirstCharMaskByMethod',
    'trees',
    'matchState',
    'handlers',
    'hitCacheByMethod',
    'EMPTY_PARAMS',
    'CACHE_META',
    'DYNAMIC_META',
    'terminalSlab',
    'paramsFactories',
    source,
  );

  const compiled = factory(
    activeBucket,
    tr0,
    rootMaskSingle,
    cfg.staticByPath,
    cfg.rootFirstCharMaskByMethod,
    cfg.trees,
    cfg.matchState,
    cfg.handlers,
    cfg.hitCacheByMethod,
    EMPTY_PARAMS,
    CACHE_META,
    DYNAMIC_META,
    cfg.terminalSlab,
    cfg.paramsFactories,
  ) as CompiledMatch<T>;

  runWarmup(compiled, cfg);
  return compiled;
}

function runWarmup<T>(compiled: CompiledMatch<T>, cfg: MatchConfig<T>): void {
  const warmPaths = ['/__zipbul_warmup__', '/__zipbul_warmup__/sub'];
  for (let it = 0; it < WARMUP_ITERATIONS; it++) {
    for (const [methodName] of cfg.activeMethodCodes) {
      for (const p of warmPaths) {
        compiled(methodName, p);
      }
    }
  }
}

export { compileMatchFn };
export type { MatchCacheEntry, MatchConfig };
