# @zipbul/router

## 0.2.3

### Patch Changes

- 5744dc2: Remove `stack` property from `Err` type. Result pattern represents expected failures where stack traces are unnecessary — error data alone should describe the cause and origin. This aligns with how Rust's `Result` and Go's `error` handle expected failures.

  BREAKING CHANGE: `Err` no longer has a `stack` property. Access `err().stack` will be `undefined`.

- Updated dependencies [5744dc2]
  - @zipbul/result@1.0.0

## 0.2.2

### Patch Changes

- 2ebbfa4: chore: remove sourcemap generation from build scripts
- Updated dependencies [2ebbfa4]
  - @zipbul/shared@0.0.11
  - @zipbul/result@0.1.7

## 0.2.1

### Patch Changes

- b6c0f72: docs: remove redundant Exports sections from READMEs
- Updated dependencies [b6c0f72]
  - @zipbul/shared@0.0.10
  - @zipbul/result@0.1.6

## 0.2.0

### Minor Changes

- cf5f313: Rewrite router internals from segment-based binary trie to character-level radix trie.

  - Character-level LCP-split radix nodes with per-method tree isolation
  - Iterative radix walker with monomorphic property access (no closure tree)
  - Inline path normalization (preNormalize + needsDeepNorm fast path)
  - PathParser replaces Processor pipeline for add-time normalization
  - MatchState pre-allocated with reuse across match() calls
  - Public API: value-or-throw with RouterError class (internal: Result<T,E>)
  - Cache: bitwise AND masking, hit/miss separation, freeze removal
  - Static routes: O(1) Map lookup
  - Tiered child dispatch and label comparison specialization at build time

### Patch Changes

- 665e37c: chore: quality audit across all public packages

  - Add `sideEffects: false` and `publishConfig.provenance` to all packages
  - Add `.npmignore` to all packages
  - Expand npm keywords for better discoverability
  - Use explicit named exports in barrel files (shared, cors)
  - Improve README descriptions, add Exports sections, fix inaccuracies
  - Add root `.editorconfig`
  - Add router to CI/CD pipeline

- Updated dependencies [665e37c]
  - @zipbul/shared@0.0.9
  - @zipbul/result@0.1.5
