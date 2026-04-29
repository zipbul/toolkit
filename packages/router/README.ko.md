# @zipbul/router

[English](./README.md) | **한국어**

[![npm](https://img.shields.io/npm/v/@zipbul/router)](https://www.npmjs.com/package/@zipbul/router)
![coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/parkrevil/3965fb9d1fe2d6fc5c321cb38d88c823/raw/router-coverage.json)

Bun을 위한 고성능 세그먼트 트리 URL 라우터입니다.
HTTP 메서드별 트리 분리, 정규식 파라미터 패턴, 형제 파라미터 백트래킹, 구조화된 에러 처리를 지원합니다.

> 정적 라우트는 O(1) Map 조회로 해소됩니다. 동적 라우트는 `build()` 시점에 라우터 형태에 맞춰 emit 되는 워커 — 코드젠 specialist (정적 prefix 와일드카드), 코드젠 general (`compileSegmentTree`), 반복 (정적/파라미터 모호성 없을 때), 백트래킹 재귀 (범용 폴백) — 로 탐색합니다.

<br>

## 📦 설치

```bash
bun add @zipbul/router
```

<br>

## 🚀 빠른 시작

```typescript
import { Router, RouterError } from '@zipbul/router';

const router = new Router<string>();

router.add('GET', '/users', 'list-users');
router.add('GET', '/users/:id', 'get-user');
router.add('POST', '/users', 'create-user');
router.add('GET', '/files/*path', 'serve-file');

router.build();

const result = router.match('GET', '/users/42');

if (result) {
  console.log(result.value);       // 'get-user'
  console.log(result.params.id);   // '42'
  console.log(result.meta.source); // 'dynamic'
}
```

<br>

## 📚 API 레퍼런스

### `new Router<T>(options?)`

라우터 인스턴스를 생성합니다. `T`는 각 라우트에 저장되는 값의 타입입니다.

```typescript
const router = new Router<string>();
const router = new Router<() => Response>({ caseSensitive: false });
```

생성자 끝에서 인스턴스가 `Object.freeze` 됩니다. 모든 메서드는 화살표 함수 인스턴스 필드라 생성자 지역 변수를 클로저로 캡처합니다 — `const m = router.match; m(...)` 같은 detached 호출도 `bind()` 없이 안전합니다.

### `router.add(method, path, value)`

라우트를 등록합니다. 잘못된 경로, 중복 라우트, 또는 `build()` 이후 호출 시 `RouterError`를 던집니다.

```typescript
router.add('GET', '/users/:id', handler);
router.add(['GET', 'POST'], '/data', handler);  // 복수 메서드
router.add('*', '/health', handler);             // 모든 표준 메서드
```

`'*'`는 `GET / POST / PUT / PATCH / DELETE / OPTIONS / HEAD` 로 확장됩니다.

### `router.addAll(entries)`

여러 라우트를 한 번에 등록합니다. 첫 번째 실패 시 `RouterError`를 던지며 (fail-fast), `data.registeredCount`가 에러 직전까지 성공한 등록 수를 알려줍니다.

```typescript
router.addAll([
  ['GET', '/users', listUsers],
  ['POST', '/users', createUser],
  ['GET', '/users/:id', getUser],
]);
```

### `router.build()`

라우터를 봉인하고 특화된 매치 함수를 emit 합니다. `match()` 호출 전에 반드시 실행해야 합니다. `this`를 반환하며 두 번째 호출부터는 no-op 입니다.

```typescript
router.build();
```

`build()` 이후에는 `add()` / `addAll()` 가 `RouterError({ kind: 'router-sealed' })` 를 던집니다.

### `router.match(method, path)`

URL을 등록된 라우트와 매칭합니다. `MatchOutput<T> | null`을 반환합니다. **던지지 않습니다** — 잘못된 입력 (build 이전 호출, `maxPathLength` 초과, `maxSegmentLength` 초과, 매칭 라우트 없음) 은 모두 `null` 입니다.

```typescript
const result = router.match('GET', '/users/42');

if (result) {
  result.value;       // T — 등록된 값
  result.params;      // Record<string, string | undefined> (null-prototype)
  result.meta.source; // 'static' | 'cache' | 'dynamic'
}
```

`meta.source` 의 의미:

| 값 | 발생 시점 |
|:---|:----------|
| `'static'` | 경로가 `staticMap` 의 O(1) lookup 으로 매칭. 동일 경로 반복 시 *frozen 공유 객체* 가 반환되어 식별자 (`===`) 가 보존됨. |
| `'cache'` | `enableCache: true` 이고 동일 경로의 `'dynamic'` 매칭이 캐시에 적중한 경우. 캐시는 *스냅샷* 을 저장하므로 반환된 `params` 를 변경해도 다음 hit 에 영향 없음. |
| `'dynamic'` | 메서드별 트리 워커 (코드젠 specialist / 코드젠 general / 반복 / 재귀) 로 매칭. 매 호출마다 새 `MatchOutput` 과 새 `params` 객체가 반환됨. |

### `router.allowedMethods(path)`

`path` 에 등록된 HTTP 메서드 목록을 반환합니다. HTTP 어댑터가 `404` (라우트 자체 없음) 와 `405` (라우트는 있으나 메서드 불일치) 를 구분할 때 사용합니다.

```typescript
const result = router.match('GET', '/users/42');

if (result === null) {
  const allowed = router.allowedMethods('/users/42');
  if (allowed.length === 0) return respond404();
  return respond405({ Allow: allowed.join(', ') });
}
```

콜드패스 — `match()` 가 `null` 을 반환한 후에만 호출하세요. 활성 메서드 집합을 순회하며 각 메서드 트리 워커를 한 번씩 실행합니다 (`params` 컨테이너 한 개를 공유).

<br>

## 🛤️ 라우트 패턴

### 정적 라우트

```typescript
router.add('GET', '/users', handler);
router.add('GET', '/api/v1/health', handler);
```

### 이름 파라미터

단일 경로 세그먼트를 캡처합니다. 파라미터 값은 기본적으로 퍼센트 디코딩됩니다 (`decodeParams: true`).

```typescript
router.add('GET', '/users/:id', handler);
// /users/42        → { id: '42' }
// /users/hello%20w → { id: 'hello w' }
```

### 정규식 파라미터

인라인 정규식으로 파라미터를 제한합니다. 패턴은 등록 시 ReDoS 안전성이 검증됩니다.

```typescript
router.add('GET', '/users/:id(\\d+)', handler);
// /users/42   → { id: '42' }
// /users/abc  → 매칭 안 됨
```

### 선택적 파라미터

뒤에 `?` 를 붙이면 파라미터가 선택적이 됩니다. 있는 경로와 없는 경로 모두 매칭되며, 누락 시 `params` 의 형태는 `optionalParamBehavior` 로 결정됩니다:

```typescript
router.add('GET', '/:lang?/docs', handler);
```

| `optionalParamBehavior` | `/en/docs` | `/docs` |
|:------------------------|:-----------|:--------|
| `'omit'` (기본값) | `{ lang: 'en' }` | `{}` (키 부재) |
| `'setUndefined'` | `{ lang: 'en' }` | `{ lang: undefined }` (키 존재) |
| `'setEmptyString'` | `{ lang: 'en' }` | `{ lang: '' }` |

### 와일드카드

URL 의 나머지 부분 (슬래시 포함) 을 캡처합니다. 와일드카드 값은 **퍼센트 디코딩되지 않습니다**. 의미 두 가지 + 권장 표기 두 가지:

| 패턴 | 의미 | 빈 매칭 |
|:-----|:-----|:--------|
| `*name` | star — 0 글자 이상 매칭 | `'/files'` 가 `/files/*path` 와 매칭 → `{ path: '' }` |
| `:name+` | multi — 1 글자 이상 필수 | `'/assets'` 가 `/assets/:file+` 와 매칭 안 됨 |

```typescript
router.add('GET', '/files/*path', handler);
// /files/a/b/c.txt → { path: 'a/b/c.txt' }
// /files            → { path: '' }

router.add('GET', '/assets/:file+', handler);
// /assets/style.css → { file: 'style.css' }
// /assets           → 매칭 안 됨
```

별칭 `:name*` (≡ `*name`) 과 `*name+` (≡ `:name+`) 도 파서가 받지만 위 표기를 권장합니다.

<br>

## ⚙️ 옵션

```typescript
interface RouterOptions {
  ignoreTrailingSlash?: boolean;
  caseSensitive?: boolean;
  decodeParams?: boolean;
  enableCache?: boolean;
  cacheSize?: number;
  maxPathLength?: number;
  maxSegmentLength?: number;
  optionalParamBehavior?: 'omit' | 'setUndefined' | 'setEmptyString';
  regexSafety?: RegexSafetyOptions;
  regexAnchorPolicy?: 'warn' | 'error' | 'silent';
  onWarn?: (warning: RouterWarning) => void;
}
```

| 옵션 | 기본값 | 설명 |
|:-----|:-------|:-----|
| `ignoreTrailingSlash` | `true` | `/users/` 와 `/users` 가 같은 라우트 |
| `caseSensitive` | `true` | `/Users` 와 `/users` 가 다른 라우트 |
| `decodeParams` | `true` | 이름 파라미터 값 퍼센트 디코딩 (와일드카드는 raw 유지) |
| `enableCache` | `false` | `'dynamic'` 매칭 결과 캐싱 — 이후 적중은 `'cache'` source |
| `cacheSize` | `1000` | 메서드당 hit 캐시 (LRU) + miss 셋 (FIFO 축출) 의 최대 항목 수 |
| `maxPathLength` | `2048` | 이 길이를 초과하는 경로는 `match()` 가 `null` 반환 |
| `maxSegmentLength` | `256` | 한 세그먼트가 이 길이를 초과하면 `match()` 가 `null` 반환 |
| `optionalParamBehavior` | `'omit'` | 누락된 선택적 파라미터의 `params` 형태 — 위 표 참조 |
| `regexAnchorPolicy` | `'silent'` | 정규식 파라미터에 `^` / `$` 포함 시 동작 (앵커는 어느 정책이든 제거됨): `'silent'` 는 조용히 제거, `'warn'` 은 `onWarn` 호출, `'error'` 는 `regex-anchor` throw |

### 캐시 트레이드오프

`enableCache: true` 는 메서드당 `(path → MatchOutput)` LRU 와 negative miss 셋을 추가합니다. 양쪽 모두 `cacheSize` 로 bound 되어있어 메모리 무한 증가 불가. 활성 path 집합이 라우트 수에 비해 작고 동적 매칭이 핫패스를 차지할 때 사용. 매칭이 이미 <40 ns 이거나 path 가 매우 다양할 때는 비활성. 캐시는 stale 될 수 없습니다 — `build()` 가 라우트 테이블을 봉인하고 이후 등록을 거부.

### 정규식 안전성

```typescript
interface RegexSafetyOptions {
  mode?: 'error' | 'warn';                   // 기본값: 'error'
  maxLength?: number;                         // 기본값: 256
  forbidBacktrackingTokens?: boolean;         // 기본값: true
  forbidBackreferences?: boolean;             // 기본값: true
  maxExecutionMs?: number;                    // tester 별 선택 타임아웃
  validator?: (pattern: string) => void;      // 커스텀 검증기
}
```

기본적으로 정규식 패턴은 등록 시 ReDoS 방지를 위해 검증됩니다. 백트래킹 친화 토큰 (`.*`, `.+`, `(a+)+`) 또는 역참조가 포함된 패턴은 거부됩니다. `mode: 'warn'` 으로 설정하면 throw 대신 `onWarn` 으로 로깅합니다.

<br>

## 🚨 에러 처리

`add()` / `addAll()` / `build()` 만 구조화된 `data` 객체를 가진 `RouterError` 를 던집니다. `match()` 와 `allowedMethods()` 는 *던지지 않습니다* — 실패 시 `null` / `[]` 반환.

```typescript
import { Router, RouterError } from '@zipbul/router';

try {
  router.add('GET', '/bad/(unmatched', handler);
} catch (e) {
  if (e instanceof RouterError) {
    e.data.kind;       // RouterErrKind — 식별자
    e.data.message;    // 사람이 읽을 수 있는 설명
    e.data.path;       // 문제가 된 경로 (해당 시)
    e.data.method;     // HTTP 메서드 (해당 시)
  }
}
```

### 에러 종류

| 종류 | 발생 시점 |
|:-----|:----------|
| `'router-sealed'` | `build()` 이후 `add()` / `addAll()` 호출 |
| `'route-duplicate'` | 동일 `(method, path)` 가 이미 등록됨 |
| `'route-conflict'` | 구조적 충돌 — 같은 메서드의 `/files/*a` 후 `/files/*b`, 또는 `/files/*path` 후 `/files/x` 등 |
| `'route-parse'` | 잘못된 경로 문법 (선행 슬래시 없음, 미닫힌 정규식 그룹, 파라미터 이름의 금지 문자 등) |
| `'param-duplicate'` | 한 경로에 동일 파라미터 이름 두 번 (`/x/:id/y/:id`) |
| `'regex-unsafe'` | 정규식 파라미터가 안전성 검사 실패 (길이 / 백트래킹 토큰 / 역참조) |
| `'regex-anchor'` | 정규식 파라미터에 `^` / `$` 포함 (`regexAnchorPolicy: 'error'` 일 때) |
| `'method-limit'` | 32 개를 초과하는 고유 HTTP 메서드 |
| `'segment-limit'` | 세그먼트 길이가 `maxSegmentLength` 초과, 세그먼트 수가 64 초과, 또는 한 경로의 파라미터 수가 32 초과 |

### 충돌 예시

```typescript
// 다른 메서드끼리는 공존 가능
router.add('GET',  '/files/*path', getHandler);
router.add('POST', '/files/*upload', postHandler);  // ok

// 같은 메서드의 와일드카드 이름 변경: route-conflict
router.add('GET',  '/files/*path', getHandler);
router.add('GET',  '/files/*upload', anotherHandler); // throw

// 와일드카드 prefix 하위 정적 라우트: route-conflict
router.add('GET',  '/files/*path', getHandler);
router.add('GET',  '/files/list', listHandler);       // throw
```

<br>

## 🔌 프레임워크 연동

<details>
<summary><b>Bun.serve</b></summary>

```typescript
import { Router } from '@zipbul/router';
import type { HttpMethod } from '@zipbul/shared';

type Handler = (params: Record<string, string | undefined>) => Response;

const router = new Router<Handler>();
router.add('GET',  '/users',     () => Response.json({ users: [] }));
router.add('GET',  '/users/:id', (p) => Response.json({ id: p.id }));
router.add('POST', '/users',     () => new Response('Created', { status: 201 }));
router.build();

Bun.serve({
  fetch(request) {
    const url = new URL(request.url);
    const method = request.method as HttpMethod;

    // match() 는 던지지 않습니다 — null 이면 매칭 라우트 없음.
    const result = router.match(method, url.pathname);
    if (result) return result.value(result.params);

    // 콜드패스 API 로 404 vs 405 구분.
    const allowed = router.allowedMethods(url.pathname);
    if (allowed.length === 0) return new Response('Not Found', { status: 404 });

    return new Response('Method Not Allowed', {
      status: 405,
      headers: { Allow: allowed.join(', ') },
    });
  },
  port: 3000,
});
```

</details>

<br>

## ⚡ 성능

Bun 1.3.13, Intel i7-13700K @ 5.45 GHz 환경에서 측정. 수치는 `bench/comparison.bench.ts` 의 p75. 낮을수록 좋고 **굵은 글씨** 가 해당 시나리오의 1위입니다.

| 시나리오 | @zipbul/router | memoirist | find-my-way | rou3 | hono RegExp | koa-tree |
|:---------|:---------------|:----------|:------------|:-----|:------------|:---------|
| 정적 (100 라우트) | **207 ps** | 34.35 ns | 98.33 ns | 87 ps | 35.00 ns | 42.66 ns |
| 파라미터 1개 | **29.69 ns** | 34.74 ns | 72.19 ns | 41.33 ns | 115.00 ns | 97.84 ns |
| 파라미터 3개 | **53.55 ns** | 64.90 ns | 134.61 ns | 64.95 ns | 84.52 ns | 243.99 ns |
| 와일드카드 | 27.09 ns | **23.45 ns** | 59.95 ns | 75.91 ns | 89.00 ns | 115.97 ns |
| 미스 | 15.11 ns | **14.22 ns** | 48.79 ns | 44.73 ns | 20.06 ns | 25.15 ns |

`rou3` 의 정적 lookup 이 약 120 ps 차이로 앞서는 것은 path 정규화 패스를 생략하기 때문입니다 — 동적 라우트 (파라미터 / 와일드카드) 에서는 그 격차가 역전됩니다. `memoirist` 의 와일드카드 / 미스 우위는 ~1 ns 이내 변동이며, `regexSafety` / `maxPathLength` / `maxSegmentLength` / 구조화된 에러 처리를 핫패스에 유지한 결과입니다.

<br>

## 📄 라이선스

MIT
