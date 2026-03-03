# @zipbul/router

[English](./README.md) | **한국어**

[![npm](https://img.shields.io/npm/v/@zipbul/router)](https://www.npmjs.com/package/@zipbul/router)
![coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/parkrevil/3965fb9d1fe2d6fc5c321cb38d88c823/raw/router-coverage.json)

Bun을 위한 고성능 래딕스 트리 URL 라우터입니다.
문자 단위 트라이, HTTP 메서드별 트리 분리, 정규식 파라미터 패턴, 구조화된 에러 처리를 지원합니다.

> 정적 라우트는 O(1) Map 조회로 해소됩니다. 동적 라우트는 단형(monomorphic) 프로퍼티 접근을 사용하는 반복형 래딕스 워커로 탐색합니다.

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
  console.log(result.value);      // 'get-user'
  console.log(result.params.id);  // '42'
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

### `router.add(method, path, value)`

라우트를 등록합니다. 잘못된 경로, 중복 라우트, 또는 `build()` 이후 호출 시 `RouterError`를 던집니다.

```typescript
router.add('GET', '/users/:id', handler);
router.add(['GET', 'POST'], '/data', handler);  // 복수 메서드
router.add('*', '/health', handler);             // 모든 메서드
```

### `router.addAll(entries)`

여러 라우트를 한 번에 등록합니다. 첫 번째 실패 시 `RouterError`를 던지며, `registeredCount`로 성공한 수를 알 수 있습니다.

```typescript
router.addAll([
  ['GET', '/users', listUsers],
  ['POST', '/users', createUser],
  ['GET', '/users/:id', getUser],
]);
```

### `router.build()`

래딕스 트라이를 컴파일합니다. `match()` 호출 전에 반드시 실행해야 합니다. 체이닝을 위해 `this`를 반환합니다.

```typescript
router.build();

// 체이닝 예시
const router = new Router<string>()
  .add('GET', '/users', 'list')
  .build(); // ❌ add()는 void를 반환합니다

// 올바른 체이닝
const r = new Router<string>();
r.add('GET', '/users', 'list');
r.build();
```

### `router.match(method, path)`

URL을 등록된 라우트와 매칭합니다. `MatchOutput<T> | null`을 반환합니다.
잘못된 입력(미빌드, 경로 초과 등)에는 `RouterError`를 던집니다.

```typescript
const result = router.match('GET', '/users/42');

if (result) {
  result.value;       // T — 등록된 값
  result.params;      // Record<string, string | undefined>
  result.meta.source; // 'static' | 'cache' | 'dynamic'
}
```

### `router.clearCache()`

캐시된 매칭 결과를 모두 삭제합니다. `enableCache: true`일 때만 유효합니다.

<br>

## 🛤️ 라우트 패턴

### 정적 라우트

```typescript
router.add('GET', '/users', handler);
router.add('GET', '/api/v1/health', handler);
```

### 이름 파라미터

단일 경로 세그먼트를 캡처합니다. 파라미터는 기본적으로 퍼센트 디코딩됩니다.

```typescript
router.add('GET', '/users/:id', handler);
// /users/42        → { id: '42' }
// /users/hello%20w → { id: 'hello w' }
```

### 정규식 파라미터

인라인 정규식 패턴으로 파라미터를 제한합니다. 패턴은 등록 시 ReDoS 안전성이 검증됩니다.

```typescript
router.add('GET', '/users/:id(\\d+)', handler);
// /users/42   → 매칭, { id: '42' }
// /users/abc  → 매칭 안 됨
```

### 선택적 파라미터

뒤에 `?`를 붙이면 파라미터가 선택적이 됩니다. 파라미터가 있는 경로와 없는 경로 모두 매칭됩니다.

```typescript
router.add('GET', '/:lang?/docs', handler);
// /en/docs  → { lang: 'en' }
// /docs     → { lang: undefined } (또는 omit, optionalParamBehavior에 따라)
```

### 와일드카드 (`*`)

URL의 나머지 부분(슬래시 포함)을 캡처합니다. 퍼센트 디코딩되지 않습니다.

```typescript
router.add('GET', '/files/*path', handler);
// /files/a/b/c.txt → { path: 'a/b/c.txt' }
// /files            → { path: '' }
```

### 다중 세그먼트 와일드카드 (`+`)

`*`와 같지만 최소 한 글자 이상이 필요합니다.

```typescript
router.add('GET', '/assets/+file', handler);
// /assets/style.css → { file: 'style.css' }
// /assets           → 매칭 안 됨
```

<br>

## ⚙️ 옵션

```typescript
interface RouterOptions {
  ignoreTrailingSlash?: boolean;     // 기본값: true
  caseSensitive?: boolean;           // 기본값: true
  decodeParams?: boolean;            // 기본값: true
  enableCache?: boolean;             // 기본값: false
  cacheSize?: number;                // 기본값: 1000
  maxPathLength?: number;            // 기본값: 2048
  maxSegmentLength?: number;         // 기본값: 256
  optionalParamBehavior?: 'omit' | 'setUndefined' | 'setEmptyString';
  regexSafety?: RegexSafetyOptions;
  regexAnchorPolicy?: 'warn' | 'error' | 'silent';
  onWarn?: (warning: RouterWarning) => void;
}
```

| 옵션 | 기본값 | 설명 |
|:-----|:-------|:-----|
| `ignoreTrailingSlash` | `true` | `/users/`와 `/users`가 같은 라우트에 매칭 |
| `caseSensitive` | `true` | `/Users`와 `/users`가 다른 라우트 |
| `decodeParams` | `true` | 파라미터 값 퍼센트 디코딩 (`%20` → 공백) |
| `enableCache` | `false` | 동적 매칭 결과 캐싱 |
| `cacheSize` | `1000` | 메서드당 히트 캐시 최대 항목 수 |
| `maxPathLength` | `2048` | 이 길이를 초과하는 경로 거부 |
| `maxSegmentLength` | `256` | 이 길이를 초과하는 세그먼트 거부 |
| `optionalParamBehavior` | `'omit'` | 누락된 선택적 파라미터 처리 방식 |

### 정규식 안전성

```typescript
interface RegexSafetyOptions {
  mode?: 'error' | 'warn';                   // 기본값: 'error'
  maxLength?: number;                         // 기본값: 256
  forbidBacktrackingTokens?: boolean;         // 기본값: true
  forbidBackreferences?: boolean;             // 기본값: true
  maxExecutionMs?: number;                    // 선택적 타임아웃
  validator?: (pattern: string) => void;      // 커스텀 검증기
}
```

기본적으로 정규식 패턴은 등록 시 ReDoS 방지를 위해 검증됩니다. 백트래킹 토큰(`.*`, `.+`, `(a+)+`) 또는 역참조가 포함된 패턴은 거부됩니다.

<br>

## 🚨 에러 처리

모든 에러는 구조화된 `data` 객체를 포함한 `RouterError`를 던집니다.

```typescript
import { Router, RouterError } from '@zipbul/router';

try {
  router.match('GET', '/some/path');
} catch (e) {
  if (e instanceof RouterError) {
    e.data.kind;       // RouterErrKind — 식별자
    e.data.message;    // 사람이 읽을 수 있는 설명
    e.data.path;       // 문제가 된 경로
    e.data.method;     // HTTP 메서드
    e.data.suggestion; // 수정 제안 (가능한 경우)
  }
}
```

### 에러 종류

| 종류 | 발생 시점 |
|:-----|:----------|
| `'router-sealed'` | `build()` 이후 `add()` 호출 |
| `'not-built'` | `build()` 이전에 `match()` 호출 |
| `'route-duplicate'` | 동일한 메서드 + 경로가 이미 등록됨 |
| `'route-conflict'` | 구조적 충돌 (와일드카드/파라미터/정적) |
| `'route-parse'` | 잘못된 경로 문법 |
| `'param-duplicate'` | 같은 경로에 중복 파라미터 이름 |
| `'regex-unsafe'` | 정규식 패턴이 안전성 검사 실패 |
| `'regex-anchor'` | 패턴에 `^` 또는 `$` 포함 (정책이 `'error'`일 때) |
| `'method-limit'` | 32개 이상의 고유 메서드 |
| `'segment-limit'` | 세그먼트가 `maxSegmentLength` 초과 |
| `'regex-timeout'` | 패턴 매칭 타임아웃 |
| `'path-too-long'` | 경로가 `maxPathLength` 초과 |
| `'method-not-found'` | 해당 메서드에 등록된 라우트 없음 |

<br>

## 🔌 프레임워크 연동

<details>
<summary><b>Bun.serve</b></summary>

```typescript
import { Router, RouterError } from '@zipbul/router';

type Handler = (params: Record<string, string | undefined>) => Response;

const router = new Router<Handler>();
router.add('GET', '/users', () => Response.json({ users: [] }));
router.add('GET', '/users/:id', (p) => Response.json({ id: p.id }));
router.add('POST', '/users', () => new Response('Created', { status: 201 }));
router.build();

Bun.serve({
  fetch(request) {
    const url = new URL(request.url);

    try {
      const result = router.match(
        request.method as any,
        url.pathname,
      );

      if (!result) {
        return new Response('Not Found', { status: 404 });
      }

      return result.value(result.params);
    } catch (e) {
      if (e instanceof RouterError) {
        return Response.json({ error: e.data.kind }, { status: 400 });
      }
      return new Response('Internal Server Error', { status: 500 });
    }
  },
  port: 3000,
});
```

</details>

<br>

## ⚡ 성능

Bun 1.3.9, Intel i7-13700K 환경에서 인기 JS 라우터 6종과 비교 벤치마크.

| 시나리오 | @zipbul/router | memoirist | find-my-way | rou3 | hono RegExp | koa-tree |
|:---------|:---------------|:----------|:------------|:-----|:------------|:---------|
| 정적 | **30 ns** | 38 ns | 89 ns | <1 ns | 36 ns | 44 ns |
| 파라미터 1개 | 66 ns | **36 ns** | 80 ns | 40 ns | 235 ns | 89 ns |
| 파라미터 3개 | 151 ns | 66 ns | 142 ns | **64 ns** | 94 ns | 265 ns |
| 와일드카드 | 71 ns | **26 ns** | 66 ns | 78 ns | 194 ns | 121 ns |
| 미스 | 45 ns | **18 ns** | 54 ns | 50 ns | 25 ns | 28 ns |

정적 라우트는 O(1) Map 조회 덕분에 memoirist보다 빠릅니다. 동적 라우트의 차이(~30 ns)는 bare-metal 라우터가 생략하는 안전 기능(정규화, 검증, 구조화된 에러)에서 비롯됩니다.

<br>

## 📄 라이선스

MIT
