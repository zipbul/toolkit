# @zipbul/cors

**English** | [한국어](./README.ko.md)

[![npm](https://img.shields.io/npm/v/@zipbul/cors)](https://www.npmjs.com/package/@zipbul/cors)
![coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/parkrevil/3965fb9d1fe2d6fc5c321cb38d88c823/raw/cors-coverage.json)

A framework-agnostic CORS handling library.
Instead of generating responses directly, it returns a **discriminated union** result, giving the caller full control over the response.

> Uses standard Web APIs (`Request` / `Response`).

<br>

## 📦 Installation

```bash
bun add @zipbul/cors
```

<br>

## 💡 Core Concept

`handle()` does not create a response. It only tells you **what to do next**.

```
CorsResult
├── Continue          → Attach CORS headers to the response and continue
├── RespondPreflight  → Return a preflight-only response immediately
└── Reject            → Reject the request (with reason)
```

This design fits naturally into any environment — middleware pipelines, edge runtimes, custom error formats, and more.

<br>

## 🚀 Quick Start

```typescript
import { Cors, CorsAction } from '@zipbul/cors';
import { isErr } from '@zipbul/result';

const corsResult = Cors.create({
  origin: 'https://my-app.example.com',
  credentials: true,
});

if (isErr(corsResult)) {
  throw new Error(`CORS config error: ${corsResult.data.message}`);
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

  // CorsAction.Continue — merge CORS headers into your response
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

## ⚙️ Options

```typescript
interface CorsOptions {
  origin?: OriginOptions;              // Default: '*'
  methods?: CorsMethod[];              // Default: GET, HEAD, PUT, PATCH, POST, DELETE
  allowedHeaders?: string[];           // Default: reflects request's ACRH
  exposedHeaders?: string[];           // Default: none
  credentials?: boolean;               // Default: false
  maxAge?: number;                     // Default: none (header not included)
  preflightContinue?: boolean;         // Default: false
  optionsSuccessStatus?: number;       // Default: 204
}
```

### `origin`

| Value | Behavior |
|:------|:---------|
| `'*'` _(default)_ | Allow all origins |
| `false` | Reject all origins |
| `true` | Reflect the request origin |
| `'https://example.com'` | Allow only the exact match |
| `/^https:\/\/(.+\.)?example\.com$/` | Regex matching |
| `['https://a.com', /^https:\/\/b\./]` | Array (mix of strings and regexes) |
| `(origin, request) => boolean \| string` | Function (sync or async) |

> When `credentials: true`, `origin: '*'` causes a **validation error**. Use `origin: true` to reflect the request origin.
>
> RegExp origins are checked for **ReDoS safety** at creation time using [safe-regex2](https://github.com/fastify/safe-regex2). Patterns with star height ≥ 2 (e.g. `/(a+)+$/`) are rejected with `CorsErrorReason.UnsafeRegExp`.

### `methods`

HTTP methods to allow in preflight. Accepts `CorsMethod[]` — standard methods are autocompleted, and any RFC 9110 §5.6.2 token (e.g. `'PROPFIND'`) is also valid.

```typescript
Cors.create({ methods: ['GET', 'POST', 'DELETE'] });
Cors.create({ methods: ['GET', 'PROPFIND'] }); // custom token
```

A wildcard `'*'` allows all methods. With `credentials: true`, the wildcard is replaced by echoing the request method.

### `allowedHeaders`

Request headers to allow in preflight. When not set, the client's `Access-Control-Request-Headers` value is echoed back.

```typescript
Cors.create({ allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'] });
```

> **⚠️ Authorization caveat** — Per the Fetch Standard, a wildcard `'*'` alone does not cover the `Authorization` header. You must list it explicitly.
>
> ```typescript
> Cors.create({ allowedHeaders: ['*', 'Authorization'] });
> ```

### `exposedHeaders`

Response headers to expose to browser JavaScript.

```typescript
Cors.create({ exposedHeaders: ['X-Request-Id', 'X-Rate-Limit-Remaining'] });
```

> With `credentials: true`, using a wildcard `'*'` causes the `Access-Control-Expose-Headers` header to not be set at all.

### `credentials`

Whether to include the `Access-Control-Allow-Credentials: true` header.

```typescript
Cors.create({ origin: 'https://app.example.com', credentials: true });
```

### `maxAge`

How long (in seconds) the browser may cache the preflight result.

```typescript
Cors.create({ maxAge: 86400 }); // 24 hours
```

### `preflightContinue`

When set to `true`, preflight requests are not handled automatically. Instead, `CorsAction.Continue` is returned, delegating to the next handler.

### `optionsSuccessStatus`

HTTP status code for the preflight response. Defaults to `204`. Set to `200` if legacy browser compatibility is needed.

<br>

## 📤 Return Types

`handle()` returns `Promise<CorsResult>`. `CorsResult` is a discriminated union of three interfaces.

#### `CorsContinueResult`

```typescript
{ action: CorsAction.Continue; headers: Headers }
```

Returned for normal (non-OPTIONS) requests, or preflight when `preflightContinue: true`. Merge `headers` into your response directly.

#### `CorsPreflightResult`

```typescript
{ action: CorsAction.RespondPreflight; headers: Headers; statusCode: number }
```

Returned for `OPTIONS` requests that include `Access-Control-Request-Method`. Use `headers` and `statusCode` to build a response.

#### `CorsRejectResult`

```typescript
{ action: CorsAction.Reject; reason: CorsRejectionReason }
```

Returned when CORS validation fails. Use `reason` to build a detailed error response.

| `CorsRejectionReason` | Meaning |
|:-----------------------|:--------|
| `NoOrigin` | `Origin` header missing or empty |
| `OriginNotAllowed` | Origin not in the allowed list |
| `MethodNotAllowed` | Request method not in the allowed list |
| `HeaderNotAllowed` | Request header not in the allowed list |

`Cors.create()` returns `Err<CorsError>` when options fail validation:

| `CorsErrorReason` | Meaning |
|:------------------|:--------|
| `CredentialsWithWildcardOrigin` | `credentials:true` with `origin:'*'` (Fetch Standard §3.3.5) |
| `InvalidMaxAge` | `maxAge` is not a non-negative integer (RFC 9111 §1.2.1) |
| `InvalidStatusCode` | `optionsSuccessStatus` is not a 2xx integer |
| `InvalidOrigin` | `origin` is an empty/blank string, empty array, or array with empty/blank entries (RFC 6454) |
| `InvalidMethods` | `methods` is empty, or contains empty/blank entries (RFC 9110 §5.6.2) |
| `InvalidAllowedHeaders` | `allowedHeaders` contains empty/blank entries (RFC 9110 §5.6.2) |
| `InvalidExposedHeaders` | `exposedHeaders` contains empty/blank entries (RFC 9110 §5.6.2) |
| `OriginFunctionError` | Origin function threw at runtime |
| `UnsafeRegExp` | origin RegExp has exponential backtracking risk (ReDoS) |

<br>

## 🔬 Advanced Usage

### Origin option patterns

```typescript
// Single origin
Cors.create({ origin: 'https://app.example.com' });

// Multiple origins (mix of strings and regexes)
Cors.create({
  origin: [
    'https://app.example.com',
    'https://admin.example.com',
    /^https:\/\/preview-\d+\.example\.com$/,
  ],
});

// Regex to allow all subdomains
Cors.create({ origin: /^https:\/\/(.+\.)?example\.com$/ });
```

### Async origin function

Dynamically validate origins via a database or external service.

```typescript
Cors.create({
  origin: async (origin, request) => {
    const tenant = request.headers.get('X-Tenant-Id');
    const allowed = await db.isOriginAllowed(tenant, origin);

    return allowed ? true : false;
    // true   → reflect the request origin
    // string → use the specified string
    // false  → reject
  },
});
```

> If the origin function throws, `handle()` returns `Err<CorsError>` with `reason: CorsErrorReason.OriginFunctionError`. The error is wrapped, not re-thrown.

### Wildcards and credentials

Per the Fetch Standard, wildcards (`*`) cannot be used with credentialed requests (cookies, `Authorization`).
When `credentials: true`, the library automatically handles the following:

| Option | Behavior with wildcard |
|:-------|:-----------------------|
| `origin: '*'` | **Validation error** — use `origin: true` to reflect the request origin |
| `methods: ['*']` | Echoes the request method |
| `allowedHeaders: ['*']` | Echoes the request headers |
| `exposedHeaders: ['*']` | `Access-Control-Expose-Headers` is not set |

```typescript
// ✅ origin: true + credentials: true → request origin is reflected
Cors.create({ origin: true, credentials: true });

// ✅ Specific domain + credentials
Cors.create({ origin: 'https://app.example.com', credentials: true });

// ❌ origin: '*' + credentials: true → Cors.create() returns Err<CorsError>
Cors.create({ origin: '*', credentials: true }); // CorsErrorReason.CredentialsWithWildcardOrigin
```

### Preflight delegation

When another middleware needs to handle OPTIONS requests directly:

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

  // Continue — both normal and preflight requests arrive here
  const response = await nextHandler(request);

  for (const [key, value] of result.headers) {
    response.headers.set(key, value);
  }

  return response;
}
```

<br>

## 🔌 Framework Integration Examples

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
<summary><b>Middleware pattern</b></summary>

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

## 📄 License

MIT
