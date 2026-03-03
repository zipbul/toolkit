import { RateLimitAction } from '../enums';
import type { RateLimitRule, RateLimiterStore, StoreEntry } from '../interfaces';
import type { RateLimitResult } from '../types';

/**
 * Generic Cell Rate Algorithm (GCRA).
 *
 * StoreEntry mapping:
 * - value: TAT (Theoretical Arrival Time) in ms
 * - prev: unused (0)
 * - windowStart: unused (0)
 */
export function gcra(
  key: string,
  rule: RateLimitRule,
  cost: number,
  now: number,
  store: RateLimiterStore,
  peek: boolean,
): RateLimitResult | Promise<RateLimitResult> {
  const emissionInterval = rule.window / rule.limit;
  const increment = emissionInterval * cost;
  const burstOffset = rule.window;

  if (peek) {
    return peekGcra(key, rule, now, store, emissionInterval, increment, burstOffset);
  }

  let result!: RateLimitResult;

  const entry = store.update(key, (current) => {
    const tat = current !== null ? Math.max(current.value, now) : now;
    const newTat = tat + increment;
    const allowAt = newTat - burstOffset;

    if (allowAt > now) {
      result = {
        action: RateLimitAction.Deny,
        remaining: 0,
        limit: rule.limit,
        resetAt: Math.ceil(tat),
        retryAfter: Math.ceil(allowAt - now),
      };
      // Deny: return existing state unchanged, or minimal entry for new keys
      if (current !== null) return current;
      return { value: 0, prev: 0, windowStart: 0 };
    }

    const remaining = Math.max(0, Math.floor((burstOffset - (newTat - now)) / emissionInterval));
    result = {
      action: RateLimitAction.Allow,
      remaining,
      limit: rule.limit,
      resetAt: Math.ceil(newTat),
    };
    return { value: newTat, prev: 0, windowStart: 0 };
  });

  if (entry instanceof Promise) {
    return entry.then(() => result);
  }
  return result;
}

async function peekGcra(
  key: string,
  rule: RateLimitRule,
  now: number,
  store: RateLimiterStore,
  emissionInterval: number,
  increment: number,
  burstOffset: number,
): Promise<RateLimitResult> {
  const current = await store.get(key);
  const tat = current !== null ? Math.max(current.value, now) : now;
  const newTat = tat + increment;
  const allowAt = newTat - burstOffset;

  if (allowAt > now) {
    return {
      action: RateLimitAction.Deny,
      remaining: 0,
      limit: rule.limit,
      resetAt: Math.ceil(tat),
      retryAfter: Math.ceil(allowAt - now),
    };
  }

  const remaining = Math.max(0, Math.floor((burstOffset - (newTat - now)) / emissionInterval));
  return {
    action: RateLimitAction.Allow,
    remaining,
    limit: rule.limit,
    resetAt: Math.ceil(newTat),
  };
}

/**
 * Refunds a previously consumed GCRA request by reducing the TAT.
 */
export function refundGcra(
  key: string,
  rule: RateLimitRule,
  cost: number,
  store: RateLimiterStore,
): void | Promise<void> {
  const emissionInterval = rule.window / rule.limit;
  const increment = emissionInterval * cost;
  const result = store.update(key, (current: StoreEntry | null) => {
    if (current === null) return { value: 0, prev: 0, windowStart: 0 };
    return { value: current.value - increment, prev: 0, windowStart: 0 };
  });
  if (result instanceof Promise) return result.then(() => {});
}
