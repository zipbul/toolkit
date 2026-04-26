---
"@zipbul/cookie": major
---

First release of `@zipbul/cookie`. RFC 6265 / RFC 6265bis-22 compliant cookie parser, serializer, signer, and AEAD encryptor for Bun. Aggregates four unreleased commits (`d941150` → `9c4835c`) plus the conformance/hardening pass below.

## Initial feature set (commits d941150, b8fb79a, 8d2053e)

- HMAC signing with `sha256` / `sha384` / `sha512`; rotation via `secrets: string[]`.
- AES-256-GCM encryption via Web Crypto; rotation via `encryptionSecret: string | string[]`.
- Cookie prefix validation: `__Secure-`, `__Host-`.
- Server-level cookie defaults (`httpOnly`, `secure`, `sameSite`, `path`, `domain`, `maxAge`, `expires`, `partitioned`) with per-cookie overrides via `createCookie()`.
- `secure: 'auto'` resolution against per-request `SerializeContext.isSecure`.
- `SameSite=None` requires `Secure` (RFC 6265bis §5.7).
- Partitioned (CHIPS) requires `Secure`; domain/path header-injection defense (`;`, `\r`, `\n`).
- 400-day Max-Age cap (RFC 6265bis §5.5).
- Cookie-name RFC 9110 token validation (`%` excluded for Bun.CookieMap interop).
- 4096-byte serialized cookie cap.
- `CookieJar`: request-scoped container with `get()` (Result-typed), `set()`, `delete()`, `has()`, `getRaw()`, `getSetCookieHeaders()`. Auto sign + encrypt on outbound, auto decrypt + unsign on inbound.
- Removed legacy `parse()` / `parseOne()` (replaced by `CookieJar` + Bun.CookieMap).
- Zero `node:crypto` dependency.

## Cross-name replay defense + integer/integrity hardening (commit 9c4835c)

- HMAC signs `cookie.name + 0x00 + cookie.value` — closes cross-name signature replay.
- AES-GCM uses `cookie.name` as AAD (NIST SP 800-38D §5.2.1) — closes cross-name ciphertext replay.
- Signing/encryption secrets enforced ≥ 32 characters (NIST SP 800-132).
- `secrets` array supports rotation: encrypt/sign uses first key, verify/decrypt iterates all (constant-time, no early-exit — position-based timing oracle measured 4.76× → 1.03×).
- `Max-Age` must be a finite integer (RFC 6265 §5.2.2): rejects `NaN`, `Infinity`, decimals at both `createCookie()` and `serialize()`.
- `CookieJar` error step distinguishes `unsign` failure (`SignatureVerificationFailed`) from `decrypt` failure (`DecryptionFailed`).

## RFC / browser conformance — defects fixed (15)

- `secure: 'auto'` no longer overrides explicit `secure` values in either direction (caller intent preserved via internal metadata map).
- `serialize()` now applies configured `httpOnly` / `path` / `sameSite` / `partitioned` defaults via `createCookie()`.
- `Expires` attribute capped at 400 days (RFC 6265bis §5.5), not just `Max-Age`.
- `__Host-` prefix validation rejects empty-string `Domain` (defense-in-depth).
- `createCookie` strips `null` attribute values (previously passed through).
- `Domain` validated against RFC 1034/1123 LDH (rejects `a..b.com`, `-bad.com`, etc.).
- Cookie size limit corrected: name+value ≤ 4096 octets (RFC 6265bis §5.6) — header total no longer rejected as a side-effect.
- Per-attribute 1024-octet cap added (RFC 6265bis §5.6).
- Prefix detection is now case-insensitive (`__host-`, `__SECURE-` are detected and validated).
- Default public-suffix check (single-label domains rejected) plus `publicSuffixCheck` hook for full PSL integration.
- `createCookie` performs eager validation (Max-Age, Expires, Domain, Path, size) — no longer deferred to `serialize()`.
- Secret entropy verified (≥ 8 distinct characters); error message now matches what the code enforces.
- `prefixValidation` default flipped to `true`.
- `wrapBunError` falls back to a dedicated `CookieParserError` reason instead of misclassifying as `InvalidCookieName`.
- `CookieJar.delete()` overrides `sameSite=none` / `secure='auto'` defaults locally so deletion always serializes regardless of request context.

## Cryptographic hardening (8)

- Keys derived via HKDF-SHA256/384/512 (RFC 5869, NIST SP 800-108) with package-specific salt and info parameters.
- 4-byte KID prefix embedded in HMAC signatures and AES-GCM ciphertexts; verification is strict KID match (no fallback).
- `onEncrypt({ keyIndex, counter })` hook for AES-GCM IV usage tracking (NIST SP 800-38D §8.3).
- `__Http-` / `__Host-Http-` prefix support (HttpOnly enforcement).
- `Priority=Low|Medium|High` attribute support.
- `CookieJar.getSetCookieHeaders()` parallelizes sign/encrypt across cookies (`Promise.all`).
- Per-instance HKDF-derived key cache.
- `test/{conformance,security,fuzz}/` suites tracked in source control.

## Public API

- `CookieParser.create(options?)` — entry point; returns parser with `createCookie`, `serialize`, `sign`, `unsign`, `encrypt`, `decrypt`, `validatePrefix`, `isSigningConfigured`, `isEncryptionConfigured`.
- `CookieJar` — request-scoped container.
- `CookieError` (with `reason: CookieErrorReason`).
- Types: `CookieParserOptions`, `CookieAttributes`, `SerializeContext`, `CookiePriority`, `SigningAlgorithm`, `CookieErrorReason`.

## Standards alignment

- RFC 6265 / RFC 6265bis-22 server-side normatives
- RFC 1034 / RFC 1123 (Domain LDH)
- RFC 6265bis §4.1.3.1/2, §5.7 (`__Secure-` / `__Host-` / `__Http-`)
- RFC 6265bis §5.5 (400-day cap on Expires and Max-Age)
- RFC 6265bis §5.6 (4096 / 1024 octet caps)
- CHIPS (Partitioned + Secure)
- NIST SP 800-38D (AES-256-GCM: 12-byte IV, 128-bit tag, AAD bound to cookie name)
- RFC 5869 / NIST SP 800-108 (HKDF)
- FIPS 198-1 (HMAC + constant-time verify)
- RFC 9110 §5.6.2 (cookie-name token grammar)

## Notes on `CookieErrorReason`

Reason codes are kebab-case strings (`'invalid-cookie-name'`, `'host-prefix-forbids-domain'`, etc.). Consumers matching by string value should use the `CookieErrorReason` enum.

## Test coverage

- 330 tests / 510 assertions / 99.49% line coverage / 99.62% function coverage
- Conformance: RFC 6265bis §§4.1.1, 4.1.2.1, 4.1.2.2, 4.1.2.7, 4.1.3.1, 4.1.3.2, 5.5, 5.6, 5.7; CHIPS; NIST SP 800-38D; FIPS 198-1; RFC 9110 §5.6.2
- Security: header injection, cross-name signature/ciphertext replay, algorithm confusion, ciphertext truncation/tampering, signature malformation, prototype pollution, weak secrets, oversized payloads, control characters in name, percent in name, error-type leakage
- Fuzz: 200-run fast-check property tests for sign/encrypt roundtrip, IV randomness, name-binding, AAD-binding, tampering rejection, name validation, jar roundtrip, 4096-octet boundary, key rotation invariants
