# @zipbul/cors

**English** | [한국어](./README.ko.md)

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

const cors = new Cors({
  origin: 'https://my-app.example.com',
  credentials: true,
});

async function handleRequest(request: Request): Promise<Response> {
  const result = await cors.handle(request);

  if (result.action === CorsAction.Reject) {
    return new Response('Forbidden', { status: 403 });
  }

  if (result.action === CorsAction.RespondPreflight) {
    return Cors.createPreflightResponse(result);
  }

  const response = new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  });

  return Cors.applyHeaders(result, response);
}
```

<br>

## ⚙️ Options

```typescript
interface CorsOptions {
  origin?: OriginOptions;              // Default: '*'
  methods?: HttpMethod[] | string[];   // Default: GET, HEAD, PUT, PATCH, POST, DELETE
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

> When `credentials: true`, `origin: '*'` automatically reflects the request origin.

### `methods`

HTTP methods to allow in preflight. Accepts `HttpMethod[]` or `string[]`.

```typescript
new Cors({ methods: ['GET', 'POST', 'DELETE'] });
```

A wildcard `'*'` allows all methods. With `credentials: true`, the wildcard is replaced by echoing the request method.

### `allowedHeaders`

Request headers to allow in preflight. When not set, the client's `Access-Control-Request-Headers` value is echoed back.

```typescript
new Cors({ allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'] });
```

> **⚠️ Authorization caveat** — Per the Fetch Standard, a wildcard `'*'` alone does not cover the `Authorization` header. You must list it explicitly.
>
> ```typescript
> new Cors({ allowedHeaders: ['*', 'Authorization'] });
> ```

### `exposedHeaders`

Response headers to expose to browser JavaScript.

```typescript
new Cors({ exposedHeaders: ['X-Request-Id', 'X-Rate-Limit-Remaining'] });
```

> With `credentials: true`, using a wildcard `'*'` causes the `Access-Control-Expose-Headers` header to not be set at all.

### `credentials`

Whether to include the `Access-Control-Allow-Credentials: true` header.

```typescript
new Cors({ origin: 'https://app.example.com', credentials: true });
```

### `maxAge`

How long (in seconds) the browser may cache the preflight result.

```typescript
new Cors({ maxAge: 86400 }); // 24 hours
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

Returned for normal (non-OPTIONS) requests, or preflight when `preflightContinue: true`. Use `Cors.applyHeaders(result, response)` to merge headers into the response.

#### `CorsPreflightResult`

```typescript
{ action: CorsAction.RespondPreflight; headers: Headers; statusCode: number }
```

Returned for `OPTIONS` requests that include `Access-Control-Request-Method`. Use `Cors.createPreflightResponse(result)` to generate the response.

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

<br>

## 🔧 Static Methods

### `Cors.applyHeaders(result, response)`

Merges CORS headers from a `CorsAllowed` result into an existing `Response`. The `Vary` header is merged without duplicates, preserving existing values.

```typescript
const corsResponse = Cors.applyHeaders(result, response);
```

### `Cors.createPreflightResponse(result)`

Creates a bodiless preflight `Response` from a `CorsPreflightResult`.

```typescript
const preflightResponse = Cors.createPreflightResponse(result);
```

<br>

## 🔬 Advanced Usage

### Origin option patterns

```typescript
// Single origin
new Cors({ origin: 'https://app.example.com' });

// Multiple origins (mix of strings and regexes)
new Cors({
  origin: [
    'https://app.example.com',
    'https://admin.example.com',
    /^https:\/\/preview-\d+\.example\.com$/,
  ],
});

// Regex to allow all subdomains
new Cors({ origin: /^https:\/\/(.+\.)?example\.com$/ });
```

### Async origin function

Dynamically validate origins via a database or external service.

```typescript
new Cors({
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

> If the origin function throws, `handle()` re-throws as-is. The library does not swallow errors.

### Wildcards and credentials

Per the Fetch Standard, wildcards (`*`) cannot be used with credentialed requests (cookies, `Authorization`).
When `credentials: true`, the library automatically handles the following:

| Option | Behavior with wildcard |
|:-------|:-----------------------|
| `origin: '*'` | Reflects the request origin + adds `Vary: Origin` |
| `methods: ['*']` | Echoes the request method |
| `allowedHeaders: ['*']` | Echoes the request headers |
| `exposedHeaders: ['*']` | `Access-Control-Expose-Headers` is not set |

```typescript
// ✅ origin: '*' + credentials: true → request origin is reflected
new Cors({ credentials: true });

// ✅ Specific domain + credentials
new Cors({ origin: 'https://app.example.com', credentials: true });
```

### Preflight delegation

When another middleware needs to handle OPTIONS requests directly:

```typescript
const cors = new Cors({ preflightContinue: true });

async function handle(request: Request): Promise<Response> {
  const result = await cors.handle(request);

  if (result.action === CorsAction.Reject) {
    return new Response('Forbidden', { status: 403 });
  }

  // Continue — both normal and preflight requests arrive here
  const response = await nextHandler(request);
  return Cors.applyHeaders(result, response);
}
```

<br>

## 🔌 Framework Integration Examples

<details>
<summary><b>Bun.serve</b></summary>

```typescript
import { Cors, CorsAction } from '@zipbul/cors';

const cors = new Cors({
  origin: ['https://app.example.com'],
  credentials: true,
  exposedHeaders: ['X-Request-Id'],
});

Bun.serve({
  async fetch(request) {
    const result = await cors.handle(request);

    if (result.action === CorsAction.Reject) {
      return new Response(
        JSON.stringify({ error: 'CORS policy violation', reason: result.reason }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (result.action === CorsAction.RespondPreflight) {
      return Cors.createPreflightResponse(result);
    }

    const response = await router.handle(request);
    return Cors.applyHeaders(result, response);
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

function corsMiddleware(options?: CorsOptions) {
  const cors = new Cors(options);

  return async (ctx: Context, next: () => Promise<void>) => {
    const result = await cors.handle(ctx.request);

    if (result.action === CorsAction.Reject) {
      ctx.status = 403;
      ctx.body = { error: 'CORS_VIOLATION', reason: result.reason };
      return;
    }

    if (result.action === CorsAction.RespondPreflight) {
      ctx.response = Cors.createPreflightResponse(result);
      return;
    }

    await next();
    ctx.response = Cors.applyHeaders(result, ctx.response);
  };
}
```

</details>

<br>

## 📄 License

MIT
