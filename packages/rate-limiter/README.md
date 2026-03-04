# @zipbul/rate-limiter

**English** | [한국어](./README.ko.md)

[![npm](https://img.shields.io/npm/v/@zipbul/rate-limiter)](https://www.npmjs.com/package/@zipbul/rate-limiter)
![coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/parkrevil/3965fb9d1fe2d6fc5c321cb38d88c823/raw/rate-limiter-coverage.json)

A framework-agnostic rate limiter engine with multiple algorithms and pluggable stores.

> Zero external runtime dependencies. Designed for Bun.

<br>

## 📦 Installation

```bash
bun add @zipbul/rate-limiter
```

<br>

## 🚀 Quick Start

```typescript
import { RateLimiter, Algorithm, RateLimitAction } from '@zipbul/rate-limiter';

const limiter = RateLimiter.create({
  rules: { limit: 100, window: 60_000 },   // 100 requests per minute
  algorithm: Algorithm.SlidingWindow,
});

const result = await limiter.consume('user:123');

if (result.action === RateLimitAction.Allow) {
  // proceed
  console.log(result.remaining); // tokens left
} else {
  // throttled
  console.log(result.retryAfter); // ms until retry
}
```

<br>

## 🧮 Algorithms

Three built-in algorithms are available. All share the same API — just change `algorithm`.

| Algorithm | Best for | Behavior |
|:----------|:---------|:---------|
| `SlidingWindow` _(default)_ | General API rate limiting | Weighted interpolation between current and previous window |
| `TokenBucket` | Bursty traffic with steady refill | Continuous token refill at a fixed rate |
| `GCRA` | Strict scheduling / cell rate control | Tracks Theoretical Arrival Time (TAT) per request |

```typescript
// Token Bucket
RateLimiter.create({
  rules: { limit: 10, window: 1000 },
  algorithm: Algorithm.TokenBucket,
});

// GCRA
RateLimiter.create({
  rules: { limit: 10, window: 1000 },
  algorithm: Algorithm.GCRA,
});
```

<br>

## ⚙️ Options

```typescript
interface RateLimiterOptions {
  rules: RateLimitRule | RateLimitRule[];  // Required
  algorithm?: Algorithm;       // Default: SlidingWindow
  store?: RateLimiterStore;    // Default: MemoryStore
  clock?: () => number;        // Default: Date.now
  cost?: number;               // Default: 1
  hooks?: RateLimiterHooks;
}
```

### `rules`

One or more rate limit rules. When multiple rules are provided, **all must pass** (compound check).

```typescript
// Single rule
RateLimiter.create({
  rules: { limit: 100, window: 60_000 },
});

// Compound rules: 10/s AND 100/min
RateLimiter.create({
  rules: [
    { limit: 10, window: 1000 },
    { limit: 100, window: 60_000 },
  ],
});
```

### `store`

Pluggable storage backend. Defaults to an in-memory `Map`-based store.

```typescript
import { MemoryStore } from '@zipbul/rate-limiter';

RateLimiter.create({
  rules: { limit: 100, window: 60_000 },
  store: new MemoryStore({ maxSize: 10_000, ttl: 120_000 }),
});
```

### `cost`

Default number of tokens consumed per request. Can be overridden per call.

```typescript
const limiter = RateLimiter.create({
  rules: { limit: 100, window: 60_000 },
  cost: 1,
});

// Expensive endpoint consumes 5 tokens
await limiter.consume('user:123', { cost: 5 });
```

### `hooks`

Lifecycle callbacks for monitoring and logging.

```typescript
RateLimiter.create({
  rules: { limit: 100, window: 60_000 },
  hooks: {
    onConsume: (key, result) => metrics.increment('rate_limit.allow'),
    onLimit: (key, result) => metrics.increment('rate_limit.deny'),
  },
});
```

<br>

## 📋 API

### `RateLimiter.create(options)`

Creates a new rate limiter instance. Throws `RateLimiterError` on invalid options.

### `limiter.consume(key, options?)`

Consumes tokens for the given key. Returns a discriminated union:

```typescript
type RateLimitResult = RateLimitAllowResult | RateLimitDenyResult;
```

| Field | Allow | Deny |
|:------|:------|:-----|
| `action` | `'allow'` | `'deny'` |
| `remaining` | Tokens left | `0` |
| `limit` | Max tokens per window | Max tokens per window |
| `resetAt` | Window reset timestamp (ms) | Window reset timestamp (ms) |
| `retryAfter` | — | ms until next allowed request |

### `limiter.peek(key, options?)`

Same as `consume` but **does not modify state**. Useful for checking limits without consuming tokens.

### `limiter.reset(key)`

Removes all rate limit state for the given key.

<br>

## 💾 Stores

### `MemoryStore`

Default in-memory store. Suitable for single-process deployments.

```typescript
import { MemoryStore } from '@zipbul/rate-limiter';

new MemoryStore({
  maxSize: 10_000,   // FIFO eviction (default: unlimited)
  ttl: 120_000,      // Lazy TTL in ms (default: no expiry)
});
```

### `RedisStore`

Distributed store using optimistic locking (CAS via Lua scripts).

```typescript
import { RedisStore } from '@zipbul/rate-limiter';
import Redis from 'ioredis';

const redis = new Redis();
const store = new RedisStore({
  client: {
    eval: (script, keys, args) =>
      redis.eval(script, keys.length, ...keys, ...args),
  },
  prefix: 'rl:',      // Key prefix (default: 'rl:')
  ttl: 120_000,        // PEXPIRE in ms (default: no expiry)
  maxRetries: 5,       // CAS retry limit (default: 5)
});

RateLimiter.create({
  rules: { limit: 100, window: 60_000 },
  store,
});
```

### `withFallback`

Wraps a primary store with automatic failover to a fallback store.

```typescript
import { withFallback, MemoryStore } from '@zipbul/rate-limiter';

const store = withFallback(redisStore, new MemoryStore(), {
  healthCheck: async () => redis.ping() === 'PONG',
  restoreInterval: 30_000, // Health check interval (default: 30s)
});

// Don't forget to clean up when done
store.dispose();
```

<br>

## 🚨 Error Handling

`RateLimiter.create()` throws on invalid options. `consume()` wraps store failures as `RateLimiterError`.

```typescript
import { RateLimiter, RateLimiterError, RateLimiterErrorReason } from '@zipbul/rate-limiter';

try {
  await limiter.consume('user:123');
} catch (e) {
  if (e instanceof RateLimiterError) {
    e.reason;  // RateLimiterErrorReason.StoreError
    e.message; // "Store operation failed"
    e.cause;   // Original error
  }
}
```

### `RateLimiterErrorReason`

| Reason | Thrown by | Description |
|:-------|:---------|:------------|
| `InvalidLimit` | `create()` | `limit` must be a positive integer |
| `InvalidWindow` | `create()` | `window` must be a positive integer (ms) |
| `InvalidCost` | `create()` / `consume()` | `cost` must be a non-negative integer |
| `InvalidAlgorithm` | `create()` | Unsupported algorithm value |
| `EmptyRules` | `create()` | `rules` must not be empty |
| `StoreError` | `consume()` / `peek()` | Store operation failed at runtime |

<br>

## 🔌 Custom Store

Implement the `RateLimiterStore` interface to use any backend:

```typescript
import type { RateLimiterStore, StoreEntry } from '@zipbul/rate-limiter';

class MyStore implements RateLimiterStore {
  update(key: string, updater: (current: StoreEntry | null) => StoreEntry): StoreEntry | Promise<StoreEntry> { /* ... */ }
  get(key: string): StoreEntry | null | Promise<StoreEntry | null> { /* ... */ }
  delete(key: string): void | Promise<void> { /* ... */ }
  clear(): void | Promise<void> { /* ... */ }
}
```

<br>

## 📄 License

MIT
