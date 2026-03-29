# @zipbul/multipart

## 0.1.1

### Patch Changes

- 5744dc2: Remove `stack` property from `Err` type. Result pattern represents expected failures where stack traces are unnecessary — error data alone should describe the cause and origin. This aligns with how Rust's `Result` and Go's `error` handle expected failures.

  BREAKING CHANGE: `Err` no longer has a `stack` property. Access `err().stack` will be `undefined`.

- Updated dependencies [5744dc2]
  - @zipbul/result@1.0.0

## 0.1.0

### Minor Changes

- 7ca7752: Add streaming multipart/form-data parser with dual parsing modes, filename sanitization, and per-field MIME type validation.
