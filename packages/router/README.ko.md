# @zipbul/router

[English](./README.md) | **한국어**

[![npm](https://img.shields.io/npm/v/@zipbul/router)](https://www.npmjs.com/package/@zipbul/router)
![coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/parkrevil/3965fb9d1fe2d6fc5c321cb38d88c823/raw/router-coverage.json)

Bun 을 위한 고성능 URL 라우터. build-once / match-many. 정적 hot path 는 **단일 자릿 nanosecond**, 동적 hit 은 캐시 warm 시 **~10 ns**, 작고 명확한 공개 API 와 구조화된 에러 보고를 제공합니다.

HTTP 서버 boundary (`Bun.serve`, Node `http`, 각종 어댑터)가 라우터에
정규화된 origin-form pathname을 넘긴다는 가정 아래 설계되었습니다.

> [!NOTE]
> **Bun ≥ 1.0** 대상. `bun:jsc` (JIT tier-up hint) 등 Bun 전용 빌드 산출물을 사용하며, Node 호환 빌드는 게시하지 않습니다.

---

## 📑 목차

- [📦 설치](#-설치)
- [🚀 빠른 시작](#-빠른-시작)
- [📚 API 레퍼런스](#-api-레퍼런스)
  - [`new Router<T>(options?)`](#new-routertoptions)
  - [`router.add(method, path, value)`](#routeraddmethod-path-value)
  - [`router.addAll(entries)`](#routeraddallentries)
  - [`router.build()`](#routerbuild)
  - [`router.match(method, path)`](#routermatchmethod-path)
  - [`router.allowedMethods(path)`](#routerallowedmethodspath)
- [🛤️ 라우트 패턴](#️-라우트-패턴)
- [⚙️ 옵션](#️-옵션)
- [🚨 에러 처리](#-에러-처리)
- [🔌 프레임워크 연동](#-프레임워크-연동)
- [⚡ 성능](#-성능)
- [🔒 보안](#-보안)

---

## 📦 설치

```bash
bun add @zipbul/router
```

---

## 🚀 빠른 시작

```typescript
import { Router } from '@zipbul/router';

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

---

## 📚 API 레퍼런스

### `new Router<T>(options?)`

라우터 인스턴스를 생성합니다. `T`는 각 라우트에 저장되는 값의 타입입니다.

```typescript
const router = new Router<string>();
const router = new Router<() => Response>({ pathCaseSensitive: false });
```

모든 메서드는 detached 호출 가능 (`const m = router.match; m('GET', '/x')`) — `this` 를 읽지 않습니다.

### `router.add(method, path, value)`

라우트를 등록합니다. 잘못된 경로, 중복 라우트, 또는 `build()` 이후 호출 시 `RouterError`를 던집니다.

```typescript
router.add('GET', '/users/:id', handler);
router.add(['GET', 'POST'], '/data', handler);  // 복수 메서드
router.add('*', '/health', handler);             // 모든 표준 메서드
```

`'*'`는 `GET / POST / PUT / PATCH / DELETE / OPTIONS / HEAD` 로 확장됩니다.

#### IRI 등록 (RFC 3987)

raw Unicode (IRI) 와 percent-encoded UTF-8 (URI) 두 형태 모두 **등록 시점**에 받습니다. 각 static segment 는 NFC normalize 후 percent-encoded UTF-8 (RFC 3986 wire form) 으로 변환되어 저장되므로, 두 표기가 한 라우트 entry 로 응축됩니다:

```typescript
router.add('GET', '/users/한국', handler);
// 내부 저장: `/users/%ED%95%9C%EA%B5%AD`.
router.match('GET', '/users/%ED%95%9C%EA%B5%AD'); // ✓ 매칭
router.match('GET', '/users/한국');                // ✗ 매칭 안 됨 (아래 참고)
```

> [!IMPORTANT]
> `router.match()` 는 입력 경로를 **normalize 하지 않습니다**. URI-form pathname (percent-encoded UTF-8) 을 넘기세요 — `Bun.serve`, Node `http`, `new URL(req.url).pathname` 이 항상 만드는 형태입니다. 비대칭은 의도적: 모든 HTTP 서버 boundary 가 URI form 을 전달하므로, hot path 에 normalize 비용을 매번 지불하는 것은 낭비입니다.

직접 만든 IRI 입력은 boundary 에서 normalize:

```typescript
const out = router.match('GET', new URL(`/users/${name}`, 'http://x').pathname);
```

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

등록된 라우트와 URL 을 매칭합니다. `MatchOutput<T> | null` 을 반환합니다.

- `path` 는 origin-form pathname 이어야 합니다 (RFC 7230 §5.3.1). 표준 HTTP 서버 경계 (`Bun.serve`, Node `http`, `Express`, `Fastify`, `Hono`) 는 `new URL(req.url).pathname` 으로 이미 이 형태를 만들어 줍니다.
- `match()` 자체는 path 를 디코딩하지 않습니다. `/` 로 split 한 후 캡처된 param 값만 `decodeURIComponent` 로 디코드합니다. param 슬롯의 `%xx` 가 잘못되면 표준 `URIError` 가 caller 로 전파됩니다 — `400 Bad Request` 로 매핑하려면 `try / catch` 로 감싸세요.
- `build()` 전 호출은 `null` 반환.

```typescript
const result = router.match('GET', '/users/42');

if (result) {
  result.value;       // T — 등록된 값
  result.params;      // Record<string, string | undefined> (null-prototype)
  result.meta.source; // 'static' | 'cache' | 'dynamic'
}
```

`meta.source` 는 caller 에게 어떻게 매칭됐는지 알려줍니다:

| 값 | caller 에게 의미 |
|:---|:-----|
| `'static'` | 리터럴 경로 (param 없음) 라우트. 반환된 `MatchOutput` 은 호출 간 공유되고 frozen 됨 — 변경 금지. 동일 hit 간 `===` 식별자 보존. |
| `'cache'` | 이전에 dynamic 으로 해소된 매치가 캐시에서 반환됨. 캐시된 `params` 객체는 frozen + 재사용 — 변경 금지, 호출별 identity 의존 금지. |
| `'dynamic'` | dynamic 라우트의 최초 해소. 매 호출마다 새 `MatchOutput` + 자체 `params` 객체. |

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

> [!TIP]
> `allowedMethods()` 는 **`match()` 가 `null` 을 반환한 후에만** 호출하세요. `path` 에 대해 등록된 모든 메서드 트리를 walk 하므로 `match()` 자체보다 의미 있게 느립니다. 위 404/405 분기 패턴이 권장 용도 — hot match 경로에서 호출 금지.

---

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

인라인 정규식으로 파라미터를 제한합니다. `(...)` 안의 본문은 `build()` 시점에 `new RegExp('^(?:body)$')` 로 컴파일됩니다. 라우터가 자체 앵커를 적용하므로 본문이 `^` 로 시작하거나 `$` 로 끝나면 거부됩니다; 그 외에는 JavaScript-valid 한 정규식 본문 모두 허용됩니다.

```typescript
router.add('GET', '/users/:id(\\d+)', handler);
// /users/42   → { id: '42' }
// /users/abc  → 매칭 안 됨
```

> [!WARNING]
> 라우터는 정규식 본문의 ReDoS 위험성 (`(?:a+)+`, `(\w+)\1` 등) 을 **검사하지 않습니다**. 검증 패턴은 아래 [정규식 본문 — 라우터가 하는 일과 안 하는 일](#정규식-본문--라우터가-하는-일과-안-하는-일) 참고.

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

---

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
| `cacheSize` | `1000` | 메서드당 hit 캐시 용량 (다음 2의 거듭제곱으로 올림; bounded approximate-LRU 축출). `[1, 2³⁰]` 범위의 양의 정수 |
| `optionalParamBehavior` | `'omit'` | 누락된 선택적 파라미터의 `params` 형태 — `'omit'` 은 키 자체 생략, `'set-undefined'` 는 `undefined` 기록 |

참고:

- 이름 파라미터 값은 항상 percent-decoded; 와일드카드 캡처는 raw (슬래시 보존).
- 라우트 총 수 제한 없음. 라우트당 제한: **optional segment ≤ 4 개**, **capture param ≤ 31 개** (param + wildcard). 라우터당 HTTP method **최대 32 개**.
- 빈 라우터는 캐시 메모리 0; `build()` 가 활성 메서드마다 bounded hit 캐시를 pre-allocate 합니다.

### 캐시 — 기대 동작

- **Bounded.** `cacheSize` 가 메서드당 상한. 실제 slot 테이블은 다음 2의 거듭제곱으로 올림; slot 이 가득 차면 approximate-LRU 로 축출.
- **Frozen + 재사용.** cache hit 의 `MatchOutput.params` 는 `Object.freeze` 되어 있고 hit 간 공유 — 변경 금지.
- **Stale 될 수 없음.** `build()` 가 라우트 테이블 봉인; 캐시 entry 는 등록 핸들러와 절대 어긋나지 않음.
- **Dynamic 라우트만.** 정적 라우트는 캐시 skip (이미 O(1) lookup). miss 는 캐시에 들어가지 않음.

### 정규식 본문 — 라우터가 하는 일과 안 하는 일

`:id(pattern)` 은 다음 두 조건을 만족할 때만 등록됩니다:

1. 본문이 `new RegExp('^(?:body)$')` 컴파일에 성공 — 실패 → `route-parse`.
2. 본문이 `^` 로 시작하거나 `$` 로 끝나지 않음 — 라우터가 자체 앵커를 적용하므로 사용자 앵커는 중복 또는 모순 → `route-parse`.

끝. 라우터는 ReDoS-vulnerable shape / capturing group / lookaround / 기타 구조적 속성을 **검사하지 않습니다**.

> [!CAUTION]
> `(?:a+)+`, `(\w+)\1`, `(a|aa)*` 같은 패턴은 등록에 성공하며, 악의적 입력에 V8/JavaScriptCore 정규식 엔진을 hang 시킬 수 있습니다. **신뢰할 수 없는 정규식 소스를 받는다면 `Router.add()` 호출 전에 검증하세요.**

검증 옵션:

- **`re2`** ([github.com/uhop/node-re2](https://github.com/uhop/node-re2)) — Google RE2 엔진 (backtracking 없음) 의 `RegExp` 호환 binding. sandbox 또는 패턴 사전 점검 용도.
- **`recheck`** ([github.com/MakeNowJust/recheck](https://github.com/MakeNowJust/recheck)) — 정적 ReDoS 분석기. `Router.add()` 도달 전에 vulnerable pattern 거부.
- **Allow-list** — 직접 작성/검토한 패턴만 받기.

---

## 🚨 에러 처리

| 메서드 | Throws | 반환 |
|:---|:---|:---|
| `add()` / `addAll()` | 잘못된 경로 / 충돌 / sealed router 시 `RouterError` | `void` |
| `build()` | 라우트별 실패 전체를 담은 `RouterError({ kind: 'route-validation' })` | `this` |
| `match()` | 캡처된 param 의 `%xx` 가 잘못된 경우 `URIError` — `400 Bad Request` 로 매핑하려면 `try / catch` 로 감싸세요 | `MatchOutput<T> \| null` |
| `allowedMethods()` | 절대 throw 안 함 | `readonly string[]` |

모든 `RouterError` 는 구조화된 `data` 객체를 들고 옵니다 — `data.kind` (discriminated union) 로 narrow 한 후 kind 별 필드 (`segment`, `conflictsWith`, `suggestion`, `path`, `method`) 에 접근하세요.

```typescript
import { Router, RouterError } from '@zipbul/router';

try {
  router.add('GET', '/bad/(unmatched', handler);
} catch (e) {
  if (e instanceof RouterError) {
    e.data.kind;       // RouterErrorKind — 식별자
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
| `'route-unreachable'` | 같은 prefix 의 기존 wildcard / terminal 에 의해 새 라우트가 도달 불가 — 예: 같은 메서드에서 `/files/*path` 후 `/files/list` 등록 |
| `'route-parse'` | 잘못된 경로 문법 (선행 슬래시 없음, 미닫힌 정규식 그룹, 파라미터 이름의 금지 문자 등) |
| `'param-duplicate'` | 한 경로에 동일 파라미터 이름 두 번 (`/x/:id/y/:id`) |
| `'method-limit'` | 32 개를 초과하는 고유 HTTP 메서드 |
| `'method-empty'` / `'method-invalid-token'` | method 토큰이 HTTP token grammar 위반 (RFC 9110 §5.6.2) |
| `'path-missing-leading-slash'` / `'path-query'` / `'path-fragment'` / `'path-control-char'` / `'path-invalid-pchar'` / `'path-malformed-percent'` / `'path-invalid-utf8'` / `'path-encoded-slash'` / `'path-dot-segment'` / `'path-empty-segment'` | 등록된 path 가 router-grammar / RFC 부합 검사 실패 |
| `'router-options-invalid'` | `RouterOptions` 필드 검증 실패 (예: `cacheSize` 가 `[1, 2³⁰]` 범위 밖) |
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

---

## 🔌 프레임워크 연동

<details>
<summary><b>Bun.serve</b></summary>

```typescript
import { Router } from '@zipbul/router';

type Handler = (params: Record<string, string | undefined>) => Response;

const router = new Router<Handler>();
router.add('GET',  '/users',     () => Response.json({ users: [] }));
router.add('GET',  '/users/:id', (p) => Response.json({ id: p.id }));
router.add('POST', '/users',     () => new Response('Created', { status: 201 }));
router.build();

Bun.serve({
  fetch(request) {
    const url = new URL(request.url);

    // match() 는 매칭 라우트 없으면 null 을 반환합니다. `URL(...).pathname`
    // 은 RFC 7230 origin-form 보장이라 `decodeURIComponent` 실패는 잘못된
    // `%xx` 가 들어온 적대적 요청에서만 발생합니다 — 400 Bad Request 로
    // 매핑하려면 try/catch 로 감싸세요.
    const result = router.match(request.method, url.pathname);
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

---

## ⚡ 성능

대표 hot-path 수치 (Bun 1.3.13, Linux x64):

| 워크로드 | 범위 |
|:---|---:|
| `build()` — 100 라우트 | ~2 ms |
| `build()` — 10 000 라우트 | ~25 ms |
| `match()` — hit / static | 단일 자릿 ns |
| `match()` — hit / dynamic (캐시 warm) | ~10 ns |
| `match()` — miss / wrong method | ~3 ns |

`memoirist`, `find-my-way`, `rou3`, `hono` (RegExp + Trie), `koa-tree-router` 와 head-to-head 에서 `@zipbul/router` 는 모든 "성공 매치" 시나리오 1위, 대부분 miss / wrong-method 시나리오에서 1위 또는 동률.

하드웨어 변동 ±20%, sub-10 ns 연산은 clock 해상도 노이즈 — 전체 표와 노이즈 분포는 [`bench-results.md`](./bench-results.md) 참조. 로컬 재현:

```bash
bun bench/regression-snapshot.ts   # 자체 벤치 (11 trial, σ annotated)
bun bench/comparison.bench.ts      # cross-router head-to-head
```

---

## 🔒 보안

보안 이슈를 발견하셨다면 [`SECURITY.md`](./SECURITY.md) 의 비공개 신고 채널을 이용하세요. 보안 신고는 **공개 GitHub 이슈로 올리지 마세요**.

---

## 📄 라이선스

MIT
