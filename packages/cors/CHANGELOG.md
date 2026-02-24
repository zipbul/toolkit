# @zipbul/cors

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
