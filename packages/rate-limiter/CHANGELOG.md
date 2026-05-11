# @zipbul/rate-limiter

## 0.2.4

### Patch Changes

- 5744dc2: Remove `stack` property from `Err` type. Result pattern represents expected failures where stack traces are unnecessary — error data alone should describe the cause and origin. This aligns with how Rust's `Result` and Go's `error` handle expected failures.

  BREAKING CHANGE: `Err` no longer has a `stack` property. Access `err().stack` will be `undefined`.

- Updated dependencies [5744dc2]
  - @zipbul/result@1.0.0

## 0.2.3

### Patch Changes

- 2ebbfa4: chore: remove sourcemap generation from build scripts
- Updated dependencies [2ebbfa4]
  - @zipbul/result@0.1.7

## 0.2.2

### Patch Changes

- b6c0f72: docs: remove redundant Exports sections from READMEs
- Updated dependencies [b6c0f72]
  - @zipbul/result@0.1.6

## 0.2.1

### Patch Changes

- 665e37c: chore: quality audit across all public packages

  - Add `sideEffects: false` and `publishConfig.provenance` to all packages
  - Add `.npmignore` to all packages
  - Expand npm keywords for better discoverability
  - Use explicit named exports in barrel files (shared, cors)
  - Improve README descriptions, add Exports sections, fix inaccuracies
  - Add root `.editorconfig`
  - Add router to CI/CD pipeline

- Updated dependencies [665e37c]
  - @zipbul/result@0.1.5

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
