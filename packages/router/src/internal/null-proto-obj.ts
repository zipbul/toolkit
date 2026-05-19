import type { MatchMeta, RouteParams } from '../types';

import { MatchSource } from '../types';

export const NullProtoObj: { new (): Record<string, unknown> } = (() => {
  const F = function () {} as unknown as { new (): Record<string, unknown> };
  (F as unknown as { prototype: object }).prototype = Object.freeze(Object.create(null));
  return F;
})();

export function createNullProtoBucket<V>(): Record<string, V> {
  return new NullProtoObj() as Record<string, V>;
}

export const EMPTY_PARAMS: RouteParams = Object.freeze(new NullProtoObj()) as RouteParams;

export const STATIC_META: MatchMeta = Object.freeze({ source: MatchSource.Static } as const);
export const CACHE_META: MatchMeta = Object.freeze({ source: MatchSource.Cache } as const);
export const DYNAMIC_META: MatchMeta = Object.freeze({ source: MatchSource.Dynamic } as const);
