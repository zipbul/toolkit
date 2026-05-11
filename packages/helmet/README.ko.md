# @zipbul/helmet

> Web Fetch API용 표준 준수 HTTP 응답 보안 헤더 엔진. Bun, Node 18+, Deno, Cloudflare Workers, Vercel Edge 등 `Request`/`Response`/`Headers`가 동작하는 모든 런타임에서 실행 가능. **런타임 의존성 0개.**

CSP3 · HSTS preload · COOP / COEP / CORP · Origin-Agent-Cluster · Permissions-Policy(RFC 9651 Structured Fields) · Reporting-Endpoints + NEL · Integrity-Policy · Document-Policy · Clear-Site-Data · Cache-Control / Pragma / Expires · Referrer-Policy · X-Frame-Options · X-Content-Type-Options · X-DNS-Prefetch-Control · X-Permitted-Cross-Domain-Policies · X-Download-Options · X-XSS-Protection · X-Robots-Tag · Timing-Allow-Origin — 모두 단일 `Helmet.create({...})` 팩토리에서 제공.

`Set-Cookie`는 **스코프 외**입니다. 쿠키의 파싱/직렬화/jar는 쿠키 라이브러리의 책임이고, helmet은 응답 **보안 정책** 헤더만 set/strip합니다.

## 설치

```sh
bun add @zipbul/helmet
```

## 30초 둘러보기

```ts
import { Helmet } from '@zipbul/helmet';

const helmet = Helmet.create();   // OWASP 정렬 Default-ON

addEventListener('fetch', evt => {
  evt.respondWith(handle(evt.request).then(r => helmet.apply(r)));
});
```

`Helmet.create()` 한 줄로 11개 헤더 송출. CSP3 베이스라인, HSTS(2년 + includeSubDomains), `X-Frame-Options: deny`, `Cross-Origin-Opener-Policy: same-origin`, `Origin-Agent-Cluster: ?1`(RFC 9651 sf-boolean), OWASP Permissions-Policy 잠금 포함.

## 요청별 CSP nonce (캐시 안전)

```ts
const helmet = Helmet.create({
  contentSecurityPolicy: { directives: { defaultSrc: ["'self'"] } },
});

addEventListener('fetch', evt => {
  const nonce = Helmet.generateNonce();   // 16바이트 base64url branded Nonce
  evt.respondWith(render(nonce).then(r => helmet.apply(r, { nonce })));
});
```

CSP 본문은 인스턴스 생성 시 **단 한 번 사전 토큰화**되며, 요청마다 단일 `String.prototype.replaceAll` 치환만 수행합니다. 함수형 치환을 강제해 `$`-meta 캐시 포이즈닝에 면역. **헤더 record 약 1M ops/초**.

## 리포팅

```ts
const helmet = Helmet.create({
  reportingEndpoints: {
    endpoints: { default: 'https://r.example.com/csp' },   // HTTPS 강제
  },
  contentSecurityPolicyReportOnly: { directives: { defaultSrc: ["'self'"], reportTo: 'default' } },
  nel: { reportTo: 'default', maxAge: 86400 },              // 레거시 Report-To 자동 생성
});

// 단축 빌더
Helmet.endpoints({ default: 'https://r.example.com/csp' });
```

## 검증 계약

`Helmet.create()`는 옵션 트리 **전체**를 검증, **모든** 위반을 한 번에 모은 단일 `HelmetError`를 throw합니다.

```ts
try {
  Helmet.create({
    contentSecurityPolicy: { directives: { scriptSrc: ['self'] } },   // 따옴표 누락!
    strictTransportSecurity: { maxAge: 86400, preload: true },        // 1년 미만
  });
} catch (err) {
  console.log(err.violations);
}
```

`helmet.warnings`는 frozen 배열로, 비치명적 권고를 담습니다.

## SRP / 디렉토리 구조

`src/<header>/`는 헤더 1개 = 디렉토리 1개 원칙. 묶여있는 디렉토리(`cache-control/`은 CC+Pragma+Expires, `document-policy/`는 DP+Require-DP+DIP, `reporting/`은 Reporting-Endpoints+NEL+Report-To)는 의도적으로 묶음 — 각각 직렬화기/Dictionary를 공유하고 동시에 변경되는 단위(NEL은 Report-To 없이 동작 불가 등).

## 성능

| 작업 | ops/초 (Bun 1.3, M급 CPU) |
|---|---|
| `helmet.headersRecord()` (캐시 적중) | 약 760k |
| `helmet.headersRecord({ nonce })` | 약 1.07M |
| `helmet.applyHeadersTo(headers, { nonce })` | 약 390k |
| `helmet.apply(response, { nonce })` | 약 190k |

## 스코프

Web Fetch API 전용 — 런타임 비종속. 프레임워크 어댑터 없음, 의견 강요 프리셋 없음, 비-HTTP 직렬화기 없음. CORS는 `@zipbul/cors` 별도.

## 라이선스

MIT © Junhyung Park
