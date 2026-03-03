import { RateLimitAction } from '../enums';
import type { RateLimitRule, RateLimiterStore } from '../interfaces';
import type { RateLimitResult } from '../types';

/**
 * Sliding Window Counter algorithm.
 *
 * StoreEntry mapping:
 * - value: current window count
 * - prev: previous window count
 * - windowStart: current window start timestamp (ms)
 */
export function slidingWindow(
  key: string,
  rule: RateLimitRule,
  cost: number,
  now: number,
  store: RateLimiterStore,
  peek: boolean,
): RateLimitResult | Promise<RateLimitResult> {
  if (peek) {
    return peekSlidingWindow(key, rule, cost, now, store);
  }

  let result!: RateLimitResult;

  const entry = store.update(key, (current) => {
    const { count, prev, windowStart } = resolveWindowState(current, now, rule);

    const weight = 1 - ((now - windowStart) / rule.window);
    const estimated = count + Math.floor(prev * weight);

    if (estimated + cost > rule.limit) {
      const resetAt = windowStart + rule.window;
      const retryAfter = Math.ceil(resetAt - now);
      result = {
        action: RateLimitAction.Deny,
        remaining: 0,
        limit: rule.limit,
        resetAt,
        retryAfter,
      };
      // Deny: return existing state unchanged
      if (current !== null) return current;
      return { value: 0, prev: 0, windowStart: now };
    }

    const newCount = count + cost;
    const remaining = Math.max(0, rule.limit - (estimated + cost));
    const resetAt = windowStart + rule.window;

    result = {
      action: RateLimitAction.Allow,
      remaining,
      limit: rule.limit,
      resetAt,
    };
    return { value: newCount, prev, windowStart };
  });

  if (entry instanceof Promise) {
    return entry.then(() => result);
  }
  return result;
}

function resolveWindowState(
  current: { value: number; prev: number; windowStart: number } | null,
  now: number,
  rule: RateLimitRule,
): { count: number; prev: number; windowStart: number } {
  if (current === null) {
    return { count: 0, prev: 0, windowStart: now };
  }

  const elapsed = now - current.windowStart;

  if (elapsed >= rule.window * 2) {
    return { count: 0, prev: 0, windowStart: now };
  }

  if (elapsed >= rule.window) {
    return {
      prev: current.value,
      count: 0,
      windowStart: current.windowStart + rule.window * Math.floor(elapsed / rule.window),
    };
  }

  return { count: current.value, prev: current.prev, windowStart: current.windowStart };
}

async function peekSlidingWindow(
  key: string,
  rule: RateLimitRule,
  cost: number,
  now: number,
  store: RateLimiterStore,
): Promise<RateLimitResult> {
  const current = await store.get(key);
  const { count, prev, windowStart } = resolveWindowState(current, now, rule);

  const weight = 1 - ((now - windowStart) / rule.window);
  const estimated = count + Math.floor(prev * weight);
  const resetAt = windowStart + rule.window;

  if (estimated + cost > rule.limit) {
    return {
      action: RateLimitAction.Deny,
      remaining: 0,
      limit: rule.limit,
      resetAt,
      retryAfter: Math.ceil(resetAt - now),
    };
  }

  const remaining = Math.max(0, rule.limit - (estimated + cost));
  return {
    action: RateLimitAction.Allow,
    remaining,
    limit: rule.limit,
    resetAt,
  };
}
