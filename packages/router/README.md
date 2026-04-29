# @zipbul/router

**English** | [한국어](./README.ko.md)

[![npm](https://img.shields.io/npm/v/@zipbul/router)](https://www.npmjs.com/package/@zipbul/router)
![coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/parkrevil/3965fb9d1fe2d6fc5c321cb38d88c823/raw/router-coverage.json)

A high-performance segment-tree URL router for Bun.
Per-method tree isolation, regex param patterns, sibling-param backtracking, and structured error handling.

> Static routes resolve via O(1) Map lookup. Dynamic routes traverse a shape-specialized walker emitted at `build()` time — codegen specialist (static-prefix wildcard), codegen general (`compileSegmentTree`), iterative (no static/param ambiguity), or recursive backtracking (universal fallback).

<br>

## 📦 Installation

```bash
bun add @zipbul/router
```

<br>

## 🚀 Quick Start

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

## 📚 API Reference

### `new Router<T>(options?)`

Creates a router instance. `T` is the type of the value stored with each route.

```typescript
const router = new Router<string>();
const router = new Router<() => Response>({ caseSensitive: false });
```

The instance is `Object.freeze`d at the end of the constructor; all methods are arrow-function fields that close over the constructor's locals, so detached calls (`const m = router.match; m(...)`) work without `bind()`.

### `router.add(method, path, value)`

Registers a route. Throws `RouterError` on invalid path, duplicate route, or if called after `build()`.

```typescript
router.add('GET', '/users/:id', handler);
router.add(['GET', 'POST'], '/data', handler);  // multiple methods
router.add('*', '/health', handler);             // all standard methods
```

`'*'` expands to `GET / POST / PUT / PATCH / DELETE / OPTIONS / HEAD`.

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

Matches a URL against registered routes. Returns `MatchOutput<T> | null`. **Never throws** — invalid input (called before build, path exceeds `maxPathLength`, segment exceeds `maxSegmentLength`, no matching route) returns `null`.

```typescript
const result = router.match('GET', '/users/42');

if (result) {
  result.value;       // T — the registered value
  result.params;      // Record<string, string | undefined> (null-prototype)
  result.meta.source; // 'static' | 'cache' | 'dynamic'
}
```

`meta.source` indicates how the match was resolved:

| Value | When |
|:------|:-----|
| `'static'` | Path matched a literal route via O(1) `staticMap` lookup. The returned `MatchOutput` is shared and frozen — identical hits return the same object (`===` identity preserved). |
| `'cache'` | `enableCache: true` and the path was previously resolved as `'dynamic'`. The cache stores a snapshot; mutating the returned `params` does not affect future hits. |
| `'dynamic'` | Path matched via a per-method tree walker (codegen specialist / codegen general / iterative / recursive). Each call returns a fresh `MatchOutput` with its own `params` object. |

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

Cold-path: only invoke after `match()` returns `null`. Iterates the active method set and runs each method's tree walker, sharing a single `params` container.

<br>

## 🛤️ Route Patterns

### Static routes

```typescript
router.add('GET', '/users', handler);
router.add('GET', '/api/v1/health', handler);
```

### Named parameters

Capture a single path segment. Param values are percent-decoded by default (`decodeParams: true`).

```typescript
router.add('GET', '/users/:id', handler);
// /users/42        → { id: '42' }
// /users/hello%20w → { id: 'hello w' }
```

### Regex parameters

Constrain params with inline regex. Patterns are validated for ReDoS safety at registration time.

```typescript
router.add('GET', '/users/:id(\\d+)', handler);
// /users/42   → { id: '42' }
// /users/abc  → no match
```

### Optional parameters

A trailing `?` makes a param optional. Both with-param and without-param URLs match. The shape of `params` for the missing case is controlled by `optionalParamBehavior`:

```typescript
router.add('GET', '/:lang?/docs', handler);
```

| `optionalParamBehavior` | `/en/docs` | `/docs` |
|:------------------------|:-----------|:--------|
| `'omit'` (default) | `{ lang: 'en' }` | `{}` (key absent) |
| `'setUndefined'` | `{ lang: 'en' }` | `{ lang: undefined }` (key present) |
| `'setEmptyString'` | `{ lang: 'en' }` | `{ lang: '' }` |

### Wildcards

Capture the rest of the URL, including slashes. Wildcard values are **not** percent-decoded. Two semantics, two preferred spellings:

| Pattern | Semantics | Empty match |
|:--------|:----------|:------------|
| `*name` | Star — match zero or more characters | `'/files'` against `/files/*path` → `{ path: '' }` |
| `:name+` | Multi — match one or more characters | `'/assets'` against `/assets/:file+` → no match |

```typescript
router.add('GET', '/files/*path', handler);
// /files/a/b/c.txt → { path: 'a/b/c.txt' }
// /files            → { path: '' }

router.add('GET', '/assets/:file+', handler);
// /assets/style.css → { file: 'style.css' }
// /assets           → no match
```

The aliases `:name*` (≡ `*name`) and `*name+` (≡ `:name+`) are also accepted by the parser but the spellings above are preferred.

<br>

## ⚙️ Options

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

| Option | Default | Description |
|:-------|:--------|:------------|
| `ignoreTrailingSlash` | `true` | `/users/` and `/users` match the same route |
| `caseSensitive` | `true` | `/Users` and `/users` are different routes |
| `decodeParams` | `true` | Percent-decode named param values (wildcards stay raw) |
| `enableCache` | `false` | Cache `'dynamic'` matches; subsequent hits return `'cache'` source |
| `cacheSize` | `1000` | Per-method bound for both hit cache (LRU) and miss set (FIFO eviction) |
| `maxPathLength` | `2048` | Paths exceeding this length make `match()` return `null` |
| `maxSegmentLength` | `256` | Paths with any segment exceeding this length make `match()` return `null` |
| `optionalParamBehavior` | `'omit'` | Shape of `params` when an optional param is missing — see the table above |
| `regexAnchorPolicy` | `'silent'` | Behavior when a regex param contains `^` or `$` (the anchors are stripped either way): `'silent'` strips silently, `'warn'` calls `onWarn`, `'error'` throws `regex-anchor` |

### Cache trade-off

`enableCache: true` adds a per-method `(path → MatchOutput)` LRU plus a miss set for negative caching. Both are bounded by `cacheSize`, so memory cannot grow unbounded. Use it when the live path set is small relative to the route count and dynamic matches dominate the hot path; skip it when matches are already <40 ns or paths are highly variable. Cached routes can never go stale: `build()` seals the route table and rejects further registrations.

### Regex Safety

```typescript
interface RegexSafetyOptions {
  mode?: 'error' | 'warn';                   // Default: 'error'
  maxLength?: number;                         // Default: 256
  forbidBacktrackingTokens?: boolean;         // Default: true
  forbidBackreferences?: boolean;             // Default: true
  maxExecutionMs?: number;                    // Optional per-tester timeout
  validator?: (pattern: string) => void;      // Custom validator
}
```

By default, regex patterns are validated at registration time to prevent ReDoS. Patterns with backtracking-prone tokens (`.*`, `.+`, `(a+)+`) or backreferences are rejected. Set `mode: 'warn'` to log via `onWarn` instead of throwing.

<br>

## 🚨 Error Handling

`add()`, `addAll()`, and `build()` throw `RouterError` with a structured `data` object. `match()` and `allowedMethods()` never throw — they return `null` / `[]` on failure.

```typescript
import { Router, RouterError } from '@zipbul/router';

try {
  router.add('GET', '/bad/(unmatched', handler);
} catch (e) {
  if (e instanceof RouterError) {
    e.data.kind;       // RouterErrKind — discriminant
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
| `'route-parse'` | Invalid path syntax (no leading slash, unclosed regex group, illegal char in param name, etc.) |
| `'param-duplicate'` | Same param name appears twice in one path (`/x/:id/y/:id`) |
| `'regex-unsafe'` | Regex param failed the safety check (length / backtracking tokens / backreferences) |
| `'regex-anchor'` | Regex param contains `^` or `$` (when `regexAnchorPolicy: 'error'`) |
| `'method-limit'` | More than 32 distinct HTTP methods registered |
| `'segment-limit'` | Segment length exceeds `maxSegmentLength`, segment count exceeds 64, or parameter count exceeds 32 per path |

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

    // match() never throws — null means no route matched.
    const result = router.match(method, url.pathname);
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

Benchmarked on Bun 1.3.13, Intel i7-13700K @ 5.45 GHz. Numbers are p75 from `bench/comparison.bench.ts`. Lower is better; **bold** marks the fastest router for that scenario.

| Scenario | @zipbul/router | memoirist | find-my-way | rou3 | hono RegExp | koa-tree |
|:---------|:---------------|:----------|:------------|:-----|:------------|:---------|
| static (100 routes) | **207 ps** | 34.35 ns | 98.33 ns | 87 ps | 35.00 ns | 42.66 ns |
| 1 param | **29.69 ns** | 34.74 ns | 72.19 ns | 41.33 ns | 115.00 ns | 97.84 ns |
| 3 params | **53.55 ns** | 64.90 ns | 134.61 ns | 64.95 ns | 84.52 ns | 243.99 ns |
| wildcard | 27.09 ns | **23.45 ns** | 59.95 ns | 75.91 ns | 89.00 ns | 115.97 ns |
| miss | 15.11 ns | **14.22 ns** | 48.79 ns | 44.73 ns | 20.06 ns | 25.15 ns |

`rou3`'s static lookup edges ahead by ~120 ps because it skips the path-normalization pass; the dynamic-route gap (param / wildcard) widens once parsing is involved. The wildcard / miss leads of `memoirist` are within ~1 ns and reflect its leaner safety surface — `@zipbul/router` keeps `regexSafety`, `maxPathLength`, `maxSegmentLength`, and structured-error handling on the hot path.

<br>

## 📄 License

MIT
