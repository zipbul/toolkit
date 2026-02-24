---
"@zipbul/result": minor
---

Add `safe()` function and `ResultAsync` type

- `safe(fn)` / `safe(fn, mapErr)`: wraps sync functions, catches throws into `Err`
- `safe(promise)` / `safe(promise, mapErr)`: wraps Promises, catches rejections into `Err`
- `ResultAsync<T, E>`: type alias for `Promise<Result<T, E>>`
