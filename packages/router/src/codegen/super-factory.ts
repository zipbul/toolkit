import type { RouteParams } from '../types';

import { NullProtoObj } from '../internal';
import { PathPartType } from '../tree';

export type SuperFactoryFn = (presentBitmask: number, u: string, v: Int32Array) => RouteParams;

export type FactoryCache = Map<string, SuperFactoryFn>;

export function createFactoryCache(): FactoryCache {
  return new Map();
}

export function getOrCreateSuperFactory(
  cache: FactoryCache,
  originalNames: ReadonlyArray<string>,
  originalTypes: ReadonlyArray<PathPartType.Param | PathPartType.Wildcard>,
  omitBehavior: boolean,
  decoder: (s: string) => string,
): SuperFactoryFn {
  let cacheKey = omitBehavior ? 'O:' : 'S:';
  for (let n = 0; n < originalNames.length; n++) {
    if (n > 0) {
      cacheKey += ',';
    }
    cacheKey += originalNames[n]!;
    cacheKey += originalTypes[n] === PathPartType.Wildcard ? '#w' : '#p';
  }
  const cached = cache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  let body = 'var p = new NullProtoObj();\nvar s = 0;\n';
  for (let n = 0; n < originalNames.length; n++) {
    const name = originalNames[n]!;
    const isWild = originalTypes[n] === PathPartType.Wildcard;
    const val = `u.substring(v[s*2], v[s*2+1])`;
    const assign = isWild ? val : `decoder(${val})`;
    body += `if (m & ${1 << n}) { p[${JSON.stringify(name)}] = ${assign}; s++; }`;
    if (!omitBehavior) {
      body += ` else { p[${JSON.stringify(name)}] = undefined; }`;
    }
    body += '\n';
  }
  body += 'return p;';
  const fresh = new Function('decoder', 'NullProtoObj', 'm', 'u', 'v', body).bind(null, decoder, NullProtoObj) as SuperFactoryFn;
  cache.set(cacheKey, fresh);
  return fresh;
}

export function computePresentBitmask(originalNames: ReadonlyArray<string>, present: ReadonlyArray<{ name: string }>): number {
  let mask = 0;
  for (let origIdx = 0; origIdx < originalNames.length; origIdx++) {
    const origName = originalNames[origIdx]!;
    for (let p = 0; p < present.length; p++) {
      if (present[p]!.name === origName) {
        mask |= 1 << origIdx;
        break;
      }
    }
  }
  return mask;
}
