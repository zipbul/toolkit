# @zipbul/router

**English** | [한국어](./README.ko.md)

[![npm](https://img.shields.io/npm/v/@zipbul/router)](https://www.npmjs.com/package/@zipbul/router)
![coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/parkrevil/3965fb9d1fe2d6fc5c321cb38d88c823/raw/router-coverage.json)

A high-performance URL router for Bun. Build-once / match-many. Hot static paths land in **single-digit nanoseconds**, dynamic hits around **~10 ns** with a warm cache, all surfaced through a small public API with structured error reporting.

Designed for HTTP server boundaries (`Bun.serve`, Node `http`,
adapters) that hand the router a normalized origin-form pathname.

<br>

## 📦 Installation

```bash
bun add @zipbul/router
```

<br>

## 🚀 Quick Start

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

<br>

## 📚 API Reference

### `new Router<T>(options?)`

Creates a router instance. `T` is the type of the value stored with each route.

```typescript
const router = new Router<string>();
const router = new Router<() => Response>({ pathCaseSensitive: false });
```

All methods can be detached (`const m = router.match; m('GET', '/x')`) — they do not read `this`.

### `router.add(method, path, value)`

Registers a route. Throws `RouterError` on invalid path, duplicate route, or if called after `build()`.

```typescript
router.add('GET', '/users/:id', handler);
router.add(['GET', 'POST'], '/data', handler);  // multiple methods
router.add('*', '/health', handler);             // all standard methods
```

`'*'` expands to `GET / POST / PUT / PATCH / DELETE / OPTIONS / HEAD`.

#### IRI registration (RFC 3987)

Both IRI (raw Unicode) and URI (percent-encoded UTF-8) forms are accepted at registration. The router NFC-normalizes each static segment and converts non-ASCII to percent-encoded UTF-8 (RFC 3986 wire form) before storing, so the two forms become aliases for one route:

```typescript
router.add('GET', '/users/한국', handler);
// Internally stored as `/users/%ED%95%9C%EA%B5%AD`. Both IRI and URI
// match() requests resolve to the same handler.
router.match('GET', '/users/%ED%95%9C%EA%B5%AD'); // ✓
```

**`router.match()` does not normalize input paths.** Pass a URI-form pathname (percent-encoded UTF-8). `Bun.serve`, Node `http`, and `new URL(...).pathname` all return this form automatically; you only need to think about it if you call `match()` with a hand-constructed string.

If you must route an IRI input at match time, normalize first:

```typescript
const out = router.match('GET', new URL(`/users/${name}`, 'http://x').pathname);
```

### `router.addAll(entries)`

Registers multiple routes at once. Fail-fast: throws `RouterError` on the first failure with `data.registeredCount` indicating how many succeeded before the error.

```typescript
router.addAll([
  ['GET', '/users', listUsers],
  ['POST', '/users', createUser],
  ['GET', '/users/:id', getUser],
]);
```

### `router.build()`

Seals the router and emits the specialized match function. Must be called before `match()`. Returns `this`. Subsequent calls are a no-op.

```typescript
router.build();
```

After `build()`, `add()` and `addAll()` throw `RouterError({ kind: 'router-sealed' })`.

### `router.match(method, path)`

Matches a URL against registered routes. Returns `MatchOutput<T> | null`.

- `path` must be an origin-form pathname (RFC 7230 §5.3.1). Standard HTTP server boundaries (`Bun.serve`, Node `http`, `Express`, `Fastify`, `Hono`) already produce this form via `new URL(req.url).pathname`.
- `match()` does **not** decode the path itself; it splits on `/` and decodes each captured param value via `decodeURIComponent`. Malformed `%xx` in a param slot propagates the standard `URIError` to the caller — wrap in `try / catch` if you map this to a `400 Bad Request`.
- Calling before `build()` returns `null`.

```typescript
const result = router.match('GET', '/users/42');

if (result) {
  result.value;       // T — the registered value
  result.params;      // Record<string, string | undefined> (null-prototype)
  result.meta.source; // 'static' | 'cache' | 'dynamic'
}
```

`meta.source` tells the caller how the match was resolved:

| Value | What it means for the caller |
|:------|:-----|
| `'static'` | A literal-path route (no params). The returned `MatchOutput` is shared across calls and frozen — do not mutate. `===` identity is preserved across identical hits. |
| `'cache'` | A previously-resolved dynamic match served from cache. The cached `params` object is frozen and reused across hits — do not mutate, and do not rely on per-call identity. |
| `'dynamic'` | First-time resolution for a dynamic route. Each call returns a fresh `MatchOutput` with its own `params` object. |

### `router.allowedMethods(path)`

Returns the HTTP methods registered for `path`. Used by HTTP adapters to disambiguate `404` (path has no routes) from `405` (path exists, wrong method).

```typescript
const result = router.match('GET', '/users/42');

if (result === null) {
  const allowed = router.allowedMethods('/users/42');
  if (allowed.length === 0) return respond404();
  return respond405({ Allow: allowed.join(', ') });
}
```

Call this **only after `match()` returns `null`** — it walks every registered method's tree for `path` and is meaningfully slower than `match()` itself. The recommended pattern is the 404/405 disambiguation shown above; calling it on hot match paths is not what it's tuned for.

<br>

## 🛤️ Route Patterns

### Static routes

```typescript
router.add('GET', '/users', handler);
router.add('GET', '/api/v1/health', handler);
```

### Named parameters

Capture a single path segment. Param values are always percent-decoded.

```typescript
router.add('GET', '/users/:id', handler);
// /users/42        → { id: '42' }
// /users/hello%20w → { id: 'hello w' }
```

### Regex parameters

Constrain params with inline regex. The body inside `(...)` is compiled via `new RegExp('^(?:body)$')` at `build()` time. The router applies its own anchors, so a body that starts with `^` or ends with `$` is rejected; otherwise any JavaScript-valid regex body is accepted.

```typescript
router.add('GET', '/users/:id(\\d+)', handler);
// /users/42   → { id: '42' }
// /users/abc  → no match
```

> ⚠ The router does not gate regex bodies for ReDoS-vulnerable shapes (`(?:a+)+`, `(\w+)\1`, etc.). See [Regex bodies](#regex-bodies--what-the-router-does-and-does-not-do) below.

### Optional parameters

A trailing `?` makes a param optional. Both with-param and without-param URLs match. The shape of `params` for the missing case is controlled by `optionalParamBehavior`:

```typescript
router.add('GET', '/:lang?/docs', handler);
```

| `optionalParamBehavior` | `/en/docs` | `/docs` |
|:------------------------|:-----------|:--------|
| `'omit'` (default) | `{ lang: 'en' }` | `{}` (key absent) |
| `'set-undefined'` | `{ lang: 'en' }` | `{ lang: undefined }` (key present) |

### Wildcards

Capture the rest of the URL, including slashes. Wildcard values are **not** percent-decoded. Two semantics, two distinct spellings — colon-form sugar (`:name+` / `:name*`) is rejected at parse time:

| Pattern | Semantics | Empty match |
|:--------|:----------|:------------|
| `*name`  | Star — match zero or more segments  | `'/files'` against `/files/*path` → `{ path: '' }` |
| `*name+` | Multi — match one or more segments  | `'/assets'` against `/assets/*file+` → no match |

```typescript
router.add('GET', '/files/*path', handler);
// /files/a/b/c.txt → { path: 'a/b/c.txt' }
// /files            → { path: '' }

router.add('GET', '/assets/*file+', handler);
// /assets/style.css → { file: 'style.css' }
// /assets           → no match (multi origin requires non-empty tail)
```

<br>

## ⚙️ Options

```typescript
interface RouterOptions {
  trailingSlash?: 'strict' | 'ignore';
  pathCaseSensitive?: boolean;
  cacheSize?: number;
  optionalParamBehavior?: 'omit' | 'set-undefined';
}
```

| Option | Default | Description |
|:-------|:--------|:------------|
| `trailingSlash` | `'ignore'` | `'strict'` keeps `/a` and `/a/` distinct; `'ignore'` collapses one trailing slash on registration and at match time |
| `pathCaseSensitive` | `true` | `/Users` and `/users` are different routes |
| `cacheSize` | `1000` | Per-method hit-cache capacity (rounded up to next power of two; bounded approximate-LRU eviction). Positive integer in `[1, 2³⁰]` |
| `optionalParamBehavior` | `'omit'` | Shape of `params` when an optional param is missing — `'omit'` drops the key, `'set-undefined'` writes `undefined` |

Notes:

- Named param values are always percent-decoded; wildcard captures are returned raw (slash-preserving).
- No total route-count cap. Per-route limits: **≤ 4 optional segments** and **≤ 31 captured params** (param + wildcard). Up to **32 distinct HTTP methods** per router.
- Empty routers allocate zero cache memory; `build()` pre-allocates a bounded hit cache for each active method.

### Cache — what to expect

- **Bounded.** `cacheSize` is the per-method ceiling, rounded up to the next power of two. Approximate-LRU eviction kicks in when the slot table fills.
- **Frozen + reused.** `MatchOutput.params` from a cache hit is `Object.freeze`d and shared across hits — do not mutate.
- **Never stale.** `build()` seals the route table; cached entries cannot diverge from registered handlers afterward.
- **Dynamic-route only.** Static routes skip the cache (they're already an O(1) lookup). Misses never populate the cache.

### Regex bodies — what the router does and does not do

`:id(pattern)` is registered if and only if:

1. The body compiles via `new RegExp('^(?:body)$')` — failure → `route-parse`.
2. The body does not start with `^` or end with `$` — the router applies its own anchors, so user anchors would either double up or contradict the wrapper → `route-parse`.

That's it. The router does **not** inspect the body for ReDoS-vulnerable shapes, capturing groups, lookaround, or any other structural property.

> ⚠ **Consequence:** patterns like `(?:a+)+`, `(\w+)\1`, or `(a|aa)*` register successfully and can hang the V8/JavaScriptCore regex engine on a crafted input. **If you accept untrusted regex sources, validate them before calling `Router.add()`.**

Validation options:

- **`re2`** ([github.com/uhop/node-re2](https://github.com/uhop/node-re2)) — drop-in `RegExp`-compatible binding to Google's RE2 engine (no backtracking). Use as a sandbox or to pre-flight a pattern.
- **`recheck`** ([github.com/MakeNowJust/recheck](https://github.com/MakeNowJust/recheck)) — static ReDoS analyzer. Reject vulnerable patterns before they reach `Router.add()`.
- **Allow-list** — accept only patterns you've handwritten and audited.

<br>

## 🚨 Error Handling

| Method | Throws | Returns |
|:---|:---|:---|
| `add()` / `addAll()` | `RouterError` on invalid path, conflict, or sealed router | `void` |
| `build()` | `RouterError({ kind: 'route-validation' })` listing every per-route failure | `this` |
| `match()` | `URIError` if a captured param's `%xx` is malformed — wrap in `try / catch` to map to `400 Bad Request` | `MatchOutput<T> \| null` |
| `allowedMethods()` | Never throws | `readonly string[]` |

Every `RouterError` carries a structured `data` object — narrow on `data.kind` (discriminated union) to access kind-specific fields like `segment`, `conflictsWith`, `suggestion`, `path`, `method`.

```typescript
import { Router, RouterError } from '@zipbul/router';

try {
  router.add('GET', '/bad/(unmatched', handler);
} catch (e) {
  if (e instanceof RouterError) {
    e.data.kind;       // RouterErrorKind — discriminant
    e.data.message;    // Human-readable description
    e.data.path;       // The problematic path (when applicable)
    e.data.method;     // The HTTP method (when applicable)
  }
}
```

### Error Kinds

| Kind | When |
|:-----|:-----|
| `'router-sealed'` | `add()` / `addAll()` called after `build()` |
| `'route-duplicate'` | Same `(method, path)` already registered |
| `'route-conflict'` | Structural conflict — e.g. registering `/files/*a` then `/files/*b` for the same method, or registering `/files/x` after `/files/*path` |
| `'route-unreachable'` | A new route would be shadowed by an existing wildcard / terminal at the same prefix — e.g. registering `/files/list` after `/files/*path` for the same method |
| `'route-parse'` | Invalid path syntax (no leading slash, unclosed regex group, illegal char in param name, etc.) |
| `'param-duplicate'` | Same param name appears twice in one path (`/x/:id/y/:id`) |
| `'method-limit'` | More than 32 distinct HTTP methods registered |
| `'method-empty'` / `'method-invalid-token'` | Method token violates the HTTP token grammar (RFC 9110 §5.6.2) |
| `'path-missing-leading-slash'` / `'path-query'` / `'path-fragment'` / `'path-control-char'` / `'path-invalid-pchar'` / `'path-malformed-percent'` / `'path-invalid-utf8'` / `'path-encoded-slash'` / `'path-dot-segment'` / `'path-empty-segment'` | The registered path violates the router-grammar / RFC-conformance gate at registration time |
| `'router-options-invalid'` | A `RouterOptions` field failed validation (e.g. `cacheSize` outside `[1, 2³⁰]`) |
| `'route-validation'` | One or more routes failed validation during `build()` — `data.errors` lists each per-route failure |

### Conflict examples

```typescript
// Cross-method coexistence is allowed
router.add('GET',  '/files/*path', getHandler);
router.add('POST', '/files/*upload', postHandler);  // ok

// Same-method wildcard rename: route-conflict
router.add('GET',  '/files/*path', getHandler);
router.add('GET',  '/files/*upload', anotherHandler); // throws

// Static under wildcard prefix: route-conflict
router.add('GET',  '/files/*path', getHandler);
router.add('GET',  '/files/list', listHandler);       // throws
```

<br>

## 🔌 Framework Integration

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

    // match() returns null for no route. `URL(...).pathname` is always
    // origin-form per RFC 7230, so `decodeURIComponent` failures only
    // surface here on adversarial requests with malformed `%xx` — wrap
    // in try/catch if you want to map them to 400 Bad Request.
    const result = router.match(request.method, url.pathname);
    if (result) return result.value(result.params);

    // Disambiguate 404 vs 405 via the cold-path API.
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

## ⚡ Performance

Indicative hot-path numbers (Bun 1.3.13, Linux x64):

| Workload | Range |
|:---|---:|
| `build()` — 100 routes | ~2 ms |
| `build()` — 10 000 routes | ~25 ms |
| `match()` — hit / static | single-digit ns |
| `match()` — hit / dynamic (warm cache) | ~10 ns |
| `match()` — miss / wrong method | ~3 ns |

Head-to-head against `memoirist`, `find-my-way`, `rou3`, `hono` (RegExp + Trie), and `koa-tree-router`, `@zipbul/router` leads on every successful-match scenario and ties or wins most miss / wrong-method cases.

Hardware variance is ±20 % and sub-10 ns ops hit clock-granularity noise — for the full table, noise distribution, and the production-realistic single-router bench, see [`bench-results.md`](./bench-results.md). Reproduce locally with:

```bash
bun bench/regression-snapshot.ts   # self-bench (11 trials, σ-annotated)
bun bench/comparison.bench.ts      # 23-scenario cross-router head-to-head
bun bench/comparison-solo.bench.ts # production-realistic per-router probe
```

<br>

## 🔒 Security

Found a security issue? See [`SECURITY.md`](./SECURITY.md) for the private reporting channel. **Do not** open a public GitHub issue for security reports.

<br>

## 📄 License

MIT
