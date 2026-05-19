# @zipbul/router

**English** | [한국어](./README.ko.md)

[![npm](https://img.shields.io/npm/v/@zipbul/router)](https://www.npmjs.com/package/@zipbul/router)
![coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/parkrevil/3965fb9d1fe2d6fc5c321cb38d88c823/raw/router-coverage.json)

A high-performance URL router for Bun. Build-once / match-many. Hot static paths land in **single-digit nanoseconds**, dynamic hits around **~10 ns** with a warm cache, all surfaced through a small public API with structured error reporting.

Designed for HTTP server boundaries (`Bun.serve`, Node `http`,
adapters) that hand the router a normalized origin-form pathname.

> [!NOTE]
> This package targets **Bun ≥ 1.0**. The code uses Bun-specific build artifacts (`bun:jsc` for JIT tier-up hints) and is not published as a Node-compatible build.

---

## 📑 Table of Contents

- [📦 Installation](#-installation)
- [🚀 Quick Start](#-quick-start)
- [📚 API Reference](#-api-reference)
  - [`new Router<T>(options?)`](#new-routertoptions)
  - [`router.add(method, path, value)`](#routeraddmethod-path-value)
  - [`router.addAll(entries)`](#routeraddallentries)
  - [`router.build()`](#routerbuild)
  - [`router.match(method, path)`](#routermatchmethod-path)
  - [`router.allowedMethods(path)`](#routerallowedmethodspath)
- [🛤️ Route Patterns](#️-route-patterns)
- [⚙️ Options](#️-options)
- [🚨 Error Handling](#-error-handling)
- [🔌 Framework Integration](#-framework-integration)
- [⚡ Performance](#-performance)
- [🔒 Security](#-security)

---

## 📦 Installation

```bash
bun add @zipbul/router
```

---

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
  console.log(result.value); // 'get-user'
  console.log(result.params['id']); // '42'
  console.log(result.meta.source); // 'dynamic' (first call; subsequent calls on the same path return 'cache')
}
```

---

## 📚 API Reference

### `new Router<T>(options?)`

Creates a router instance. `T` is the type of the value stored with each route.

```typescript
const stringRouter = new Router<string>();
const handlerRouter = new Router<() => Response>({ pathCaseSensitive: false });
```

All methods can be detached (`const m = router.match; m('GET', '/x')`) — they do not read `this`.

### `router.add(method, path, value)`

Queues a route for registration. Path-syntax / conflict / duplicate validation runs at `build()` time, not on this call. Throws `RouterError({ kind: 'router-sealed' })` only if called after `build()`.

```typescript
router.add('GET', '/users/:id', handler);
router.add(['GET', 'POST'], '/data', handler); // multiple methods
router.add('*', '/health', handler); // expand-at-seal
```

`'*'` expands at `build()` time to every method present at seal — the seven HTTP defaults (`GET / POST / PUT / PATCH / DELETE / OPTIONS / HEAD`) **plus** any custom method introduced by another route registered before `build()`.

#### IRI registration (RFC 3987)

Both IRI (raw Unicode) and URI (percent-encoded UTF-8) forms are accepted **at registration**. Each static segment is NFC-normalized and converted to percent-encoded UTF-8 (RFC 3986 wire form) before storage, so both spellings collapse to one route entry:

```typescript
router.add('GET', '/users/한국', handler);
router.build();
// Stored internally as `/users/%ED%95%9C%EA%B5%AD`.
router.match('GET', '/users/%ED%95%9C%EA%B5%AD'); // ✓ matches
router.match('GET', '/users/한국'); // ✗ does NOT match (see below)
```

> [!IMPORTANT]
> `router.match()` **does not normalize input paths**. Pass a URI-form pathname (percent-encoded UTF-8) — the form `Bun.serve` produces via `new URL(request.url).pathname`. The asymmetry is intentional: the server boundary already delivers URI form, so paying the normalization cost on every `match()` would be wasted work on the hot path.

For a hand-constructed IRI input, normalize at the boundary:

```typescript
const out = router.match('GET', new URL(`/users/${name}`, 'http://localhost').pathname);
```

### `router.addAll(entries)`

Queues multiple routes at once. Like `add()`, validation is deferred to `build()`; this call only throws `RouterError({ kind: 'router-sealed' })` if invoked after `build()`.

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

- `path` must be an origin-form pathname (RFC 7230 §5.3.1). `Bun.serve` already produces this form via `new URL(request.url).pathname`.
- `match()` does **not** decode the path itself; it splits on `/` and decodes each captured param value via `decodeURIComponent`. Malformed `%xx` in a param slot propagates the standard `URIError` to the caller — wrap in `try / catch` if you map this to a `400 Bad Request`.
- Calling before `build()` returns `null`.

```typescript
const result = router.match('GET', '/users/42');

if (result) {
  result.value; // T — the registered value
  result.params; // Record<string, string | undefined> (null-prototype)
  result.meta.source; // 'static' | 'cache' | 'dynamic'
}
```

`meta.source` tells the caller how the match was resolved:

| Value       | What it means for the caller                                                                                                                                       |
| :---------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'static'`  | A literal-path route (no params). The returned `MatchOutput` is shared across calls and frozen — do not mutate. `===` identity is preserved across identical hits. |
| `'cache'`   | A dynamic match served from cache. The cached `params` object is frozen and reused across hits — do not mutate, and do not rely on per-call identity.              |
| `'dynamic'` | First-time resolution for a dynamic route. Each call returns a fresh `MatchOutput` with its own `params` object.                                                   |

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

> [!TIP]
> Call `allowedMethods()` **only after `match()` returns `null`**. It walks every registered method's tree for `path` and is meaningfully slower than `match()` itself. The 404/405 disambiguation shown above is the intended use; do not call it on hot match paths.

---

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

> [!WARNING]
> The router does **not** gate regex bodies for ReDoS-vulnerable shapes (`(?:a+)+`, `(\w+)\1`, etc.). See [Regex bodies](#regex-bodies--what-the-router-does-and-does-not-do) below for the validation pattern.

### Optional parameters

A trailing `?` makes a param optional. Both with-param and without-param URLs match. The shape of `params` for the missing case is controlled by `omitMissingOptional`:

```typescript
router.add('GET', '/:lang?/docs', handler);
```

| `omitMissingOptional` | `/en/docs`       | `/docs`                             |
| :-------------------- | :--------------- | :---------------------------------- |
| `true` (default)      | `{ lang: 'en' }` | `{}` (key absent)                   |
| `false`               | `{ lang: 'en' }` | `{ lang: undefined }` (key present) |

### Wildcards

Capture the rest of the URL, including slashes. Wildcard values are **not** percent-decoded. Two semantics, two distinct spellings — colon-form sugar (`:name+` / `:name*`) is rejected at parse time:

| Pattern  | Semantics                                                      | Empty match                                        |
| :------- | :------------------------------------------------------------- | :------------------------------------------------- |
| `*name`  | Star — match the entire tail, including slashes (may be empty) | `'/files'` against `/files/*path` → `{ path: '' }` |
| `*name+` | Multi — match the entire tail, including slashes (non-empty)   | `'/assets'` against `/assets/*file+` → no match    |

```typescript
router.add('GET', '/files/*path', handler);
// /files/a/b/c.txt → { path: 'a/b/c.txt' }
// /files            → { path: '' }

router.add('GET', '/assets/*file+', handler);
// /assets/style.css → { file: 'style.css' }
// /assets           → no match (`*name+` multi-wildcard requires a non-empty tail)
```

---

## ⚙️ Options

```typescript
interface RouterOptions {
  ignoreTrailingSlash?: boolean;
  pathCaseSensitive?: boolean;
  cacheSize?: number;
  omitMissingOptional?: boolean;
}

new Router<string>({
  ignoreTrailingSlash: false,
  omitMissingOptional: false,
});
```

| Option                | Default | Description                                                                                                                                  |
| :-------------------- | :------ | :------------------------------------------------------------------------------------------------------------------------------------------- |
| `ignoreTrailingSlash` | `true`  | Collapses one trailing slash on registration and at match time, so `/a` and `/a/` resolve to the same route. Set `false` for strict matching |
| `pathCaseSensitive`   | `true`  | `/Users` and `/users` are different routes                                                                                                   |
| `cacheSize`           | `1000`  | Per-method hit-cache capacity (rounded up to next power of two; bounded approximate-LRU eviction). Positive integer in `[1, 2³⁰]`            |
| `omitMissingOptional` | `true`  | Shape of `params` when an optional `:name?` segment is missing — `true` drops the key, `false` writes `params[name] = undefined`             |

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

> [!CAUTION]
> Patterns like `(?:a+)+`, `(\w+)\1`, or `(a|aa)*` register successfully and can hang the V8/JavaScriptCore regex engine on a crafted input. **If you accept untrusted regex sources, validate them before calling `Router.add()`.**

Validation options:

- **`re2`** ([github.com/uhop/node-re2](https://github.com/uhop/node-re2)) — drop-in `RegExp`-compatible binding to Google's RE2 engine (no backtracking). Use as a sandbox or to pre-flight a pattern.
- **`recheck`** ([github.com/MakeNowJust/recheck](https://github.com/MakeNowJust/recheck)) — static ReDoS analyzer. Reject vulnerable patterns before they reach `Router.add()`.
- **Allow-list** — accept only patterns you've handwritten and audited.

---

## 🚨 Error Handling

| Method               | Throws                                                                                                                 | Returns                  |
| :------------------- | :--------------------------------------------------------------------------------------------------------------------- | :----------------------- |
| `add()` / `addAll()` | `RouterError({ kind: 'router-sealed' })` only — every other validation is deferred to `build()`                        | `void`                   |
| `build()`            | `RouterError({ kind: 'route-validation' })` listing every per-route failure                                            | `this`                   |
| `match()`            | `URIError` if a captured param's `%xx` is malformed — wrap in `try / catch` to map to `400 Bad Request`                | `MatchOutput<T> \| null` |
| `allowedMethods()`   | `URIError` if the path drives a regex-param walker through malformed `%xx` — same `try / catch` treatment as `match()` | `readonly string[]`      |

Every `RouterError` carries a structured `data` object — narrow on `data.kind` (discriminated union) to access kind-specific fields like `segment`, `conflictsWith`, `suggestion`, `path`, `method`.

```typescript
import { Router, RouterError } from '@zipbul/router';

router.add('GET', '/bad/(unmatched', handler);

try {
  router.build();
} catch (e) {
  if (e instanceof RouterError) {
    e.data.kind; // RouterErrorKind — discriminant (e.g. 'route-validation' from build())
    e.data.message; // Human-readable description
    if (e.data.kind === 'route-validation') {
      e.data.errors; // ReadonlyArray<{ index, route, error: RouterErrorData }>
    }
  }
}
```

### Error Kinds

| Kind                                                                                                                                                                                                                                               | When                                                                                                                                                                                 |
| :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'router-sealed'`                                                                                                                                                                                                                                  | `add()` / `addAll()` called after `build()`                                                                                                                                          |
| `'route-duplicate'`                                                                                                                                                                                                                                | Same `(method, path)` already registered                                                                                                                                             |
| `'route-conflict'`                                                                                                                                                                                                                                 | Structural collision at the same tree position — e.g. two wildcards with different names (`/files/*a` then `/files/*b`) or a regex param vs a non-regex param of the same name       |
| `'route-unreachable'`                                                                                                                                                                                                                              | A new route would be shadowed by an existing wildcard / terminal at the same prefix — e.g. registering `/files/list` (or any specific path) after `/files/*path` for the same method |
| `'route-parse'`                                                                                                                                                                                                                                    | Invalid path syntax (no leading slash, unclosed regex group, illegal char in param name, etc.)                                                                                       |
| `'param-duplicate'`                                                                                                                                                                                                                                | Same param name appears twice in one path (`/x/:id/y/:id`)                                                                                                                           |
| `'method-limit'`                                                                                                                                                                                                                                   | More than 32 distinct HTTP methods registered                                                                                                                                        |
| `'method-empty'` / `'method-invalid-token'`                                                                                                                                                                                                        | Method token violates the HTTP token grammar (RFC 9110 §5.6.2)                                                                                                                       |
| `'path-missing-leading-slash'` / `'path-query'` / `'path-fragment'` / `'path-control-char'` / `'path-invalid-pchar'` / `'path-malformed-percent'` / `'path-invalid-utf8'` / `'path-encoded-slash'` / `'path-dot-segment'` / `'path-empty-segment'` | The registered path violates the router-grammar / RFC-conformance gate at registration time                                                                                          |
| `'router-options-invalid'`                                                                                                                                                                                                                         | A `RouterOptions` field failed validation (e.g. `cacheSize` outside `[1, 2³⁰]`)                                                                                                      |
| `'route-validation'`                                                                                                                                                                                                                               | One or more routes failed validation during `build()` — `data.errors` lists each per-route failure                                                                                   |

### Conflict examples

```typescript
// Cross-method coexistence is allowed
router.add('GET', '/files/*path', getHandler);
router.add('POST', '/files/*upload', postHandler);
router.build(); // ok

// Same-method wildcard rename: route-conflict
router.add('GET', '/files/*path', getHandler);
router.add('GET', '/files/*upload', anotherHandler);
router.build(); // throws RouterError({ kind: 'route-validation', errors: [ { error: { kind: 'route-conflict', ... } } ] })

// Static under wildcard prefix: route-unreachable (the wildcard already swallows the entire suffix)
router.add('GET', '/files/*path', getHandler);
router.add('GET', '/files/list', listHandler);
router.build(); // throws RouterError({ kind: 'route-validation', errors: [ { error: { kind: 'route-unreachable', ... } } ] })
```

---

## 🔌 Framework Integration

<details>
<summary><b>Bun.serve</b></summary>

```typescript
import { Router } from '@zipbul/router';

type Handler = (params: Record<string, string | undefined>) => Response;

const router = new Router<Handler>();
router.add('GET', '/users', () => Response.json({ users: [] }));
router.add('GET', '/users/:id', p => Response.json({ id: p.id }));
router.add('POST', '/users', () => new Response('Created', { status: 201 }));
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

---

## ⚡ Performance

Measured on `bun 1.3.13`, Linux x64, Intel i7-13700K, 11-trial median per
`regression-snapshot.ts` row, fresh-process-per-pair for the cross-router
table. Full numbers, σ, RSS, and reproduction procedure in
[`bench-results.md`](./bench-results.md).

| Workload                               |   median |
| :------------------------------------- | -------: |
| `build()` — 100 routes                 |  2.51 ms |
| `build()` — 10 000 routes              | 27.62 ms |
| `match()` — hit / static               |  3.64 ns |
| `match()` — hit / dynamic (warm cache) |  9.06 ns |
| `match()` — miss / wrong method        |  2.64 ns |

Cross-router single-param hit (`/users/:id`), fresh-process-per-adapter:

| Adapter         | avg ns/op |
| :-------------- | --------: |
| **zipbul**      | **12.15** |
| memoirist       |     40.03 |
| rou3            |     50.81 |
| hono-regexp     |    106.42 |
| koa-tree-router |    118.48 |
| find-my-way     |    119.07 |
| hono-trie       |    236.57 |

Hardware variance is ±20 % and sub-10 ns ops hit clock-granularity noise. Reproduce locally with:

```bash
bun bench/regression-snapshot.ts   # self-bench (11 trials, σ-annotated)
bun bench/comparison.bench.ts      # cross-router head-to-head
```

---

## 🔒 Security

Found a security issue? See [`SECURITY.md`](./SECURITY.md) for the private reporting channel. **Do not** open a public GitHub issue for security reports.

---

## 📄 License

MIT
