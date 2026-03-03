import { isErr } from '@zipbul/result';

import { Algorithm, RateLimitAction, RateLimiterErrorReason } from './enums';
import { RateLimiterError } from './interfaces';
import type { ConsumeOptions, RateLimiterOptions } from './interfaces';
import { resolveRateLimiterOptions, validateRateLimiterOptions } from './options';
import type { AlgorithmFn, RateLimitResult, RefundFn, ResolvedRateLimiterOptions } from './types';
import { gcra, refundGcra } from './algorithms/gcra';
import { slidingWindow, refundSlidingWindow } from './algorithms/sliding-window';
import { tokenBucket, refundTokenBucket } from './algorithms/token-bucket';

const ALGORITHM_MAP: Record<Algorithm, AlgorithmFn> = {
  [Algorithm.GCRA]: gcra,
  [Algorithm.SlidingWindow]: slidingWindow,
  [Algorithm.TokenBucket]: tokenBucket,
};

const REFUND_MAP: Record<Algorithm, RefundFn> = {
  [Algorithm.GCRA]: refundGcra,
  [Algorithm.SlidingWindow]: refundSlidingWindow,
  [Algorithm.TokenBucket]: refundTokenBucket,
};

/**
 * Framework-agnostic rate limiter engine.
 * Supports multiple algorithms, pluggable stores, and compound rules.
 */
export class RateLimiter {
  private readonly algorithmFn: AlgorithmFn;
  private readonly refundFn: RefundFn;

  private constructor(private readonly options: ResolvedRateLimiterOptions) {
    this.algorithmFn = ALGORITHM_MAP[options.algorithm];
    this.refundFn = REFUND_MAP[options.algorithm];
  }

  /**
   * Creates a RateLimiter instance after resolving and validating options.
   *
   * @throws {RateLimiterError} when options fail validation.
   * @returns A ready-to-use RateLimiter instance.
   */
  public static create(options: RateLimiterOptions): RateLimiter {
    const resolved = resolveRateLimiterOptions(options);
    const validation = validateRateLimiterOptions(resolved);

    if (isErr(validation)) {
      throw new RateLimiterError(validation.data);
    }

    return new RateLimiter(resolved);
  }

  /**
   * Consumes tokens for the given key.
   *
   * For compound rules (multiple rules), all rules are peeked first,
   * and only if all pass are they consumed.
   *
   * @throws {RateLimiterError} when the store fails at runtime or per-call cost is invalid.
   * @returns {RateLimitResult} A discriminated union — branch on `action` to determine the outcome.
   */
  public async consume(key: string, opts?: ConsumeOptions): Promise<RateLimitResult> {
    const cost = opts?.cost ?? this.options.cost;

    if (opts?.cost !== undefined && (!Number.isInteger(opts.cost) || opts.cost < 0)) {
      throw new RateLimiterError({
        reason: RateLimiterErrorReason.InvalidCost,
        message: 'cost must be a non-negative integer',
      });
    }

    const now = this.options.clock();
    const { rules, store } = this.options;

    let result: RateLimitResult;

    try {
      if (rules.length === 1) {
        result = await this.algorithmFn(key, rules[0]!, cost, now, store, false);
      } else {
        result = await this.consumeCompound(key, cost, now);
      }
    } catch (error) {
      if (error instanceof RateLimiterError) throw error;
      throw new RateLimiterError(
        { reason: RateLimiterErrorReason.StoreError, message: error instanceof Error ? error.message : 'Store operation failed' },
        { cause: error },
      );
    }

    if (result.action === RateLimitAction.Allow) {
      this.options.hooks.onConsume(key, result);
    } else {
      this.options.hooks.onLimit(key, result);
    }

    return result;
  }

  /**
   * Peeks at the current state for the given key without consuming tokens.
   *
   * @throws {RateLimiterError} when the store fails at runtime or per-call cost is invalid.
   * @returns {RateLimitResult} A discriminated union — branch on `action` to determine the outcome.
   */
  public async peek(key: string, opts?: ConsumeOptions): Promise<RateLimitResult> {
    const cost = opts?.cost ?? this.options.cost;

    if (opts?.cost !== undefined && (!Number.isInteger(opts.cost) || opts.cost < 0)) {
      throw new RateLimiterError({
        reason: RateLimiterErrorReason.InvalidCost,
        message: 'cost must be a non-negative integer',
      });
    }

    const now = this.options.clock();
    const { rules, store } = this.options;

    try {
      if (rules.length === 1) {
        return await this.algorithmFn(key, rules[0]!, cost, now, store, true);
      }

      return await this.peekCompound(key, cost, now);
    } catch (error) {
      if (error instanceof RateLimiterError) throw error;
      throw new RateLimiterError(
        { reason: RateLimiterErrorReason.StoreError, message: error instanceof Error ? error.message : 'Store operation failed' },
        { cause: error },
      );
    }
  }

