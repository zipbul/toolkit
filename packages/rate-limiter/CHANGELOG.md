# @zipbul/rate-limiter

## 0.2.0

### Minor Changes

- 3c01b4d: Initial release of `@zipbul/rate-limiter`.

  ### Features

  - **3 algorithms**: GCRA, Sliding Window (default), Token Bucket
  - **Pluggable stores**: MemoryStore (in-memory), RedisStore (distributed via Lua CAS), withFallback (automatic failover)
  - **Compound rules**: multiple rate limit rules evaluated atomically (peek-all, consume-all with best-effort rollback)
  - **Variable cost**: per-call token cost override
  - **Lifecycle hooks**: `onConsume` / `onLimit` callbacks
  - **Full TypeScript**: discriminated union results (`RateLimitAction.Allow | Deny`)
  - **Zero external runtime dependencies**

  ### MemoryStore

  - Configurable `maxSize` (FIFO eviction) and `ttl` (lazy expiry)
  - Injected `clock` for deterministic testing

  ### RedisStore

  - Optimistic locking via Lua scripts (atomic compare-and-swap)
  - Adapter pattern: works with any Redis client implementing `eval()`
  - Configurable key prefix, TTL, and CAS retry limit

### Patch Changes

- 3c01b4d: Verify CI publish pipeline (OIDC trusted publishing).

## 0.1.0

### Minor Changes

- Initial release of `@zipbul/rate-limiter`.

  ### Features

  - **3 algorithms**: GCRA, Sliding Window (default), Token Bucket
  - **Pluggable stores**: MemoryStore (in-memory), RedisStore (distributed via Lua CAS), withFallback (automatic failover)
  - **Compound rules**: multiple rate limit rules evaluated atomically (peek-all, consume-all with best-effort rollback)
  - **Variable cost**: per-call token cost override
  - **Lifecycle hooks**: `onConsume` / `onLimit` callbacks
  - **Full TypeScript**: discriminated union results (`RateLimitAction.Allow | Deny`)
  - **Zero external runtime dependencies**

  ### MemoryStore

  - Configurable `maxSize` (FIFO eviction) and `ttl` (lazy expiry)
  - Injected `clock` for deterministic testing

  ### RedisStore

  - Optimistic locking via Lua scripts (atomic compare-and-swap)
  - Adapter pattern: works with any Redis client implementing `eval()`
  - Configurable key prefix, TTL, and CAS retry limit
