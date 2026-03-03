import { RateLimitAction } from '../enums';
import type { RateLimitRule, RateLimiterStore, StoreEntry } from '../interfaces';
import type { RateLimitResult } from '../types';

/**
 * Token Bucket algorithm.
 *
 * StoreEntry mapping:
 * - value: remaining tokens
 * - prev: unused (0)
 * - windowStart: last refill timestamp (ms)
 */
export function tokenBucket(
  key: string,
  rule: RateLimitRule,
  cost: number,
  now: number,
  store: RateLimiterStore,
  peek: boolean,
): RateLimitResult | Promise<RateLimitResult> {
  const refillRate = rule.limit / rule.window; // tokens per ms

  if (peek) {
    return peekTokenBucket(key, rule, cost, now, store, refillRate);
  }

  let result!: RateLimitResult;

  const entry = store.update(key, (current) => {
    let available: number;
    let lastRefill: number;

    if (current === null) {
      available = rule.limit;
      lastRefill = now;
    } else {
      const elapsed = now - current.windowStart;
      const refilled = Math.floor(elapsed * refillRate);
      available = Math.min(rule.limit, current.value + refilled);
      // Advance lastRefill only by the time actually consumed by refilled tokens
      // to avoid losing fractional tokens
      lastRefill = refilled > 0 ? current.windowStart + Math.floor(refilled / refillRate) : current.windowStart;
    }

    if (available < cost) {
      const deficit = cost - available;
      const retryAfter = Math.ceil(deficit / refillRate);
      const resetAt = now + Math.ceil((rule.limit - available) / refillRate);

      result = {
        action: RateLimitAction.Deny,
        remaining: 0,
        limit: rule.limit,
        resetAt,
        retryAfter,
      };
      return { value: available, prev: 0, windowStart: lastRefill };
    }

    const remaining = available - cost;
    const resetAt = remaining >= rule.limit
      ? now
      : now + Math.ceil((rule.limit - remaining) / refillRate);

    result = {
      action: RateLimitAction.Allow,
      remaining,
      limit: rule.limit,
      resetAt,
    };
    return { value: remaining, prev: 0, windowStart: lastRefill };
  });

  if (entry instanceof Promise) {
    return entry.then(() => result);
  }
  return result;
}

async function peekTokenBucket(
  key: string,
  rule: RateLimitRule,
  cost: number,
  now: number,
  store: RateLimiterStore,
  refillRate: number,
): Promise<RateLimitResult> {
  const current = await store.get(key);

  let available: number;

  if (current === null) {
    available = rule.limit;
  } else {
    const elapsed = now - current.windowStart;
    available = Math.min(rule.limit, current.value + Math.floor(elapsed * refillRate));
  }

  if (available < cost) {
    const deficit = cost - available;
    const retryAfter = Math.ceil(deficit / refillRate);
    const resetAt = now + Math.ceil((rule.limit - available) / refillRate);
    return {
      action: RateLimitAction.Deny,
      remaining: 0,
      limit: rule.limit,
      resetAt,
      retryAfter,
    };
  }

  const remaining = available - cost;
  const resetAt = remaining >= rule.limit
    ? now
    : now + Math.ceil((rule.limit - remaining) / refillRate);

  return {
    action: RateLimitAction.Allow,
    remaining,
    limit: rule.limit,
    resetAt,
  };
}

/**
 * Refunds a previously consumed token bucket request by adding tokens back.
 */
export function refundTokenBucket(
  key: string,
  rule: RateLimitRule,
  cost: number,
  store: RateLimiterStore,
): void | Promise<void> {
  const result = store.update(key, (current: StoreEntry | null) => {
    if (current === null) return { value: rule.limit, prev: 0, windowStart: 0 };
    return { value: Math.min(rule.limit, current.value + cost), prev: 0, windowStart: current.windowStart };
  });
  if (result instanceof Promise) return result.then(() => {});
}
