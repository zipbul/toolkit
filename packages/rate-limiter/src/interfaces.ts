import type { RateLimitAction, RateLimiterErrorReason, Algorithm } from './enums';

// ── Action Results ──────────────────────────────────────────────────

/**
 * Returned when the request is within rate limits.
 */
export interface RateLimitAllowResult {
  action: RateLimitAction.Allow;
  /** Remaining requests in the current window. */
  remaining: number;
  /** Maximum requests allowed per window. */
  limit: number;
  /** Unix timestamp (ms) when the window resets. */
  resetAt: number;
}

/**
 * Returned when the request exceeds rate limits.
 */
export interface RateLimitDenyResult {
  action: RateLimitAction.Deny;
  /** Remaining capacity (0 when fully exhausted). */
  remaining: 0;
  /** Maximum requests allowed per window. */
  limit: number;
  /** Unix timestamp (ms) when the window resets. */
  resetAt: number;
  /** Milliseconds until the next request may succeed. */
  retryAfter: number;
}

// ── Error ───────────────────────────────────────────────────────────

/**
 * Error data payload used by {@link RateLimiterError}.
 */
export interface RateLimiterErrorData {
  reason: RateLimiterErrorReason;
  message: string;
}

/**
 * Thrown by {@link RateLimiter.create} on invalid options, or by
 * {@link RateLimiter.consume} when the store fails at runtime.
 *
 * Inspect {@link reason} to programmatically distinguish error kinds.
 */
export class RateLimiterError extends Error {
  public readonly reason: RateLimiterErrorReason;

  constructor(data: RateLimiterErrorData, options?: { cause?: unknown }) {
    super(data.message, options);
    this.name = 'RateLimiterError';
    this.reason = data.reason;
  }
}

// ── Options ─────────────────────────────────────────────────────────

/**
 * A single rate limit rule: maximum `limit` requests per `window` milliseconds.
 */
export interface RateLimitRule {
  /** Maximum number of requests allowed. Must be a positive integer. */
  limit: number;
  /** Time window in milliseconds. Must be a positive integer. */
  window: number;
}

/**
 * Per-call options for {@link RateLimiter.consume}.
 */
export interface ConsumeOptions {
  /** Number of tokens to consume. Defaults to the instance-level cost. */
  cost?: number;
}

/**
 * Hooks called during rate limiter operations.
 */
export interface RateLimiterHooks {
  /** Called after a successful consume (Allow). */
  onConsume?: (key: string, result: RateLimitAllowResult) => void;
  /** Called when a consume is denied (Deny). */
  onLimit?: (key: string, result: RateLimitDenyResult) => void;
}

/**
 * Configuration for the {@link RateLimiter}.
 */
export interface RateLimiterOptions {
  /**
   * One or more rate limit rules.
   * When multiple rules are provided, all must pass (compound check).
   * Note: compound checks are not atomic across concurrent callers.
   */
  rules: RateLimitRule | RateLimitRule[];
  /**
   * Algorithm to use.
   * @defaultValue `Algorithm.SlidingWindow`
   */
  algorithm?: Algorithm;
  /**
   * Storage backend.
   * @defaultValue `new MemoryStore()`
   */
  store?: RateLimiterStore;
  /**
   * Clock function returning current time in milliseconds.
   * @defaultValue `Date.now`
   */
  clock?: () => number;
  /**
   * Default cost per consume call.
   * @defaultValue `1`
   */
  cost?: number;
  /**
   * Lifecycle hooks.
   */
  hooks?: RateLimiterHooks;
}

// ── Store ───────────────────────────────────────────────────────────

/**
 * A single store entry holding algorithm state.
 */
export interface StoreEntry {
  /** Primary value (TAT for GCRA, count for SlidingWindow, tokens for TokenBucket). */
  value: number;
  /** Secondary value (prev window count for SlidingWindow, unused for others). */
  prev: number;
  /** Window start timestamp or last refill time. */
  windowStart: number;
}

/**
 * Pluggable storage backend for rate limiter state.
 *
 * `update()` uses a callback pattern: the algorithm logic runs inside the
 * updater function. In-memory stores execute synchronously for atomicity;
 * Redis stores can wrap the updater in a Lua script.
 */
export interface RateLimiterStore {
  /**
   * Atomically read-modify-write an entry.
   * The updater receives the current entry (or null) and must return the new entry.
   */
  update(key: string, updater: (current: StoreEntry | null) => StoreEntry): StoreEntry | Promise<StoreEntry>;
  /**
   * Read an entry without modifying it.
   */
  get(key: string): StoreEntry | null | Promise<StoreEntry | null>;
  /**
   * Remove a single entry by key.
   */
  delete(key: string): void | Promise<void>;
  /**
   * Remove all entries.
   */
  clear(): void | Promise<void>;
}
