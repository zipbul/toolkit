# @zipbul/router

**English** | [한국어](./README.ko.md)

[![npm](https://img.shields.io/npm/v/@zipbul/router)](https://www.npmjs.com/package/@zipbul/router)
![coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/parkrevil/3965fb9d1fe2d6fc5c321cb38d88c823/raw/router-coverage.json)

A high-performance radix-tree URL router for Bun.
Character-level trie with per-method tree isolation, regex param patterns, and structured error handling.

> Static routes resolve via O(1) Map lookup. Dynamic routes traverse an iterative radix walker with monomorphic property access.

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
  console.log(result.value);      // 'get-user'
  console.log(result.params.id);  // '42'
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

### `router.add(method, path, value)`

Registers a route. Throws `RouterError` on invalid path, duplicate route, or if called after `build()`.

```typescript
router.add('GET', '/users/:id', handler);
router.add(['GET', 'POST'], '/data', handler);  // multiple methods
router.add('*', '/health', handler);             // all methods
```

### `router.addAll(entries)`

Registers multiple routes at once. Throws `RouterError` on first failure, with `registeredCount` indicating how many succeeded.

```typescript
router.addAll([
  ['GET', '/users', listUsers],
  ['POST', '/users', createUser],
  ['GET', '/users/:id', getUser],
]);
```

### `router.build()`

Compiles the radix trie. Must be called before `match()`. Returns `this` for chaining.

```typescript
router.build();

// or chained
const router = new Router<string>()
  .add('GET', '/users', 'list')
  .build(); // ❌ add() returns void

// correct chaining
const r = new Router<string>();
r.add('GET', '/users', 'list');
r.build();
```

### `router.match(method, path)`

Matches a URL against registered routes. Returns `MatchOutput<T> | null`.
Throws `RouterError` on invalid input (not-built, path-too-long, etc.).

```typescript
const result = router.match('GET', '/users/42');

if (result) {
  result.value;       // T — the registered value
  result.params;      // Record<string, string | undefined>
  result.meta.source; // 'static' | 'cache' | 'dynamic'
}
```

### `router.clearCache()`

Clears all cached match results. Only relevant when `enableCache: true`.

<br>

## 🛤️ Route Patterns

### Static routes

```typescript
router.add('GET', '/users', handler);
router.add('GET', '/api/v1/health', handler);
```

### Named parameters

Capture a single path segment. Params are percent-decoded by default.

```typescript
router.add('GET', '/users/:id', handler);
// /users/42        → { id: '42' }
// /users/hello%20w → { id: 'hello w' }
```

### Regex parameters

Constrain params with inline regex patterns. Patterns are validated for ReDoS safety at registration time.

```typescript
router.add('GET', '/users/:id(\\d+)', handler);
// /users/42   → match, { id: '42' }
// /users/abc  → no match
```

### Optional parameters

A trailing `?` makes a param optional. Both with-param and without-param paths match.

```typescript
router.add('GET', '/:lang?/docs', handler);
// /en/docs  → { lang: 'en' }
// /docs     → { lang: undefined } (or omitted, per optionalParamBehavior)
```

### Wildcard (`*`)

Captures the rest of the URL (including slashes). Not percent-decoded.

```typescript
router.add('GET', '/files/*path', handler);
// /files/a/b/c.txt → { path: 'a/b/c.txt' }
// /files            → { path: '' }
```

### Multi-segment wildcard (`+`)

Like `*` but requires at least one character.

```typescript
router.add('GET', '/assets/+file', handler);
// /assets/style.css → { file: 'style.css' }
// /assets           → no match
```

<br>

## ⚙️ Options

```typescript
interface RouterOptions {
  ignoreTrailingSlash?: boolean;     // Default: true
  caseSensitive?: boolean;           // Default: true
  decodeParams?: boolean;            // Default: true
  enableCache?: boolean;             // Default: false
  cacheSize?: number;                // Default: 1000
  maxPathLength?: number;            // Default: 2048
  maxSegmentLength?: number;         // Default: 256
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
| `decodeParams` | `true` | Percent-decode param values (`%20` → space) |
| `enableCache` | `false` | Cache dynamic match results |
| `cacheSize` | `1000` | Max entries per method in the hit cache |
| `maxPathLength` | `2048` | Reject paths exceeding this length |
| `maxSegmentLength` | `256` | Reject segments exceeding this length |
| `optionalParamBehavior` | `'omit'` | How to handle missing optional params |

### Regex Safety

```typescript
interface RegexSafetyOptions {
  mode?: 'error' | 'warn';                   // Default: 'error'
  maxLength?: number;                         // Default: 256
  forbidBacktrackingTokens?: boolean;         // Default: true
  forbidBackreferences?: boolean;             // Default: true
  maxExecutionMs?: number;                    // Optional timeout
  validator?: (pattern: string) => void;      // Custom validator
}
```

By default, regex patterns are validated at registration time to prevent ReDoS. Patterns with backtracking tokens (`.*`, `.+`, `(a+)+`) or backreferences are rejected.

<br>

## 🚨 Error Handling

All errors throw `RouterError` with a structured `data` object.

```typescript
import { Router, RouterError } from '@zipbul/router';

try {
  router.match('GET', '/some/path');
} catch (e) {
  if (e instanceof RouterError) {
    e.data.kind;       // RouterErrKind — discriminant
    e.data.message;    // Human-readable description
    e.data.path;       // The problematic path
    e.data.method;     // The HTTP method
    e.data.suggestion; // Fix suggestion (when available)
  }
}
```

### Error Kinds

| Kind | When |
|:-----|:-----|
| `'router-sealed'` | `add()` called after `build()` |
| `'not-built'` | `match()` called before `build()` |
| `'route-duplicate'` | Same method + path already registered |
| `'route-conflict'` | Structural conflict (wildcard/param/static) |
| `'route-parse'` | Invalid path syntax |
| `'param-duplicate'` | Duplicate param name in same path |
| `'regex-unsafe'` | Regex pattern failed safety check |
| `'regex-anchor'` | Pattern contains `^` or `$` (when policy = `'error'`) |
| `'method-limit'` | More than 32 distinct methods |
| `'segment-limit'` | Segment exceeds `maxSegmentLength` |
| `'regex-timeout'` | Pattern matching timed out |
| `'path-too-long'` | Path exceeds `maxPathLength` |
| `'method-not-found'` | No routes registered for this method |

<br>

## 🔌 Framework Integration

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

## ⚡ Performance

Benchmarked against 6 popular JS routers on Bun 1.3.9, Intel i7-13700K.

| Scenario | @zipbul/router | memoirist | find-my-way | rou3 | hono RegExp | koa-tree |
|:---------|:---------------|:----------|:------------|:-----|:------------|:---------|
| static | **30 ns** | 38 ns | 89 ns | <1 ns | 36 ns | 44 ns |
| 1 param | 66 ns | **36 ns** | 80 ns | 40 ns | 235 ns | 89 ns |
| 3 params | 151 ns | 66 ns | 142 ns | **64 ns** | 94 ns | 265 ns |
| wildcard | 71 ns | **26 ns** | 66 ns | 78 ns | 194 ns | 121 ns |
| miss | 45 ns | **18 ns** | 54 ns | 50 ns | 25 ns | 28 ns |

Static routes are faster than memoirist thanks to O(1) Map lookup. The dynamic route gap (~30 ns) is entirely from safety features (normalization, validation, structured errors) that bare-metal routers skip.

<br>

## 📄 License

MIT
