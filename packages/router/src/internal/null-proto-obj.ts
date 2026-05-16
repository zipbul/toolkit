import type { MatchMeta, RouteParams } from '../types';

/**
 * Prototype-less object constructor — `new NullProtoObj()` produces an object
 * without `Object.prototype` lookups (~10-20% faster property access than
 * `{}`). Pattern borrowed from rou3/unjs.
 *
 * Using a *constructor function* (rather than `Object.create(null)` per
 * call) gives JSC a stable hidden class to track across instances. Hot-path
 * lookup tables (router's methodCodes, staticOutputsByMethod buckets, etc.)
 * rely on this stability — without it, the IC may go megamorphic and pay
 * a property-access tax on every match.
 */
export const NullProtoObj: { new (): Record<string, unknown> } = (() => {
  const F = function () {} as unknown as { new (): Record<string, unknown> };
  (F as unknown as { prototype: object }).prototype = Object.freeze(Object.create(null));
  return F;
})();

/**
 * Typed factory for a prototype-less bucket. Wraps the `NullProtoObj`
 * constructor so callers do not need a `as Record<string, V>` cast at
 * every call site to specialize the value type.
 */
export function createNullProtoBucket<V>(): Record<string, V> {
  return new NullProtoObj() as Record<string, V>;
}

/**
 * Singleton frozen empty params object. Returned for every static-route
 * match so callers see a consistent (and harmless) reference. Frozen so a
 * downstream caller cannot mutate it and corrupt other matches.
 */
export const EMPTY_PARAMS: RouteParams = Object.freeze(new NullProtoObj()) as RouteParams;

/** Match meta singletons — frozen so any stray mutation throws. */
export const STATIC_META: MatchMeta = Object.freeze({ source: 'static' } as const);
export const CACHE_META: MatchMeta = Object.freeze({ source: 'cache' } as const);
export const DYNAMIC_META: MatchMeta = Object.freeze({ source: 'dynamic' } as const);
