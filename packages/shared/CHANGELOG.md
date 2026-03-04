# @zipbul/shared

## 0.0.10

### Patch Changes

- b6c0f72: docs: remove redundant Exports sections from READMEs

## 0.0.9

### Patch Changes

- 665e37c: chore: quality audit across all public packages

  - Add `sideEffects: false` and `publishConfig.provenance` to all packages
  - Add `.npmignore` to all packages
  - Expand npm keywords for better discoverability
  - Use explicit named exports in barrel files (shared, cors)
  - Improve README descriptions, add Exports sections, fix inaccuracies
  - Add root `.editorconfig`
  - Add router to CI/CD pipeline

## 0.0.8

### Patch Changes

- 7e67e78: ### Breaking Changes

  - `Cors.create()` now returns `Cors` directly and throws `CorsError` on invalid options (previously returned `Result<Cors, CorsError>`)
  - `Cors.handle()` now returns `Promise<CorsResult>` and throws `CorsError` on origin function failure (previously returned `Promise<Result<CorsResult, CorsError>>`)
  - `CorsError` is now a class extending `Error` (previously an interface)
  - New `CorsErrorData` interface replaces the old `CorsError` interface shape (internal use)

  ### @zipbul/shared

  - `HttpHeader` and `HttpStatus` changed from `const enum` to `enum` to fix `verbatimModuleSyntax` compatibility

  ### Why minor (not major)

  Per 0.x semver convention, breaking changes in pre-1.0 packages use minor bumps.

  ### Migration

  ```typescript
  // Before
  import { isErr } from "@zipbul/result";
  const result = Cors.create({ origin: "https://example.com" });
  if (isErr(result)) {
    /* handle error */
  }
  const cors = result;

  // After
  import { CorsError } from "@zipbul/cors";
  try {
    const cors = Cors.create({ origin: "https://example.com" });
  } catch (e) {
    if (e instanceof CorsError) {
      /* handle error */
    }
  }
  ```

## 0.0.7

### Patch Changes

- 55cf7d7: Include LICENSE file in published packages

## 0.0.6

### Patch Changes

- f3f036f: fix(release): resolve workspace:\* protocol and restore GitHub release creation

## 0.0.5

### Patch Changes

- afb893b: fix(release): use bun publish to correctly resolve workspace:\* protocol

  Previously `npx changeset publish` (npm publish) shipped `"workspace:*"` to npm
  as-is, making the package uninstallable for consumers. Switched to `bun publish`
  which natively resolves `workspace:*` to real version numbers at publish time.

## 0.0.4

### Patch Changes

- fec6633: refactor(shared): move HttpMethod type from enums/ to types/

  `HttpMethod` is a string literal union type, not an enum. Moved to `src/types/` to correctly reflect its nature. Public API is unchanged — still accessible via the main entry point.

  build: enable minification with --production flag across all packages

## 0.0.3

### Patch Changes

- 19bd0bc: fix: resolve release pipeline (private WIP packages, Node 24 OIDC)

## 0.0.2

### Patch Changes

- f2eb2de: fix: republish with resolved workspace dependencies
