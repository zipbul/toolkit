# @zipbul/rate-limiter

[English](./README.md) | **한국어**

[![npm](https://img.shields.io/npm/v/@zipbul/rate-limiter)](https://www.npmjs.com/package/@zipbul/rate-limiter)
![coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/parkrevil/3965fb9d1fe2d6fc5c321cb38d88c823/raw/rate-limiter-coverage.json)

다중 알고리즘과 교체 가능한 스토어를 지원하는 프레임워크 무관 속도 제한 엔진.

> 외부 런타임 의존성 없음. Bun 전용 설계.

<br>

## 📦 설치

```bash
bun add @zipbul/rate-limiter
```

<br>

## 🚀 빠른 시작

```typescript
import { RateLimiter, Algorithm, RateLimitAction } from '@zipbul/rate-limiter';

const limiter = RateLimiter.create({
  rules: { limit: 100, window: 60_000 },   // 분당 100회
  algorithm: Algorithm.SlidingWindow,
});

const result = await limiter.consume('user:123');

if (result.action === RateLimitAction.Allow) {
  // 요청 처리
  console.log(result.remaining); // 남은 토큰
} else {
  // 속도 제한
  console.log(result.retryAfter); // 재시도까지 ms
}
```

<br>

## 🧮 알고리즘

세 가지 내장 알고리즘을 제공합니다. 동일한 API를 공유하며, `algorithm`만 변경하면 됩니다.

| 알고리즘 | 적합한 용도 | 동작 |
|:---------|:-----------|:-----|
| `SlidingWindow` _(기본)_ | 일반 API 속도 제한 | 현재/이전 윈도우 간 가중 보간 |
| `TokenBucket` | 버스트 트래픽 + 안정적 충전 | 고정 속도로 연속 토큰 충전 |
| `GCRA` | 엄격한 스케줄링 / 셀 레이트 제어 | 요청별 이론적 도착 시간(TAT) 추적 |

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

## ⚙️ 옵션

```typescript
interface RateLimiterOptions {
  rules: RateLimitRule | RateLimitRule[];  // 필수
  algorithm?: Algorithm;       // 기본값: SlidingWindow
  store?: RateLimiterStore;    // 기본값: MemoryStore
  clock?: () => number;        // 기본값: Date.now
  cost?: number;               // 기본값: 1
  hooks?: RateLimiterHooks;
}
```

### `rules`

하나 이상의 속도 제한 규칙. 여러 규칙이 제공되면 **모두 통과해야** 허용됩니다 (복합 검사).

```typescript
// 단일 규칙
RateLimiter.create({
  rules: { limit: 100, window: 60_000 },
});

// 복합 규칙: 초당 10회 AND 분당 100회
RateLimiter.create({
  rules: [
    { limit: 10, window: 1000 },
    { limit: 100, window: 60_000 },
  ],
});
```

### `store`

교체 가능한 스토리지 백엔드. 기본값은 인메모리 `Map` 기반 스토어입니다.

```typescript
import { MemoryStore } from '@zipbul/rate-limiter';

RateLimiter.create({
  rules: { limit: 100, window: 60_000 },
  store: new MemoryStore({ maxSize: 10_000, ttl: 120_000 }),
});
```

### `cost`

요청당 소비되는 기본 토큰 수. 호출 시 개별 지정 가능합니다.

```typescript
const limiter = RateLimiter.create({
  rules: { limit: 100, window: 60_000 },
  cost: 1,
});

// 고비용 엔드포인트는 5토큰 소비
await limiter.consume('user:123', { cost: 5 });
```

### `hooks`

모니터링 및 로깅을 위한 라이프사이클 콜백.

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

새 속도 제한 인스턴스를 생성합니다. 잘못된 옵션이면 `RateLimiterError`를 throw합니다.

### `limiter.consume(key, options?)`

주어진 키에 대해 토큰을 소비합니다. 판별 공용체를 반환합니다:

```typescript
type RateLimitResult = RateLimitAllowResult | RateLimitDenyResult;
```

| 필드 | Allow | Deny |
|:-----|:------|:-----|
| `action` | `'allow'` | `'deny'` |
| `remaining` | 남은 토큰 | `0` |
| `limit` | 윈도우당 최대 토큰 | 윈도우당 최대 토큰 |
| `resetAt` | 윈도우 리셋 시각 (ms) | 윈도우 리셋 시각 (ms) |
| `retryAfter` | — | 다음 허용까지 ms |

### `limiter.peek(key, options?)`

`consume`과 동일하지만 **상태를 변경하지 않습니다**. 토큰을 소비하지 않고 제한 상태를 확인할 때 사용합니다.

### `limiter.reset(key)`

주어진 키의 모든 속도 제한 상태를 제거합니다.

<br>

## 💾 스토어

### `MemoryStore`

기본 인메모리 스토어. 단일 프로세스 배포에 적합합니다.

```typescript
import { MemoryStore } from '@zipbul/rate-limiter';

new MemoryStore({
  maxSize: 10_000,   // FIFO 퇴출 (기본: 무제한)
  ttl: 120_000,      // 지연 TTL (ms) (기본: 만료 없음)
});
```

### `RedisStore`

낙관적 잠금(Lua CAS)을 사용하는 분산 스토어.

```typescript
import { RedisStore } from '@zipbul/rate-limiter';
import Redis from 'ioredis';

const redis = new Redis();
const store = new RedisStore({
  client: {
    eval: (script, keys, args) =>
      redis.eval(script, keys.length, ...keys, ...args),
  },
  prefix: 'rl:',      // 키 접두사 (기본: 'rl:')
  ttl: 120_000,        // PEXPIRE (ms) (기본: 만료 없음)
  maxRetries: 5,       // CAS 재시도 제한 (기본: 5)
});

RateLimiter.create({
  rules: { limit: 100, window: 60_000 },
  store,
});
```

### `withFallback`

주 스토어 장애 시 자동으로 대체 스토어로 전환하는 래퍼입니다.

```typescript
import { withFallback, MemoryStore } from '@zipbul/rate-limiter';

const store = withFallback(redisStore, new MemoryStore(), {
  healthCheck: async () => redis.ping() === 'PONG',
  restoreInterval: 30_000, // 헬스체크 간격 (기본: 30초)
});

// 종료 시 타이머 정리
store.dispose();
```

<br>

## 🚨 에러 처리

`RateLimiter.create()`는 잘못된 옵션에서 throw합니다. `consume()`은 스토어 실패를 `RateLimiterError`로 래핑합니다.

```typescript
import { RateLimiter, RateLimiterError, RateLimiterErrorReason } from '@zipbul/rate-limiter';

try {
  await limiter.consume('user:123');
} catch (e) {
  if (e instanceof RateLimiterError) {
    e.reason;  // RateLimiterErrorReason.StoreError
    e.message; // "Store operation failed"
    e.cause;   // 원본 에러
  }
}
```

### `RateLimiterErrorReason`

| Reason | 발생 위치 | 설명 |
|:-------|:---------|:-----|
| `InvalidLimit` | `create()` | `limit`가 양의 정수가 아님 |
| `InvalidWindow` | `create()` | `window`가 양의 정수(ms)가 아님 |
| `InvalidCost` | `create()` / `consume()` | `cost`가 0 이상의 정수가 아님 |
| `InvalidAlgorithm` | `create()` | 지원하지 않는 알고리즘 |
| `EmptyRules` | `create()` | `rules`가 비어있음 |
| `StoreError` | `consume()` / `peek()` | 런타임 스토어 작업 실패 |

<br>

## 🔌 커스텀 스토어

`RateLimiterStore` 인터페이스를 구현하여 원하는 백엔드를 사용할 수 있습니다:

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

## 📄 라이선스

MIT
