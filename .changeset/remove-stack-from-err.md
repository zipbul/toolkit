---
"@zipbul/result": major
"@zipbul/cors": patch
"@zipbul/multipart": patch
"@zipbul/query-parser": patch
"@zipbul/rate-limiter": patch
"@zipbul/router": patch
---

Remove `stack` property from `Err` type. Result pattern represents expected failures where stack traces are unnecessary — error data alone should describe the cause and origin. This aligns with how Rust's `Result` and Go's `error` handle expected failures.

BREAKING CHANGE: `Err` no longer has a `stack` property. Access `err().stack` will be `undefined`.
