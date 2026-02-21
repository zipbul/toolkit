# @zipbul/cors

[English](./README.md) | **한국어**

프레임워크에 종속되지 않는 CORS 처리 라이브러리.
응답을 직접 생성하지 않고, **판별 유니온(discriminated union)** 결과를 반환하여 호출자가 응답 방식을 완전히 제어할 수 있도록 설계되었습니다.

> 표준 Web API(`Request` / `Response`)를 사용합니다.

<br>

## 📦 설치

```bash
bun add @zipbul/cors
```

<br>

## 💡 핵심 개념

`handle()` 은 응답을 만들지 않습니다. **다음에 무엇을 해야 하는지**만 알려줍니다.

```
CorsResult
├── Continue          → CORS 헤더를 응답에 추가한 뒤 계속 처리
├── RespondPreflight  → 프리플라이트 전용 응답을 즉시 반환
└── Reject            → 거부 (사유 포함)
```

이 구조 덕분에 미들웨어 파이프라인, 엣지 런타임, 커스텀 에러 포맷 등 어떤 환경에도 자연스럽게 맞춰집니다.

<br>

## 🚀 빠른 시작

```typescript
import { Cors, CorsAction } from '@zipbul/cors';
import { isErr } from '@zipbul/result';

const corsResult = Cors.create({
  origin: 'https://my-app.example.com',
  credentials: true,
});

if (isErr(corsResult)) {
  throw new Error(`CORS 설정 오류: ${corsResult.data.message}`);
}

const cors = corsResult;

async function handleRequest(request: Request): Promise<Response> {
  const result = await cors.handle(request);

  if (isErr(result)) {
    return new Response('Internal Error', { status: 500 });
  }

  if (result.action === CorsAction.Reject) {
    return new Response('Forbidden', { status: 403 });
  }

  if (result.action === CorsAction.RespondPreflight) {
    return new Response(null, {
      status: result.statusCode,
      headers: result.headers,
    });
  }

  // CorsAction.Continue — CORS 헤더를 응답에 병합
  const response = new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });

  for (const [key, value] of result.headers) {
    response.headers.set(key, value);
  }

  return response;
}
```

<br>

## ⚙️ 옵션

```typescript
interface CorsOptions {
  origin?: OriginOptions;              // 기본값: '*'
  methods?: CorsMethod[];              // 기본값: GET, HEAD, PUT, PATCH, POST, DELETE
  allowedHeaders?: string[];           // 기본값: 요청의 ACRH 반영
  exposedHeaders?: string[];           // 기본값: 없음
  credentials?: boolean;               // 기본값: false
  maxAge?: number;                     // 기본값: 없음 (헤더 미포함)
  preflightContinue?: boolean;         // 기본값: false
  optionsSuccessStatus?: number;       // 기본값: 204
}
```

### `origin`

| 값 | 동작 |
|:---|:---|
| `'*'` _(기본)_ | 모든 출처 허용 |
| `false` | 모든 출처 거부 |
| `true` | 요청 출처를 그대로 반영 |
| `'https://example.com'` | 정확히 일치하는 출처만 허용 |
| `/^https:\/\/(.+\.)?example\.com$/` | 정규식 매칭 |
| `['https://a.com', /^https:\/\/b\./]` | 배열 (문자열·정규식 혼합) |
| `(origin, request) => boolean \| string` | 함수 (동기·비동기) |

