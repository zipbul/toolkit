# @zipbul/shared

**English** | [한국어](./README.ko.md)

[![npm](https://img.shields.io/npm/v/@zipbul/shared)](https://www.npmjs.com/package/@zipbul/shared)

A type-safe HTTP enum and constant library for the `@zipbul` toolkit.
Provides `const enum` declarations for HTTP methods, headers, and status codes — used across multiple `@zipbul` packages.

> Zero runtime footprint with `const enum` inlining.

<br>

## 📦 Installation

```bash
bun add @zipbul/shared
```

<br>

## 📚 What's Inside

### HTTP Enums

Type-safe `const enum` declarations that eliminate magic strings for HTTP methods, headers, and status codes.

```typescript
import { HttpMethod, HttpHeader, HttpStatus } from '@zipbul/shared';

if (request.method === HttpMethod.Get) {
  headers.set(HttpHeader.AccessControlAllowOrigin, '*');
  return new Response('OK', { status: HttpStatus.Ok });
}
```

| Export       | Description                          |
|:-------------|:-------------------------------------|
| `HttpMethod` | Standard HTTP methods (`Get`, `Post`, `Put`, `Patch`, `Delete`, …) |
| `HttpHeader` | CORS-related HTTP headers (Fetch Standard, lowercase values) |
| `HttpStatus` | Common HTTP status codes (`Ok`, `NoContent`, …) |

> Enums are `const enum` — with `isolatedModules: false`, values are **inlined at compile time** with zero runtime footprint. See [About `const enum`](#-about-const-enum) for toolchain-specific behavior.

<br>

## 🔬 About `const enum`

All enums are declared as `const enum`, which has different behavior depending on your toolchain:

| Environment | Behavior |
|:------------|:---------|
| TypeScript (`isolatedModules: false`) | Values are **inlined** at compile time — no runtime object |
| Bundlers (Bun, esbuild, Vite) | Treated as **regular enums** — runtime object is emitted |
| `isolatedModules: true` / `verbatimModuleSyntax: true` | Import is preserved; the bundler resolves it at build time |

This means:
- **Bun consumers** can use the enums normally — `bun build` handles the resolution
- **TypeScript library consumers** get the benefit of compile-time inlining (zero runtime cost)
- The `.d.ts` files preserve the `const enum` declarations for downstream consumers

> **Note:** When building with `verbatimModuleSyntax: true` and `emitDeclarationOnly`, you may need to set `verbatimModuleSyntax: false` in `tsconfig.build.json` to avoid TS2748. This is already handled in the build configuration.

<br>

## 📄 License

MIT
