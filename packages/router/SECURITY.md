# Security policy — `@zipbul/router`

## Supported versions

| Version            | Security fixes                          |
| ------------------ | --------------------------------------- |
| Latest `0.x` minor | Yes                                     |
| Older `0.x` minor  | Upgrade to the latest `0.x` minor first |

Pre-1.0 packages carry no security backport guarantee.

## Reporting a vulnerability

**Do not open a public GitHub issue for security reports.**

Email **revil.com@gmail.com** with subject prefix `[zipbul/router security]`. Include:

- Installed version (`npm ls @zipbul/router`)
- Reproduction steps (smallest possible test case — ideally a failing `bun test` file)
- Observed impact (DoS, information disclosure, etc.)
- Your disclosure timeline preference (if any)

Acknowledgement within 5 business days. If no response, mention privately to a maintainer.

## Disclosure timeline

- **Day 0** — report received, ack within 5 business days.
- **Day 0-14** — triage + reproduction. Severity (low / medium / high / critical) assigned.
- **Day 14-30** — patch for critical / high. Medium / low may take longer.
- **Day +0** — coordinated disclosure. Patch released and CVE requested if applicable.

## Out-of-scope (framework / user responsibility, not the router)

The router intentionally delegates the following surfaces:

- **Runtime URL validation** — `match(method, path)` treats inputs as already-validated origin-form pathnames (RFC 7230 §5.3.1). Malformed percent-encoding propagates as `URIError` from `decodeURIComponent`. Validate at the HTTP server boundary (`Bun.serve` / `Node http` / `Express` / `Fastify` / `Hono`).
- **Regex ReDoS** — `:id(pattern)` accepts any syntactically valid regex. Patterns like `(?:a+)+` register and run on V8/JavaScriptCore's backtracking engine as-is. If you accept untrusted regex sources, layer a normalizer plug-in (`re2`, `recheck`) ahead of the router.
- **Runtime method-token validation** — `match()` accepts any method string. Filter invalid HTTP methods at the framework layer.
- **Rate limiting / DoS** — the router has no built-in rate limit. Deeply nested paths consume memory proportional to path length. Apply rate-limit middleware upstream.

Reports targeting these surfaces will be redirected.

## Hall of fame

Reporters who follow this policy are credited in the release notes for the corresponding fix, unless they request anonymity.

---

See also [`../../SECURITY.md`](../../SECURITY.md) for the monorepo-wide security entry point.
