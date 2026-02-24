---
"@zipbul/shared": patch
"@zipbul/cors": patch
"@zipbul/result": patch
---

fix(release): use bun publish to correctly resolve workspace:\* protocol

Previously `npx changeset publish` (npm publish) shipped `"workspace:*"` to npm
as-is, making the package uninstallable for consumers. Switched to `bun publish`
which natively resolves `workspace:*` to real version numbers at publish time.
