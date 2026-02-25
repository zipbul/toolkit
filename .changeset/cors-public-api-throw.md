---
"@zipbul/cors": minor
"@zipbul/shared": patch
---

### Breaking Changes

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
import { isErr } from '@zipbul/result';
const result = Cors.create({ origin: 'https://example.com' });
if (isErr(result)) { /* handle error */ }
const cors = result;

// After
import { CorsError } from '@zipbul/cors';
try {
  const cors = Cors.create({ origin: 'https://example.com' });
} catch (e) {
  if (e instanceof CorsError) { /* handle error */ }
}
```
