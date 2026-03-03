import type { RateLimitAllowResult, RateLimitDenyResult, RateLimitRule, RateLimiterHooks, RateLimiterStore } from './interfaces';
import type { Algorithm } from './enums';

/**
 * Discriminated union returned by {@link RateLimiter.consume} and {@link RateLimiter.peek}.
 * Branch on `action` to determine next step.
 */
export type RateLimitResult = RateLimitAllowResult | RateLimitDenyResult;

/**
 * Fully resolved rate limiter options with all defaults applied.
 */
export type ResolvedRateLimiterOptions = {
  rules: RateLimitRule[];
  algorithm: Algorithm;
  store: RateLimiterStore;
  clock: () => number;
  cost: number;
  hooks: Required<RateLimiterHooks>;
};

/**
 * Signature for algorithm implementation functions.
 *
 * @param key - The rate limit key.
 * @param rule - The rate limit rule to enforce.
 * @param cost - Number of tokens to consume.
 * @param now - Current timestamp in milliseconds.
 * @param store - The storage backend.
 * @param peek - If true, do not modify state (read-only check).
 */
export type AlgorithmFn = (
  key: string,
  rule: RateLimitRule,
  cost: number,
  now: number,
  store: RateLimiterStore,
  peek: boolean,
) => RateLimitResult | Promise<RateLimitResult>;

/**
 * Signature for algorithm refund functions.
 * Used to undo a consume when compound rules encounter a TOCTOU race.
 */
export type RefundFn = (
  key: string,
  rule: RateLimitRule,
  cost: number,
  store: RateLimiterStore,
) => void | Promise<void>;
