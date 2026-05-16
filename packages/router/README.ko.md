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

URL을 등록된 라우트와 매칭합니다. `MatchOutput<T> | null` 을 반환합니다. 라우터는 `path` 가 이미 검증된 origin-form pathname (RFC 7230 §5.3.1) 인 것으로 가정합니다 — 잘못된 percent-encoding 은 `decodeURIComponent` 까지 그대로 흘러가 `URIError` 로 전파됩니다. HTTP 서버 경계 (`Bun.serve`, `Node http`, `Express`, `Fastify`, `Hono`) 가 well-formed pathname 을 라우터에 넘기는 책임을 집니다. `build()` 호출 전에 `match()` 를 부르면 `null` 을 반환합니다.

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
| `'cache'` | 이전에 `'dynamic'` 으로 해소된 경로가 메서드별 hit 캐시 (항상 켜져 있고 `cacheSize` 로 제한) 에서 반환된 경우. 캐시는 *스냅샷* 을 저장하므로 반환된 `params` 를 변경해도 다음 hit 에 영향 없음. |
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

단일 경로 세그먼트를 캡처합니다. 파라미터 값은 항상 퍼센트 디코딩됩니다.

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
| `'set-undefined'` | `{ lang: 'en' }` | `{ lang: undefined }` (키 존재) |

### 와일드카드

URL 의 나머지 부분 (슬래시 포함) 을 캡처합니다. 와일드카드 값은 **퍼센트 디코딩되지 않습니다**. 의미 두 가지 + 표기 두 가지 — colon-form sugar (`:name+` / `:name*`) 는 parse 시 거부됩니다:

| 패턴 | 의미 | 빈 매칭 |
|:-----|:-----|:--------|
| `*name`  | star — 0 segment 이상 매칭  | `'/files'` 가 `/files/*path` 와 매칭 → `{ path: '' }` |
| `*name+` | multi — 1 segment 이상 필수 | `'/assets'` 가 `/assets/*file+` 와 매칭 안 됨 |

```typescript
router.add('GET', '/files/*path', handler);
// /files/a/b/c.txt → { path: 'a/b/c.txt' }
// /files            → { path: '' }

router.add('GET', '/assets/*file+', handler);
// /assets/style.css → { file: 'style.css' }
// /assets           → 매칭 안 됨 (multi 는 비어있는 tail 거부)
```

<br>

## ⚙️ 옵션

```typescript
interface RouterOptions {
  trailingSlash?: 'strict' | 'ignore';
  pathCaseSensitive?: boolean;
  cacheSize?: number;
  optionalParamBehavior?: 'omit' | 'set-undefined';
}
```

| 옵션 | 기본값 | 설명 |
|:-----|:-------|:-----|
| `trailingSlash` | `'ignore'` | `'strict'` 면 `/a` 와 `/a/` 가 다름; `'ignore'` 면 등록/매치 시점에 trailing slash 1개 collapse |
| `pathCaseSensitive` | `true` | `/Users` 와 `/users` 가 다른 라우트 |
| `cacheSize` | `1000` | 메서드당 hit 캐시 용량 (다음 2의 거듭제곱으로 올림; second-chance / clock 축출). 1 ~ 2^30 양의 정수만 허용 |
| `optionalParamBehavior` | `'omit'` | 누락된 선택적 파라미터의 `params` 형태 — `'omit'` 은 키 자체 생략, `'set-undefined'` 는 `undefined` 기록 |

이름 파라미터 퍼센트 디코딩은 항상 켜져 있음 (와일드카드는 raw 유지).
경로 길이 / 세그먼트 길이 / pathname grammar 제한은 라우터 책임이 아니라
상위 프레임워크 / HTTP 서버 책임. `:name(...)` 안의 정규식 앵커
(`^` / `$`) 는 parse 시 `route-parse` 로 거부됨 (라우터가 모든 패턴을
`^(?:...)$` 로 자동 wrapping 하므로 사용자 anchor 는 중복 또는 모순).
캐시는 메서드별 lazy 할당이라 빈 라우터는 0 메모리; 토글 없음.

### 캐시 트레이드오프

