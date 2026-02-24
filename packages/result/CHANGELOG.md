# @zipbul/result

## 0.1.2

### Patch Changes

- afb893b: fix(release): use bun publish to correctly resolve workspace:\* protocol

  Previously `npx changeset publish` (npm publish) shipped `"workspace:*"` to npm
  as-is, making the package uninstallable for consumers. Switched to `bun publish`
  which natively resolves `workspace:*` to real version numbers at publish time.

## 0.1.1

### Patch Changes

- fec6633: refactor(shared): move HttpMethod type from enums/ to types/

  `HttpMethod` is a string literal union type, not an enum. Moved to `src/types/` to correctly reflect its nature. Public API is unchanged — still accessible via the main entry point.

  build: enable minification with --production flag across all packages

## 0.1.0

### Minor Changes

- 08bfee5: Add `safe()` function and `ResultAsync` type

  - `safe(fn)` / `safe(fn, mapErr)`: wraps sync functions, catches throws into `Err`
  - `safe(promise)` / `safe(promise, mapErr)`: wraps Promises, catches rejections into `Err`
  - `ResultAsync<T, E>`: type alias for `Promise<Result<T, E>>`

## 0.0.3

### Patch Changes

- 19bd0bc: fix: resolve release pipeline (private WIP packages, Node 24 OIDC)

## 0.0.2

### Patch Changes

- f2eb2de: fix: republish with resolved workspace dependencies