> `credentials: true`일 때 `origin: '*'`는 **검증 오류**를 발생시킵니다. 요청 출처를 반영하려면 `origin: true`를 사용하세요.
>
> RegExp origin은 생성 시점에 [safe-regex2](https://github.com/fastify/safe-regex2)를 사용하여 **ReDoS 안전성**을 검사합니다. star height ≥ 2인 패턴(예: `/(a+)+$/`)은 `CorsErrorReason.UnsafeRegExp`으로 거부됩니다.

### `methods`

프리플라이트에서 허용할 HTTP 메서드 목록. `CorsMethod[]`를 받으며, 표준 메서드는 자동 완성되고 RFC 9110 §5.6.2 토큰(예: `'PROPFIND'`)도 허용합니다.

```typescript
Cors.create({ methods: ['GET', 'POST', 'DELETE'] });
Cors.create({ methods: ['GET', 'PROPFIND'] }); // 커스텀 토큰
```

와일드카드 `'*'`를 넣으면 모든 메서드를 허용합니다. `credentials: true`이면 와일드카드 대신 요청 메서드를 그대로 반영합니다.

### `allowedHeaders`

프리플라이트에서 허용할 요청 헤더 목록. 미설정 시 클라이언트의 `Access-Control-Request-Headers` 값을 그대로 반영합니다.

```typescript
Cors.create({ allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'] });
```

> **⚠️ Authorization 주의** — Fetch Standard에 따라, 와일드카드 `'*'`만으로는 `Authorization` 헤더가 허용되지 않습니다. 반드시 명시적으로 추가해야 합니다.
>
> ```typescript
> Cors.create({ allowedHeaders: ['*', 'Authorization'] });
> ```

### `exposedHeaders`

브라우저 JavaScript에서 접근 가능하게 노출할 응답 헤더 목록.

```typescript
Cors.create({ exposedHeaders: ['X-Request-Id', 'X-Rate-Limit-Remaining'] });
```

> `credentials: true` 환경에서 와일드카드 `'*'`를 사용하면 `Access-Control-Expose-Headers` 헤더 자체가 설정되지 않습니다.

### `credentials`

`Access-Control-Allow-Credentials: true` 헤더 포함 여부.

```typescript
Cors.create({ origin: 'https://app.example.com', credentials: true });
```

### `maxAge`

프리플라이트 결과를 브라우저가 캐시할 시간(초).

```typescript
Cors.create({ maxAge: 86400 }); // 24시간
```

### `preflightContinue`

`true`로 설정하면 프리플라이트를 자동 처리하지 않고, `CorsAction.Continue`를 반환하여 다음 핸들러에게 위임합니다.

### `optionsSuccessStatus`

프리플라이트 응답의 HTTP 상태 코드. 기본값 `204`. 일부 레거시 브라우저 호환이 필요하면 `200`으로 설정합니다.

<br>

## 📤 반환 타입

`handle()`은 `Promise<CorsResult>`를 반환합니다. `CorsResult`는 세 가지 인터페이스의 판별 유니온입니다.

#### `CorsContinueResult`

```typescript
{ action: CorsAction.Continue; headers: Headers }
```

일반 요청(비-OPTIONS) 또는 `preflightContinue: true`인 프리플라이트에서 반환됩니다. `headers`를 응답에 직접 병합하세요.

#### `CorsPreflightResult`

```typescript
{ action: CorsAction.RespondPreflight; headers: Headers; statusCode: number }
```

`OPTIONS` + `Access-Control-Request-Method`가 포함된 프리플라이트에서 반환됩니다. `headers`와 `statusCode`를 사용하여 응답을 직접 구성합니다.

#### `CorsRejectResult`

```typescript
{ action: CorsAction.Reject; reason: CorsRejectionReason }
```

CORS 검증 실패 시 반환됩니다. `reason`으로 상세한 에러 응답을 구성할 수 있습니다.

| `CorsRejectionReason` | 의미 |
|:---|:---|
| `NoOrigin` | `Origin` 헤더 없음 또는 빈 문자열 |
| `OriginNotAllowed` | 출처가 허용 목록에 없음 |
| `MethodNotAllowed` | 요청 메서드가 허용 목록에 없음 |
| `HeaderNotAllowed` | 요청 헤더가 허용 목록에 없음 |

`Cors.create()`는 옵션 검증 실패 시 `Err<CorsError>`를 반환합니다:

| `CorsErrorReason` | 의미 |
|:------------------|:--------|
| `CredentialsWithWildcardOrigin` | `credentials:true` + `origin:'*'` 조합 불가 (Fetch Standard §3.3.5) |
| `InvalidMaxAge` | `maxAge`가 음수가 아닌 정수가 아님 (RFC 9111 §1.2.1) |
| `InvalidStatusCode` | `optionsSuccessStatus`가 2xx 정수가 아님 |
| `InvalidOrigin` | `origin`이 빈/공백 문자열, 빈 배열, 또는 배열 내 빈/공백 요소 (RFC 6454) |
| `InvalidMethods` | `methods`가 빈 배열이거나 빈/공백 요소 포함 (RFC 9110 §5.6.2) |
| `InvalidAllowedHeaders` | `allowedHeaders`에 빈/공백 요소 포함 (RFC 9110 §5.6.2) |
| `InvalidExposedHeaders` | `exposedHeaders`에 빈/공백 요소 포함 (RFC 9110 §5.6.2) |
| `OriginFunctionError` | 런타임에 origin 함수가 예외를 오발 |
| `UnsafeRegExp` | origin RegExp이 지수적 역추적 위험(ReDoS)을 가짐 |

<br>

## 🔬 고급 사용법

### origin 옵션 패턴

```typescript
// 단일 출처
Cors.create({ origin: 'https://app.example.com' });

// 여러 출처 (문자열 + 정규식 혼합)
Cors.create({
  origin: [
    'https://app.example.com',
    'https://admin.example.com',
    /^https:\/\/preview-\d+\.example\.com$/,
  ],
});

// 정규식으로 서브도메인 전체 허용
Cors.create({ origin: /^https:\/\/(.+\.)?example\.com$/ });
```

### 비동기 origin 함수

데이터베이스나 외부 서비스를 통해 동적으로 출처를 검증할 수 있습니다.

```typescript
Cors.create({
  origin: async (origin, request) => {
    const tenant = request.headers.get('X-Tenant-Id');
    const allowed = await db.isOriginAllowed(tenant, origin);

    return allowed ? true : false;
    // true  → 요청 origin 그대로 반영
    // string → 지정한 문자열로 반영
    // false → 거부
  },
});
```

> origin 함수에서 예외가 발생하면 `handle()`은 `Err<CorsError>`를 `reason: CorsErrorReason.OriginFunctionError`와 함께 반환합니다. 에러는 래핑되며 다시 throw되지 않습니다.

### 와일드카드와 credentials

Fetch Standard에 따라 인증 요청(쿠키·`Authorization`)에는 와일드카드(`*`)를 사용할 수 없습니다.
`credentials: true`일 때 라이브러리가 자동으로 처리하는 항목은 다음과 같습니다.

| 옵션 | 와일드카드 시 동작 |
|:---|:---|
| `origin: '*'` | **검증 오류** — `origin: true`를 사용하여 요청 출처를 반영하세요 |
| `methods: ['*']` | 요청 메서드를 그대로 반영 |
| `allowedHeaders: ['*']` | 요청 헤더를 그대로 반영 |
| `exposedHeaders: ['*']` | `Access-Control-Expose-Headers` 미설정 |

```typescript
// ✅ origin: true + credentials: true → 요청 origin 자동 반영
Cors.create({ origin: true, credentials: true });

// ✅ 특정 도메인 + credentials
Cors.create({ origin: 'https://app.example.com', credentials: true });

// ❌ origin: '*' + credentials: true → Cors.create()가 Err<CorsError> 반환
Cors.create({ origin: '*', credentials: true }); // CorsErrorReason.CredentialsWithWildcardOrigin
```

### 프리플라이트 위임

다른 미들웨어가 OPTIONS 요청을 직접 처리해야 하는 경우:

```typescript
const cors = Cors.create({ preflightContinue: true }) as Cors;

async function handle(request: Request): Promise<Response> {
  const result = await cors.handle(request);

  if (isErr(result)) {
    return new Response('Internal Error', { status: 500 });
  }

  if (result.action === CorsAction.Reject) {
    return new Response('Forbidden', { status: 403 });
  }

  // Continue — 일반 요청과 프리플라이트 모두 여기로 진입
  const response = await nextHandler(request);

  for (const [key, value] of result.headers) {
    response.headers.set(key, value);
  }

  return response;
}
```

<br>

## 🔌 프레임워크 통합 예시

<details>
<summary><b>Bun.serve</b></summary>

```typescript
import { Cors, CorsAction } from '@zipbul/cors';
import { isErr } from '@zipbul/result';

const corsResult = Cors.create({
  origin: ['https://app.example.com'],
  credentials: true,
  exposedHeaders: ['X-Request-Id'],
});

if (isErr(corsResult)) throw new Error(corsResult.data.message);
const cors = corsResult;

Bun.serve({
  async fetch(request) {
    const result = await cors.handle(request);

    if (isErr(result)) {
      return new Response('Internal Error', { status: 500 });
    }

    if (result.action === CorsAction.Reject) {
      return new Response(
        JSON.stringify({ error: 'CORS policy violation', reason: result.reason }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (result.action === CorsAction.RespondPreflight) {
      return new Response(null, {
        status: result.statusCode,
        headers: result.headers,
      });
    }

    const response = await router.handle(request);

    for (const [key, value] of result.headers) {
      response.headers.set(key, value);
    }

    return response;
  },
  port: 3000,
});
```

</details>

<details>
<summary><b>미들웨어 패턴</b></summary>

```typescript
import { Cors, CorsAction } from '@zipbul/cors';
import type { CorsOptions } from '@zipbul/cors';
import { isErr } from '@zipbul/result';

function corsMiddleware(options?: CorsOptions) {
  const createResult = Cors.create(options);
  if (isErr(createResult)) throw new Error(createResult.data.message);
  const cors = createResult;

  return async (ctx: Context, next: () => Promise<void>) => {
    const result = await cors.handle(ctx.request);

    if (isErr(result)) {
      ctx.status = 500;
      ctx.body = { error: 'CORS_INTERNAL_ERROR' };
      return;
    }

    if (result.action === CorsAction.Reject) {
      ctx.status = 403;
      ctx.body = { error: 'CORS_VIOLATION', reason: result.reason };
      return;
    }

    if (result.action === CorsAction.RespondPreflight) {
      ctx.response = new Response(null, {
        status: result.statusCode,
        headers: result.headers,
      });
      return;
    }

    await next();

    for (const [key, value] of result.headers) {
      ctx.response.headers.set(key, value);
    }
  };
}
```

</details>

<br>

## 📄 라이선스

MIT