메서드당 `(path → MatchOutput)` second-chance / clock 캐시. 용량은
`cacheSize` 로 bound (다음 2의 거듭제곱으로 올림 — slot index 를 단일
mask 로 처리하기 위함) — 메모리 무한 증가 불가. 축출은 clock used-bit
기반 근사 LRU (정확한 LRU 아님 — 최근 접근한 항목은 한 sweep 살아남음).
별도 miss 캐시 없음 — `match()` 미스는 매번 walker 비용. (이전 측정
결과 hit / unique-miss / Zipf 워크로드 모두 dedicated miss 캐시가
net-negative). 활성 path 집합이 라우트 수에 비해 작고 동적 매칭이
핫패스를 차지할 때 가장 유용. 캐시는 stale 될 수 없음 — `build()` 가
라우트 테이블을 봉인하고 이후 등록을 거부.

### 정규식 안전성

정규식 파라미터 패턴 (`:id(\d+)` 등) 은 등록 시 검증되며, 다음 가드
중 하나라도 트리거되면 `regex-unsafe` 로 거부됩니다:

- 중첩 무제한 quantifier (`(a+)+`, `(a*)*`, `(a{1,})+`)
- 역참조 (`\1`, `\k<name>`)
- 캡처 / lookaround / lookbehind / inline-flag 그룹 —
  non-capturing `(?:...)` 만 허용
- repeat 아래 alternation 의 prefix 중복 (`(a|aa)+`)

가드는 **항상 켜져 있음** — opt-out 옵션 없음. ReDoS 방지는 보안
디폴트이고 약화하면 회귀이지 ergonomics knob 이 아니라는 판단.
거부는 테스트에서 잡히도록 작성하세요.

<br>

## 🚨 에러 처리

`add()` / `addAll()` / `build()` 는 구조화된 `data` 객체를 가진 `RouterError` 를 던집니다. `match()` 는 "매칭 라우트 없음" 일 때 `null` 을 반환하지만, 잘못된 percent-encoding 이 들어오면 `decodeURIComponent` 의 `URIError` 를 **그대로 전파**합니다 — caller 책임. `allowedMethods()` 는 라우트가 없으면 `[]` 를 반환하고 절대 throw 하지 않음 (decode 자체를 안 함).

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
| `'regex-unsafe'` | 정규식 파라미터가 안전성 검사 실패 (중첩 무제한 quantifier / 역참조 / 캡처-or-lookaround 그룹 / repeat 아래 alternation prefix 중복) |
| `'method-limit'` | 32 개를 초과하는 고유 HTTP 메서드 |
| `'method-empty'` / `'method-invalid-token'` | method 토큰이 HTTP token grammar 위반 (RFC 9110 §5.6.2) |
| `'path-missing-leading-slash'` / `'path-query'` / `'path-fragment'` / `'path-control-char'` / `'path-non-ascii'` / `'path-invalid-pchar'` / `'path-malformed-percent'` / `'path-invalid-utf8'` / `'path-encoded-slash'` / `'path-encoded-control'` / `'path-dot-segment'` / `'path-empty-segment'` | 등록된 path 가 router-grammar 검사 실패 |
| `'router-options-invalid'` | `RouterOptions` 필드 검증 실패 (예: `cacheSize` 가 `[1, 2^30]` 범위 밖) |
| `'route-validation'` | `build()` 중 한 개 이상의 라우트 검증 실패 — `data.errors` 가 라우트별 실패 목록을 담음 |

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

    // match() 는 매칭 라우트 없으면 null 을 반환합니다. `URL(...).pathname`
    // 은 RFC 7230 origin-form 보장이라 `decodeURIComponent` 실패는 잘못된
    // `%xx` 가 들어온 적대적 요청에서만 발생합니다 — 400 Bad Request 로
    // 매핑하려면 try/catch 로 감싸세요.
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

`rou3` 의 정적 lookup 이 약 120 ps 차이로 앞서는 것은 path 정규화
패스를 생략하기 때문입니다 — 동적 라우트 (파라미터 / 와일드카드) 에서는
그 격차가 역전됩니다. `memoirist` 의 와일드카드 / 미스 우위는 ~1 ns
이내 변동이며, regex-safety 검증과 구조화된 에러 처리를 핫패스에 유지한
결과입니다. 위 수치는 1회 측정의 p75 입니다 — 리더보드에 의존하기 전에
`bench/comparison.bench.ts` 를 본인 하드웨어에서 직접 실행하세요.

<br>

## 📄 라이선스

MIT
