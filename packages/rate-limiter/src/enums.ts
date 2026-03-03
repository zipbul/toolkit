/**
 * Discriminant for {@link RateLimitResult}.
 * Determines whether the request is allowed or denied.
 */
export enum RateLimitAction {
  /** Request is within rate limits. */
  Allow = 'allow',
  /** Request exceeds rate limits. */
  Deny = 'deny',
}

/**
 * Reason why rate limiter options validation failed or a store error occurred.
 */
export enum RateLimiterErrorReason {
  /** limit must be a positive integer. */
  InvalidLimit = 'invalid_limit',
  /** window must be a positive integer (milliseconds). */
  InvalidWindow = 'invalid_window',
  /** cost must be a non-negative integer. */
  InvalidCost = 'invalid_cost',
  /** Unsupported algorithm value. */
  InvalidAlgorithm = 'invalid_algorithm',
  /** rules must not be empty. */
  EmptyRules = 'empty_rules',
  /** Store operation failed at runtime. */
  StoreError = 'store_error',
}

/**
 * Rate limiting algorithm to use.
 */
export enum Algorithm {
  /** Generic Cell Rate Algorithm. */
  GCRA = 'gcra',
  /** Sliding window counter. */
  SlidingWindow = 'sliding_window',
  /** Token bucket. */
  TokenBucket = 'token_bucket',
}
