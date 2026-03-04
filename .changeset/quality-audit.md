---
"@zipbul/shared": patch
"@zipbul/result": patch
"@zipbul/cors": patch
"@zipbul/query-parser": patch
"@zipbul/rate-limiter": patch
"@zipbul/router": patch
---

chore: quality audit across all public packages

- Add `sideEffects: false` and `publishConfig.provenance` to all packages
- Add `.npmignore` to all packages
- Expand npm keywords for better discoverability
- Use explicit named exports in barrel files (shared, cors)
- Improve README descriptions, add Exports sections, fix inaccuracies
- Add root `.editorconfig`
- Add router to CI/CD pipeline
