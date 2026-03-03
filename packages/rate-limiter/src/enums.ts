/**
 * Discriminant for {@link RateLimitResult}.
 * Determines whether the request is allowed or denied.
 */
export enum RateLimitAction {
  /** Request is within rate limits. */
  Allow,
  /** Request exceeds rate limits. */
  Deny,
}

/**
 * Reason why rate limiter options validation failed or a store error occurred.
 */
export enum RateLimiterErrorReason {
  /** limit must be a positive integer. */
  InvalidLimit,
  /** window must be a positive integer (milliseconds). */
  InvalidWindow,
  /** cost must be a non-negative integer. */
  InvalidCost,
  /** Unsupported algorithm value. */
  InvalidAlgorithm,
  /** rules must not be empty. */
  EmptyRules,
  /** Store operation failed at runtime. */
  StoreError,
}

/**
 * Rate limiting algorithm to use.
 */
export enum Algorithm {
  /** Generic Cell Rate Algorithm. */
  GCRA,
  /** Sliding window counter. */
  SlidingWindow,
  /** Token bucket. */
  TokenBucket,
}
