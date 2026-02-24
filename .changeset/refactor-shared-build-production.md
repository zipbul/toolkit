---
"@zipbul/shared": patch
"@zipbul/cors": patch
"@zipbul/result": patch
---

refactor(shared): move HttpMethod type from enums/ to types/

`HttpMethod` is a string literal union type, not an enum. Moved to `src/types/` to correctly reflect its nature. Public API is unchanged — still accessible via the main entry point.

build: enable minification with --production flag across all packages
