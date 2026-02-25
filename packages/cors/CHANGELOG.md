# @zipbul/cors

## 0.0.8

### Patch Changes

- 55cf7d7: Include LICENSE file in published packages
- Updated dependencies [55cf7d7]
  - @zipbul/result@0.1.4
  - @zipbul/shared@0.0.7

## 0.0.7

### Patch Changes

- f3f036f: fix(release): resolve workspace:\* protocol and restore GitHub release creation
- Updated dependencies [f3f036f]
  - @zipbul/result@0.1.3
  - @zipbul/shared@0.0.6

## 0.0.6

### Patch Changes

- afb893b: fix(release): use bun publish to correctly resolve workspace:\* protocol

  Previously `npx changeset publish` (npm publish) shipped `"workspace:*"` to npm
  as-is, making the package uninstallable for consumers. Switched to `bun publish`
  which natively resolves `workspace:*` to real version numbers at publish time.

- Updated dependencies [afb893b]
  - @zipbul/shared@0.0.5
  - @zipbul/result@0.1.2

## 0.0.5

### Patch Changes

- fec6633: refactor(shared): move HttpMethod type from enums/ to types/

  `HttpMethod` is a string literal union type, not an enum. Moved to `src/types/` to correctly reflect its nature. Public API is unchanged — still accessible via the main entry point.

  build: enable minification with --production flag across all packages

- Updated dependencies [fec6633]
  - @zipbul/shared@0.0.4
  - @zipbul/result@0.1.1

## 0.0.4

### Patch Changes

- Updated dependencies [08bfee5]
  - @zipbul/result@0.1.0

## 0.0.3

### Patch Changes

- 19bd0bc: fix: resolve release pipeline (private WIP packages, Node 24 OIDC)
- Updated dependencies [19bd0bc]
  - @zipbul/shared@0.0.3
  - @zipbul/result@0.0.3

## 0.0.2

### Patch Changes

- f2eb2de: fix: republish with resolved workspace dependencies
- Updated dependencies [f2eb2de]
  - @zipbul/shared@0.0.2
  - @zipbul/result@0.0.2
