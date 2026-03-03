import { err } from '@zipbul/result';
import type { Result } from '@zipbul/result';

import { DEFAULT_ALGORITHM, DEFAULT_CLOCK, DEFAULT_COST, DEFAULT_HOOKS } from './constants';
import { Algorithm, RateLimiterErrorReason } from './enums';
import type { RateLimiterErrorData, RateLimiterOptions } from './interfaces';
import type { ResolvedRateLimiterOptions } from './types';
import { MemoryStore } from './stores/memory';

/**
 * Takes partial {@link RateLimiterOptions} and fills in every missing field
 * with a sensible default, returning fully populated {@link ResolvedRateLimiterOptions}.
 */
export function resolveRateLimiterOptions(options: RateLimiterOptions): ResolvedRateLimiterOptions {
  const rules = Array.isArray(options.rules) ? options.rules : [options.rules];

  return {
    rules,
    algorithm: options.algorithm ?? DEFAULT_ALGORITHM,
    store: options.store ?? new MemoryStore(),
    clock: options.clock ?? DEFAULT_CLOCK,
    cost: options.cost ?? DEFAULT_COST,
    hooks: {
      onConsume: options.hooks?.onConsume ?? DEFAULT_HOOKS.onConsume,
      onLimit: options.hooks?.onLimit ?? DEFAULT_HOOKS.onLimit,
    },
  };
}

/**
 * Validates a fully resolved {@link ResolvedRateLimiterOptions} object and returns
 * the first problem it finds, or `undefined` when everything looks good.
 */
export function validateRateLimiterOptions(resolved: ResolvedRateLimiterOptions): Result<void, RateLimiterErrorData> {
  if (resolved.rules.length === 0) {
    return err<RateLimiterErrorData>({
      reason: RateLimiterErrorReason.EmptyRules,
      message: 'rules must not be empty',
    });
  }

  for (const rule of resolved.rules) {
    if (!Number.isInteger(rule.limit) || rule.limit <= 0) {
      return err<RateLimiterErrorData>({
        reason: RateLimiterErrorReason.InvalidLimit,
        message: 'rule.limit must be a positive integer',
      });
    }

    if (!Number.isInteger(rule.window) || rule.window <= 0) {
      return err<RateLimiterErrorData>({
        reason: RateLimiterErrorReason.InvalidWindow,
        message: 'rule.window must be a positive integer (milliseconds)',
      });
    }
  }

  if (!Number.isInteger(resolved.cost) || resolved.cost < 0) {
    return err<RateLimiterErrorData>({
      reason: RateLimiterErrorReason.InvalidCost,
      message: 'cost must be a non-negative integer',
    });
  }

  if (!Object.values(Algorithm).includes(resolved.algorithm)) {
    return err<RateLimiterErrorData>({
      reason: RateLimiterErrorReason.InvalidAlgorithm,
      message: 'unsupported algorithm',
    });
  }

  return undefined;
}
