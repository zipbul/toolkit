# @zipbul/result

## 0.1.7

### Patch Changes

- 2ebbfa4: chore: remove sourcemap generation from build scripts

## 0.1.6

### Patch Changes

- b6c0f72: docs: remove redundant Exports sections from READMEs

## 0.1.5

### Patch Changes

- 665e37c: chore: quality audit across all public packages

  - Add `sideEffects: false` and `publishConfig.provenance` to all packages
  - Add `.npmignore` to all packages
  - Expand npm keywords for better discoverability
  - Use explicit named exports in barrel files (shared, cors)
  - Improve README descriptions, add Exports sections, fix inaccuracies
  - Add root `.editorconfig`
  - Add router to CI/CD pipeline

## 0.1.4

### Patch Changes

- 55cf7d7: Include LICENSE file in published packages

## 0.1.3

### Patch Changes

- f3f036f: fix(release): resolve workspace:\* protocol and restore GitHub release creation

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
