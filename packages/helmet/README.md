# @zipbul/helmet

> Standards-compliant HTTP response security headers engine for the Web Fetch APIs.
> Runs on Bun, Node 18+, Deno, Cloudflare Workers, Vercel Edge — anywhere `Request`/`Response`/`Headers` exist. **Zero runtime dependencies.**

CSP3 · HSTS preload · COOP / COEP / CORP · Origin-Agent-Cluster · Permissions-Policy (RFC 9651 Structured Fields) · Reporting-Endpoints + NEL · Integrity-Policy · Document-Policy · Clear-Site-Data · Cache-Control / Pragma / Expires · Referrer-Policy · X-Frame-Options · X-Content-Type-Options · X-DNS-Prefetch-Control · X-Permitted-Cross-Domain-Policies · X-Download-Options · X-XSS-Protection · X-Robots-Tag · Timing-Allow-Origin — under a single `Helmet.create({...})` factory.

`Set-Cookie` is intentionally **out of scope** — it is the responsibility of a cookie library (parsing, jar, encoding). Helmet only sets/strips response **security policy** headers.

## Install

```sh
bun add @zipbul/helmet
# or: npm i @zipbul/helmet
```

## 30-second tour

```ts
import { Helmet } from '@zipbul/helmet';

const helmet = Helmet.create();   // OWASP-aligned Default-ON

addEventListener('fetch', evt => {
  evt.respondWith(handle(evt.request).then(r => helmet.apply(r)));
});
```

A single `Helmet.create()` emits 11 headers including a CSP3 baseline, HSTS (2 years + includeSubDomains), `X-Frame-Options: deny`, `Cross-Origin-Opener-Policy: same-origin`, `Origin-Agent-Cluster: ?1` (RFC 9651 sf-boolean), and the OWASP Permissions-Policy lockdown.

## Per-request CSP nonces (cache-safe)

```ts
const helmet = Helmet.create({
  contentSecurityPolicy: { directives: { defaultSrc: ["'self'"] } },
});

addEventListener('fetch', evt => {
  const nonce = Helmet.generateNonce();          // 16-byte base64url branded Nonce
  evt.respondWith(render(nonce).then(r => helmet.apply(r, { nonce })));
});
```

CSP body is **pre-tokenized once** with a placeholder; each request only does a single `String.prototype.replaceAll` substitution (function-form, immune to `$`-meta cache poisoning). On a 2024 laptop: **~1M `headersRecord({ nonce })` ops/sec**.

## Reporting

```ts
const helmet = Helmet.create({
  reportingEndpoints: {
    endpoints: { default: 'https://r.example.com/csp' },   // HTTPS enforced
  },
  contentSecurityPolicyReportOnly: { directives: { defaultSrc: ["'self'"], reportTo: 'default' } },
  nel: { reportTo: 'default', maxAge: 86400 },              // legacy Report-To auto-emitted
});

// Endpoint shorthand:
Helmet.endpoints({ default: 'https://r.example.com/csp' });
```

## Validation contract

`Helmet.create()` validates the **entire** options tree and throws a single `HelmetError` with **every** violation aggregated:

```ts
try {
  Helmet.create({
    contentSecurityPolicy: { directives: { scriptSrc: ['self'] } },   // unquoted!
    strictTransportSecurity: { maxAge: 86400, preload: true },        // < 1 year
  });
} catch (err) {
  console.log(err.violations);
  // [
  //   { reason: 'unquoted_csp_keyword',         path: '…scriptSrc[0]', remedy: "use Csp.Self" },
  //   { reason: 'hsts_preload_requirement_missing', path: '…' },
  // ]
}
```

`helmet.warnings` is a frozen array of non-fatal advisories.

## SRP / directory layout

`src/<header>/` is one directory per HTTP response header. The grouped directories — `cache-control/` (CC + Pragma + Expires), `document-policy/` (DP + Require-DP + DIP), `reporting/` (Reporting-Endpoints + NEL + Report-To) — are intentional: each grouping shares a serializer/dictionary and changes atomically (NEL fundamentally requires Report-To, etc.).

## Performance

| Operation | ops/sec (Bun 1.3, M-class CPU) |
|---|---|
| `helmet.headersRecord()` (cache hit) | ~760k |
| `helmet.headersRecord({ nonce })` | ~1.07M |
| `helmet.applyHeadersTo(headers, { nonce })` | ~390k |
| `helmet.apply(response, { nonce })` | ~190k |

CSP body is pre-tokenized at construction; per request only nonce substitution runs.

## Scope

Web Fetch API only — runtime-agnostic. No framework adapters, no opinionated presets, no non-HTTP serializers. If you want CORS, see `@zipbul/cors`.

## License

MIT © Junhyung Park