  /**
   * Resets rate limit state for the given key, removing all associated entries.
   * For compound rules, removes entries for all rules.
   *
   * @throws {RateLimiterError} when the store fails at runtime.
   */
  public async reset(key: string): Promise<void> {
    const { rules, store } = this.options;

    try {
      if (rules.length === 1) {
        await store.delete(key);
      } else {
        for (let i = 0; i < rules.length; i++) {
          await store.delete(`${key}:rule_${i}`);
        }
      }
    } catch (error) {
      if (error instanceof RateLimiterError) throw error;
      throw new RateLimiterError(
        { reason: RateLimiterErrorReason.StoreError, message: error instanceof Error ? error.message : 'Store operation failed' },
        { cause: error },
      );
    }
  }

  /**
   * Compound consume: peek all rules first, then consume all if allowed.
   * If a TOCTOU race causes a deny during phase 2, already-consumed rules
   * are refunded (best-effort rollback).
   */
  private async consumeCompound(key: string, cost: number, now: number): Promise<RateLimitResult> {
    const { rules, store } = this.options;

    // Phase 1: Peek all rules
    const peekResults: RateLimitResult[] = [];
    for (let i = 0; i < rules.length; i++) {
      const ruleKey = `${key}:rule_${i}`;
      const peekResult = await this.algorithmFn(ruleKey, rules[i]!, cost, now, store, true);
      peekResults.push(peekResult);
    }

    // Check for any deny — return the most restrictive (longest retryAfter)
    const mostRestrictiveDeny = this.findMostRestrictiveDeny(peekResults);
    if (mostRestrictiveDeny !== null) return mostRestrictiveDeny;

    // Phase 2: All passed — consume all rules, with rollback on race deny
    const consumeResults: RateLimitResult[] = [];
    for (let i = 0; i < rules.length; i++) {
      const ruleKey = `${key}:rule_${i}`;
      const consumeResult = await this.algorithmFn(ruleKey, rules[i]!, cost, now, store, false);

      if (consumeResult.action === RateLimitAction.Deny) {
        // TOCTOU race: refund all previously consumed rules
        for (let j = 0; j < i; j++) {
          await this.refundFn(`${key}:rule_${j}`, rules[j]!, cost, store);
        }
        return consumeResult;
      }

      consumeResults.push(consumeResult);
    }

    return this.findMostRestrictiveAllow(consumeResults);
  }

  /**
   * Compound peek: peek all rules, return most restrictive result.
   */
  private async peekCompound(key: string, cost: number, now: number): Promise<RateLimitResult> {
    const { rules, store } = this.options;
    const results: RateLimitResult[] = [];

    for (let i = 0; i < rules.length; i++) {
      const ruleKey = `${key}:rule_${i}`;
      const peekResult = await this.algorithmFn(ruleKey, rules[i]!, cost, now, store, true);
      results.push(peekResult);
    }

    const mostRestrictiveDeny = this.findMostRestrictiveDeny(results);
    if (mostRestrictiveDeny !== null) return mostRestrictiveDeny;

    return this.findMostRestrictiveAllow(results);
  }

  private findMostRestrictiveDeny(results: RateLimitResult[]): RateLimitResult | null {
    let worst: Extract<RateLimitResult, { action: RateLimitAction.Deny }> | null = null;
    for (const r of results) {
      if (r.action === RateLimitAction.Deny) {
        if (worst === null || r.retryAfter > worst.retryAfter) {
          worst = r;
        }
      }
    }
    return worst;
  }

  private findMostRestrictiveAllow(results: RateLimitResult[]): RateLimitResult {
    // Defensive: if any consume returned deny (TOCTOU race), return it
    const raceDeny = this.findMostRestrictiveDeny(results);
    if (raceDeny !== null) return raceDeny;

    let best = results[0]!;
    for (let i = 1; i < results.length; i++) {
      if (results[i]!.remaining < best.remaining) {
        best = results[i]!;
      }
    }
    return best;
  }
}
