---
"@zipbul/router": major
---

BREAKING: collapse two 2-state public enums into booleans on `RouterOptions`.

The `TrailingSlash` and `OptionalParamBehavior` enums each had only two
members. They were boolean choices dressed up as enums — the internal
pipeline already converted both to booleans before consuming them
(`router.ts:95`, `build.ts:106`). Replacing the enums with booleans
removes ceremony from every call site without changing runtime behavior.

### Migration

```ts
// Before
import { Router, TrailingSlash, OptionalParamBehavior } from '@zipbul/router';
new Router({
  trailingSlash: TrailingSlash.Strict,
  optionalParamBehavior: OptionalParamBehavior.SetUndefined,
});

// After
import { Router } from '@zipbul/router';
new Router({
  ignoreTrailingSlash: false,
  omitMissingOptional: false,
});
```

| Old                                                          | New                            |
| :----------------------------------------------------------- | :----------------------------- |
| `{ trailingSlash: TrailingSlash.Strict }`                    | `{ ignoreTrailingSlash: false }` |
| `{ trailingSlash: TrailingSlash.Ignore }` (default)          | `{ ignoreTrailingSlash: true }` (or omit) |
| `{ optionalParamBehavior: OptionalParamBehavior.Omit }` (default) | `{ omitMissingOptional: true }` (or omit) |
| `{ optionalParamBehavior: OptionalParamBehavior.SetUndefined }` | `{ omitMissingOptional: false }` |

Defaults are unchanged: trailing slash is ignored by default; missing
optional parameters are omitted from `params` by default.

### Public export surface

The two enum names are removed from the public exports. Remaining
exports: `Router`, `RouterError`, `MatchSource`, `RouterErrorKind`.
`MatchSource` (3 members) and `RouterErrorKind` (21 members) remain
enums — both have enough cardinality that the enum form carries
meaningful information.
