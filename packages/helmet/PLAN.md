# @zipbul/helmet 구현 계획

## Context

express-helmet은 `Permissions-Policy` 미포함, `X-Frame-Options: SAMEORIGIN`(표준은 `deny`), HSTS max-age 1년(Mozilla 권장 2년), 죽은 IE8 헤더(`X-Download-Options`) 기본 포함, `Csp` 상수 부재로 인한 따옴표 누락 보안 구멍 등 국제 표준(OWASP/Mozilla)과 갭이 있다. `@zipbul/helmet`은 이 갭을 메우고, 기존 `@zipbul/cors` 패턴(프레임워크 비종속, Web API, 검증 실패 시 throw)을 따르는 표준 기반 보안 헤더 엔진을 만든다.

### 준수 표준 (2026-04 기준)

- **OWASP Secure Headers Project**
  - `headers_add.json` (last_update_utc 2026-03-05) — 13개 default-add 헤더
  - `headers_remove.json` (동일 timestamp) — 70종 정보 노출 헤더 제거 권장
  - `tab_bestpractices.md`, HTTP Headers Cheat Sheet
  - 2026-03-05는 OWASP CMS 마이그레이션 직전 frozen snapshot. 마이그레이션 완료까지 추가 갱신 미예정. 본 라이브러리는 자동 sync test로 drift 감지
- **W3C/WHATWG**
  - CSP3 ED 2026-04-21 (CR 미진입)
  - Permissions-Policy Level 1 WD 2025-10-06 + features registry (`webappsec-permissions-policy/features.md`)
  - Trusted Types ED 2026-02-24
  - Reporting API ED 2026-01-02 (legacy `Report-To` 헤더 제거됨, `Reporting-Endpoints`만 정식)
  - HTML Standard 2026-04-24 (Origin-Agent-Cluster, iframe sandbox 13 토큰)
  - Subresource Integrity / Integrity-Policy ED 2026-03-20, SRI Level 2 FPWD 2025-04-22
  - Clear-Site-Data, Fetch
- **WICG**
  - Document-Policy (stalled 2022-03-30) / Require-Document-Policy / Sec-Required-Document-Policy
  - Document-Isolation-Policy (2025-04-23)
  - Cross-Origin Isolation
  - Fenced Frame (CSP `fenced-frame-src`의 출처)
  - Storage Access Headers (Storage Access API의 sandbox 토큰 확장)
  - Speculation Rules (CSP `'inline-speculation-rules'` 키워드 출처)
- **IETF**
  - RFC 6797 (HSTS) — `preload` 토큰은 RFC 비포함, hstspreload.org 컨벤션
  - RFC 7034 (X-Frame-Options)
  - **RFC 9651 (Structured Field Values, Sept 2024)** — RFC 8941 obsolete. 본 라이브러리는 9651만 정식 인용. 9651 신규 타입 sf-date(§3.3.7), sf-displaystring(§3.3.8)은 보안 헤더에서 미사용이나 SF 모듈은 round-trip 보장
  - RFC 9110 (HTTP Semantics, §6.1 / §15.3.5 / §15.4.5: 1xx/204/304 본문 부재)
  - RFC 9111 (HTTP Caching, §5.2.2.5: `no-store`)
  - RFC 9842 (Compression Dictionary Transport, Sept 2025) — same-origin 강제로 의도적 제외
  - RFC 9421 (HTTP Message Signatures, Feb 2024) — 의도적 제외
  - RFC 9530 (Digest Fields, Feb 2024) — 의도적 제외. **draft-ietf-httpbis-unencoded-digest-04 (2026-03, Waiting for AD Go-Ahead)**로 갱신 예정 (Q3 2026 RFC 예상)
  - **RFC 9849 (TLS Encrypted Client Hello, Mar 2026)** — TLS 레이어. 본 라이브러리 헤더 미배출이나 SNI 기밀화로 HSTS preload가 유일한 네트워크 가시 신호 (정보용)
  - draft-ietf-httpbis-rfc6265bis-22 (Dec 2025, WGLC) — 쿠키 prefix 권장 인용용
  - draft-ietf-httpbis-layered-cookies-01 (Nov 2025) — 정보용
- **W3C webappsec CR 진행** (CR 미진입 표준 추적):
  - `w3c/webappsec#693` (CSP-3 CR preparation, Oct 2025) — 2026 중반 CR 예상
  - `w3c/webappsec#691` (SRI-2 CR preparation, Oct 2025) — Integrity-Policy 헤더 CR 예상
  - `w3c/webappsec#692` (Fetch Metadata CR preparation, Oct 2025)
  - CSP3 신규 라이브 이슈: #797 XSLT directive, #798 WebDriver BiDi CSP bypass, #801 interactive HTTP auth subresources control
  - **Signature-based SRI (Ed25519)** — WICG/signature-based-sri Chromium prototype intent. `CspHashSource`에 향후 `'ed25519-...'` 예약 (현재 미배출)
- **W3C Permissions-Policy registry** (`webappsec-permissions-policy/features.md`)
  - Standardized 38 (11 ch-ua-* 포함) + Proposed 13 + Experimental 16. Retired 2 (`document-domain`, `window-placement`)
  - `interest-cohort`는 registry에서 완전 제거됨 (Retired 표가 아님)

### 브라우저 지원 (2026-04 기준, graceful degradation 보장)

| 헤더 / 기능 | Chromium | Firefox | Safari | 비고 |
|---|---|---|---|---|
| CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy | ✓ | ✓ | ✓ | 핵심 |
| Permissions-Policy (헤더) | ✓ | ✓ | ✗ | Firefox shipped (2024+), Safari/WebKit 미지원. ~85% 글로벌 |
| Trusted Types | ✓ | ✓ Firefox 148+ (unflagged, 2026-02-24) | ✓ | universal |
| Origin-Agent-Cluster | ✓ origin-keyed default 2025+ | ✓ Firefox 138+ (2025-04-29) | TBD | cross-engine parity 명시 헤더로 보장 |
| COOP `same-origin` | ✓ | ✓ | ✓ | universal |
| COEP `require-corp` | ✓ | ✓ | ✓ | universal |
| COEP `credentialless` | ✓ | ✓ | ✗ | Safari 미지원 |
| CORP | ✓ | ✓ | ✓ | universal |
| Reporting-Endpoints | ✓ | ✓ Firefox 149+ (2026-03-24) | ✗ | Safari 미지원 |
| NEL | ✓ | ✗ | ✗ | Chromium 전용 |
| Integrity-Policy | ✓ Chrome 138+ | ✓ Firefox 145+ (enforcement) / 149+ (Reporting integration) | ✓ Safari 18.4+ (2025-03-31) | Q1 2026 universal 도달 |
| Document-Isolation-Policy | ✓ Chrome 137+ stable (2025-05) | ✗ | ✗ | Chromium 전용, OT 종료 후 stable |
| Document-Policy / Require-Document-Policy | ✓ | ✗ | ✗ | WICG stalled 2022, Chromium 전용 |
| Clear-Site-Data | ✓ | ✓ | ✓ (부분) | 표준 토큰 universal, `prefetchCache`/`prerenderCache`는 Chromium-only 비표준 |
| `fenced-frame-src` (CSP) | ✓ | ✗ | ✗ | WICG Fenced Frame draft |
| `webrtc` 디렉티브 (CSP) | ✓ | 부분 | ✗ | CSP3 ED |
| `report-sha*` 키워드 (CSP) | ✓ Chrome stable | ✗ | ✗ | CSP3 ED §2.3.1 |

## API 설계

```typescript
// 생성 — 검증 실패 시 HelmetError throw (@zipbul/cors의 Cors.create와 동일 패턴)
const helmet = Helmet.create(options?);

// 정적 빌더 (개별 헤더만 필요할 때, tree-shake 친화)
const [name, value] = Helmet.csp(options.contentSecurityPolicy);
const [name, value] = Helmet.hsts(options.strictTransportSecurity);
const [name, value] = Helmet.permissionsPolicy(options.permissionsPolicy);
// 각 헤더별 정적 헬퍼 — src/<feature>/serialize.ts export 위임

// 환경/시나리오 프리셋 (인스턴스 반환)
const helmet = Helmet.presets.strict();           // CSP strict-dynamic + HSTS preload + Trusted Types
const helmet = Helmet.presets.api();              // CSP `default-src 'none'`, frame-ancestors `'none'`, no-store
const helmet = Helmet.presets.spa();              // SPA hash-friendly CSP
const helmet = Helmet.presets.observatoryAPlus(); // Mozilla Observatory v2 A+ 보장
const helmet = Helmet.presets.amp();              // AMP-compatible CSP (cdn.ampproject.org 고정 allowlist + report-uri)
const helmet = Helmet.presets.oauth();            // OAuth/OIDC popup-flow 호환 (COOP `same-origin-allow-popups` + Referrer-Policy `strict-origin-when-cross-origin`)
const helmet = Helmet.presets.kisa();             // KISA 「웹서버 보안 강화 가이드」 + ISMS-P 2.10.6 호환
const helmet = Helmet.presets.acsc();             // ACSC ISM-1788 (Referrer-Policy strict-origin-when-cross-origin)
const helmet = Helmet.presets.bsi();              // BSI TR-03161 (Cache-Control no-store 강제)
const helmet = Helmet.presets.ncsc();             // NCSC UK monitoring-first (CSP-Report-Only + Reporting-Endpoints)
const helmet = Helmet.presets.ipa();              // IPA「安全なウェブサイトの作り方」第7版 (X-Frame-Options uppercase DENY)

// 환경 → 메타-CSP / 매니페스트 / 비-Web 응답
const html = `<meta http-equiv="Content-Security-Policy" content="${helmet.toMetaTag().csp}">`;
const tauriHeaders = helmet.toTauriConfig();      // tauri.conf.json `app.security` 블록 직렬화
const mv3Csp = Helmet.toExtensionManifestCsp(opts); // MV3 manifest.json content_security_policy.extension_pages

// 보안 헤더 반환 (동기, request 불필요)
const headers: Headers = helmet.headers();

// nonce 주입 — CSP/CSP-Report-Only만 per-request 재생성, 나머지 캐시 반환
const nonce: Nonce = Helmet.generateNonce();      // branded, 16바이트 base64url 22자
const headers: Headers = helmet.headers({ nonce });

// 핫패스 — Headers 할당 회피. nonce도 지원
const record: Readonly<Record<string, string>> = helmet.headersRecord();
const record: Readonly<Record<string, string>> = helmet.headersRecord({ nonce });

// Response 적용 (새 Response 생성)
return new Response(body, { headers: helmet.headers() });

// 기존 Response 적용 (보안 헤더 추가 + removeHeaders 제거)
const secured: Response = helmet.apply(response);
const secured: Response = helmet.apply(response, { nonce });

// 기존 Headers in-place 수정 (Headers 재할당 회피, edge/Hono 핫패스)
helmet.applyHeadersTo(response.headers, { nonce });

// 라우트별 부분 override — 부모 캐시 재사용, 새 frozen 인스턴스
const adminHelmet = helmet.derive({
  contentSecurityPolicy: { directives: { scriptSrc: [Csp.Self, Csp.StrictDynamic, Csp.nonce(nonce)] } }
});

// 진단 / SOC 2 evidence
const snapshot: ResolvedHelmetOptions = helmet.toJSON();
const names: readonly string[] = helmet.headerNames();
const removeList: readonly string[] = helmet.headersToRemove();
const warnings: readonly HelmetWarning[] = helmet.warnings;

// 마이그레이션 — express-helmet v8/v9 옵션 변환 + 사라진 키 경고
const helmet = Helmet.fromHelmetOptions(legacyConfig);

// CSP 강도 lint (csp-evaluator 동등 휴리스틱)
const findings = Helmet.lintCsp(directives, { level: 'strict' });

// CSP 보고서 파서 (legacy application/csp-report + Reporting API application/reports+json)
const reports = await Helmet.parseCspReport(request);

// SRI 해시 헬퍼 (Web Crypto, 런타임 비종속)
const hash = await Helmet.hashFromString(scriptText, 'sha384');

// Reporting endpoint 단축
const endpoints = Helmet.endpoints({
  default: 'https://o.ingest.sentry.io/api/.../security/?sentry_key=...',
  csp: 'https://example.com/csp',
});
```

### 메서드 시멘틱

#### 결과 모델 (Result 패턴 정책)

`@zipbul/cors`와 동일한 모노리포 컨벤션을 따른다 — **public API는 throw**, **내부 검증은 `@zipbul/result`의 `safe()` / `isErr()`로 batched aggregate**:

- `resolveHelmetOptions()` / `validateHelmetOptions()` (내부): `safe()`로 각 모듈 위임 결과 수집 → 모든 `ViolationDetail`을 단일 `Err` 데이터로 묶어 반환. 첫 위반에서 fail-fast 안 함
- `Helmet.create()` (public): `validateHelmetOptions`가 `Err`이면 즉시 `throw new HelmetError(violations)` — cors `Cors.create()` 패턴과 1:1 동일
- `headers()` / `headersRecord()` / `apply()` / `applyHeadersTo()` / `derive()` (public, 동기): 입력이 이미 검증된 `ResolvedHelmetOptions` 기반이므로 throw 안 함. `derive()`는 새 검증을 다시 거치므로 throw 가능
- `Helmet.parseCspReport()` (public, async): malformed 입력은 throw, 유효 입력은 typed union 반환
- 본 라이브러리는 `ResultAsync<>` 반환 메서드를 노출하지 않는다 — cors의 `handle()`은 비동기 origin 함수 호출이 있어 Result async가 자연스럽지만, helmet은 모든 응답 처리가 동기

#### 메서드 목록

- `Helmet.create(options?): Helmet` — 검증 실패 시 `HelmetError` throw (모든 위반 사항 aggregate). 인스턴스는 `Object.freeze` 처리 — 변경 불가
- `headers(options?: HeadersOptions): Headers` — defensive copy. 호출자 mutation은 캐시에 영향 없음. nonce 전달 시 CSP/CSP-Report-Only만 재생성
- `headersRecord(options?: HeadersOptions): Readonly<Record<string, string>>` — 핫패스 GC 절감. nonce 지원
- `apply(response, options?: ApplyOptions): Response` — **알고리즘**:
  1. 응답 검증 — `response.bodyUsed === true` 또는 `response.type === 'error' | 'opaqueredirect'` 시 `HelmetError` throw
  2. **상태 코드 스킵** — `response.status` 가 `1xx`, `304`인 경우 RFC 9110 §6.1 / §15.3.5 / §15.4.5(메시지 본문 부재)에 따라 보안 헤더 주입 생략하고 `response` 그대로 반환. HEAD/OPTIONS/204/null-body는 정상 적용
     - **304 트레이드오프 (RFC 9111 §4.3.4)**: 304 응답은 cache validator로 동작하며 RFC 9111 §4.3.4 "Freshening Stored Responses upon Validation"에 따라 304의 헤더가 client의 stored 200 응답 헤더를 update한다. 본 라이브러리는 304에 보안 헤더를 추가 송출하지 않는다 — 사유: (a) 304 본문 부재이므로 새 정책 strict 적용은 무의미, (b) 모든 라우트에서 304 헤더로 정책을 update하면 강한 정책이 약한 정책으로 회귀할 수 있음(stored 응답이 더 strict했을 경우), (c) RFC 9111 §4.3.4는 update를 "selected representation의 metadata 갱신"으로 정의하며 보안 헤더 update 의무 명시 없음
     - **사용자 책임**: 보안 헤더는 **반드시 첫 200 응답** (cache entry establishing response)에 포함되어야 한다. CDN/reverse proxy가 304 직접 생성(예: nginx `If-None-Match` 매칭) 후 그대로 forward하는 경우, edge layer에서 보안 헤더를 별도 주입(Cloudflare Transform Rules / nginx `add_header always`) 권장. 본 라이브러리의 `apply()` 단독으로는 304 경로를 커버 못 함 — README에 명시
     - **검증 모드 옵션 (deferred, v1.x minor 후보)**: `Helmet.create({ apply: { mode: 'all-status' } })` — 304/1xx에도 강제 주입. RFC 9111 §4.3.4 위반 trade-off는 사용자 결정
  3. 신규 `Headers` 생성 — `response.headers` 전체 복제 (`Set-Cookie`는 `getSetCookie()` + `append`로 다중 값 보존)
  4. `removeHeaders` 항목 case-insensitive 삭제
  5. 보안 헤더 오버레이 — **per-header 충돌 정책**:
     - **Always-overwrite (하드 보안)**: CSP, CSP-RO, COOP/RO, COEP/RO, CORP, HSTS, Origin-Agent-Cluster, X-Content-Type-Options, X-Frame-Options, Permissions-Policy/RO, Referrer-Policy, Integrity-Policy/RO, Document-Policy/RO, Document-Isolation-Policy/RO, X-Permitted-Cross-Domain-Policies, X-DNS-Prefetch-Control, X-XSS-Protection, X-Download-Options
     - **Set-if-absent (사용자 의도 우선)**: Cache-Control, X-Robots-Tag, Timing-Allow-Origin, Reporting-Endpoints, NEL, Report-To
     - 사유: 보안 정책은 라이브러리 책임. 캐시·로봇·타이밍·리포트 endpoint는 라우트별 사용자 결정 우선
  6. `new Response(response.body, { status, statusText, headers })` 생성. body stream 미소비
- `applyHeadersTo(headers: Headers, options?: ApplyOptions): void` — in-place mutation. Response 재할당 회피
- `derive(partial: HelmetOptions): Helmet` — 부분 override + 새 frozen 인스턴스. **재검증 범위**:
  - merge: `structuredClone(parent.options)` deep clone 후 `partial`을 path 단위로 overlay (디렉티브 단위 replace, L427 정책과 동일)
  - **`validateHelmetOptions`를 머지된 전체 트리에 재실행** — 변경 키만 보지 않음. 사유: CSP `scriptSrc` override가 `default-src` fallback chain warn(`ManifestSrcNoFallback`), Reporting endpoint cross-ref, Trusted Types policy-name 중복, prototype pollution 검사를 모두 다시 트리거할 수 있음. 부분 검증은 **보안 회귀 벡터**
  - 캐시 재사용은 **검증 통과 후 직렬화 레이어에서만 수행** — 변경되지 않은 헤더의 pre-tokenized 템플릿은 부모와 공유, 변경된 헤더만 재직렬화
  - 검증 실패 시 `HelmetError` throw — 부모 인스턴스는 영향 없음 (deep clone 격리)
  - `helmet.warnings`는 부모 + 자식 합집합 아닌 **자식 검증의 fresh 결과**로 대체
- `headersToRemove(): readonly string[]` — lowercase 제거 대상 배열
- `headerNames(): readonly string[]` — 송출 헤더 이름 lowercase 배열 (진단용)
- `toJSON(): ResolvedHelmetOptions` — deep-readonly 스냅샷 (snapshot test, SOC 2 evidence)
- `warnings: readonly HelmetWarning[]` — non-fatal validate 경고 (e.g., `'unsafe-inline'` + nonce 공존, sandbox in Report-Only)
- `Helmet.generateNonce(bytes = 16): Nonce` — `crypto.getRandomValues(new Uint8Array(bytes))` → base64url + `Nonce` 브랜드 타입. 16바이트(128bit)는 CSP3 ED §2.3.1 nonce-source grammar + §8 Security Considerations 충족. `crypto.randomUUID()`(122bit) 사용 비권장

### 헤더 emit 순서

`Headers` Web API는 삽입 순서를 보존(WHATWG Fetch). 본 라이브러리는 결정론적 emit 순서를 보장:

1. **하드 보안 정책** (always-overwrite): CSP, CSP-RO, COOP/RO, COEP/RO, CORP, HSTS, Origin-Agent-Cluster, X-Content-Type-Options, X-Frame-Options, Permissions-Policy/RO, Referrer-Policy, Integrity-Policy/RO, Document-Policy/RO, Document-Isolation-Policy/RO, X-Permitted-Cross-Domain-Policies, X-DNS-Prefetch-Control, X-XSS-Protection, X-Download-Options
2. **Reporting/Set-if-absent**: Reporting-Endpoints, Report-To (NEL 자동 생성), NEL
3. **Cache/Robots/Timing**: Cache-Control, Pragma, Expires, X-Robots-Tag, Timing-Allow-Origin, Clear-Site-Data
4. **Set-Cookie**: 입력 응답에서 그대로 보존 (다중 값 `getSetCookie() + append`)

순서는 골든 파일(`test/golden/`)로 회귀 방지. 사용자 응답에 이미 있던 헤더는 always-overwrite 그룹은 덮어쓰고, set-if-absent 그룹은 보존.

### Streaming response 안전성

- `apply(response)`: `new Response(response.body, { headers, status, statusText })` — body stream 미소비, headers는 신규 객체. **streaming 안전**
- `applyHeadersTo(headers, options)`: in-place mutation. Response가 이미 stream을 시작 (Transfer-Encoding chunked, 첫 byte 송출됨)했다면 헤더 변경은 wire-level에 반영 안 됨 → 사용자 책임. README/JSDoc에 명시: "응답 첫 byte 송출 전에만 호출. 미들웨어 layer 끝에서 마지막 단계로"
- `applyHeadersTo`는 status 101 (Switching Protocols), 1xx informational에서 `ApplyOnSwitchingProtocols` warn → 헤더 적용 무의미

### 캐싱 전략

- 생성 시 모든 헤더 빌드 + freeze
- CSP/CSP-RO는 **pre-tokenized 템플릿**으로 캐시 — nonce placeholder를 per-request **함수 형식 replace**로 주입 (전체 재직렬화 회피)
- **보안 주의 (cache poisoning 방지)**: `String.prototype.replace`/`replaceAll`의 string 두 번째 인자는 `$&`, `$'`, `` $` ``, `$1`–`$9`, `$$` 메타문자를 해석 → nonce 값이 어떻게든 `$`를 포함하면 캐시 손상 + cross-request 오염. **반드시 함수 형식 사용**: `template.replaceAll(NONCE_PLACEHOLDER, () => nonceValue)`. 추가로 `Helmet.generateNonce()`는 base64url charset만 배출하나 사용자가 `headers({ nonce: userString })`으로 임의 문자열 전달 가능 → 함수 형식이 필수 방어선
- 나머지 헤더는 정적 캐시. `headers()` 호출은 `new Headers(cached)` 1회 + nonce 시 CSP 2개만 재계산
- `derive()` 시 부모 인스턴스의 변경되지 않은 헤더 캐시 재사용
- **불변성 강화 (deep freeze)**: 다음 객체 그래프는 모두 **런타임 deep freeze** + TS deep readonly 이중 방어:
  - `Helmet` 인스턴스 자체 (`Object.freeze(this)`) — public 메서드만 노출, 필드 mutation 불가
  - 내부 `ResolvedHelmetOptions` 트리 — `directives` Map, `features` Map, `endpoints` Map, `policies` Map, `removeHeaders.headers` 배열, sandbox 토큰 배열 등 **모든 nested 컨테이너에 재귀 freeze 적용**. Map의 경우 `Object.freeze(map)` + 변경 메서드(`set`/`delete`/`clear`)는 strict mode에서 throw
  - `helmet.warnings` 배열 + 각 `HelmetWarning` 객체
  - `helmet.toJSON()` 반환값 — `ResolvedHelmetOptions` deep-frozen 스냅샷이므로 호출자 mutation으로 SOC 2 evidence 손상 불가. 호출자가 자신의 표현으로 변환하려면 `structuredClone()` 후 작업
  - 예외: `headers()` / `headersRecord()` 반환값은 freeze **안 함** — `Headers`는 WHATWG spec상 freeze 불가 객체, `Record<string,string>`은 호출자가 framework adapter로 push할 때 mutation 필요할 수 있음. 대신 매 호출마다 새 인스턴스 반환하여 캐시 오염 방지

## 전체 헤더 목록

### Default-ON (11개) + OWASP `headers_add.json` 정렬 표

OWASP `headers_add.json` 2026-03-05는 **13개**: CSP, COOP, COEP, CORP, Permissions-Policy, Referrer-Policy, HSTS, X-Content-Type-Options, X-DNS-Prefetch-Control, X-Frame-Options, X-Permitted-Cross-Domain-Policies, **Cache-Control**, **Clear-Site-Data**.

본 라이브러리는 OWASP 13개 중 **11개만 Default-ON**으로 채택, COEP·Cache-Control·Clear-Site-Data 3종은 의도적으로 Default-OFF(opt-in). 사유는 아래 deviation 표에 명시 — `compliance: 'tracks OWASP headers_add.json with 3 deliberate opt-ins'`. + plan-extension 1종(Origin-Agent-Cluster, HTML spec 권장).

| # | 헤더 | 기본값 | 근거 |
|---|---|---|---|
| 1 | `Content-Security-Policy` | `default-src 'self'; form-action 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; manifest-src 'self'; upgrade-insecure-requests` | OWASP 2026 공식값 + `manifest-src 'self'` (PWA 안전망 — `default-src`는 manifest-src로 fallback 안 됨, 미명시 시 PWA 사일런트 깨짐) |
| 2 | `Cross-Origin-Opener-Policy` | `same-origin` | OWASP |
| 3 | `Cross-Origin-Resource-Policy` | `same-origin` | OWASP `headers_add.json` (cheat sheet `same-site`보다 JSON 우선) |
| 4 | `Origin-Agent-Cluster` | `?1` | HTML spec. Chromium origin-keyed default 2025+, Firefox 138+ shipped. plan-extension (OWASP 미포함). `false` 시 `?0` (sf-boolean opt-out) |
| 5 | `Permissions-Policy` | 아래 Tier 표 참조 (OWASP `unload`+`interest-cohort` 포함 29 vs plan curated 54+) | OWASP. **Chromium+Firefox 지원, Safari 미지원** |
| 6 | `Referrer-Policy` | `no-referrer` | OWASP. **Tradeoff**: 가장 엄격하지만 일부 애널리틱스/OAuth 콜백 깨짐 가능. Mozilla/ACSC ISM-1788은 `strict-origin-when-cross-origin` 권장 → `presets.acsc()` 사용 |
| 7 | `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` (2년) | Mozilla / RFC 6797. `preload` 토큰은 RFC 비포함, hstspreload.org 컨벤션 |
| 8 | `X-Content-Type-Options` | `nosniff` | OWASP |
| 9 | `X-DNS-Prefetch-Control` | `off` | OWASP. 보안보단 프라이버시/성능이나 OWASP 권장 유지 |
| 10 | `X-Frame-Options` | `deny` | OWASP/Mozilla 정규형(소문자). CSP `frame-ancestors 'none'`과 일치. **WAF 호환 주의**: Cloudflare/Akamai 일부 시그니처가 정확히 `DENY` 매칭 → `xFrameOptions: 'DENY'` 입력 시 그대로 송출하여 호환 |
| 11 | `X-Permitted-Cross-Domain-Policies` | `none` | OWASP. Flash/Silverlight EOL이나 PCI/Qualys 스캐너가 체크 |

#### OWASP deviation 명시

| OWASP add.json | 본 라이브러리 | 사유 |
|---|---|---|
| `Cross-Origin-Embedder-Policy: require-corp` (default-add) | Default-OFF | 서드파티 임베드(이미지/폰트/CDN) 광범위 차단 위험. cross-origin isolation 필요 시 명시 활성. **Safari `credentialless` 미지원** |
| `Cache-Control: no-store, max-age=0` (default-add) | Default-OFF | 보안 비민감 응답까지 일괄 no-store 적용은 캐시 효율성 저하. 민감 라우트별 opt-in 또는 `presets.bsi()`/`presets.kisa()` 활성. PCI DSS §6.4.3 / KISA PIPA §7(6) 적용 라우트는 명시 활성 |
| `Clear-Site-Data` (default-add) | Default-OFF (action 헤더) | 모든 응답에 송출하면 매 요청마다 캐시/쿠키/스토리지 삭제 → 사용자 세션 파괴. 로그아웃 endpoint 전용 action 헤더로 opt-in |
| `interest-cohort` Permissions-Policy 항목 | 플랜 미포함 | FLoC 2022년 폐기, registry에서 완전 제거됨. OWASP `headers_add.json`에는 잔존(legacy noise) → 사용자가 `permissionsPolicy.features['interest-cohort']: []`로 명시 추가 가능 |

#### CSP 기본값 설계 근거

OWASP 2026 공식 CSP를 기본값으로 채택. `default-src 'self'`에 의존하여 명시하지 않은 fetch 디렉티브(font-src, img-src, script-src, style-src 등)는 자동으로 `'self'`가 적용된다.

| 디렉티브 | 값 | 근거 |
|---|---|---|
| `default-src` | `'self'` | OWASP 기본. font-src, img-src, script-src, style-src 등 미명시 fetch 디렉티브에 fallback |
| `base-uri` | `'self'` | base tag injection 방지 |
| `form-action` | `'self'` | 폼 제출 대상 제한 |
| `frame-ancestors` | `'none'` | OWASP 공식. X-Frame-Options `deny`와 일치 |
| `object-src` | `'none'` | Flash/Java 플러그인 완전 차단 |
| `manifest-src` | `'self'` | **PWA 호환 안전망**. CSP3 §6.6에 의해 `default-src`로 fallback **되지 않음** — 미명시 시 PWA `manifest.webmanifest` fetch 차단 (사일런트 깨짐). plan-extension (OWASP 미포함) |
| `upgrade-insecure-requests` | (boolean) | HTTP→HTTPS 자동 업그레이드. HSTS와 비충돌 (HSTS=호스트별, UIR=페이지별 navigations) — 둘 다 송출 권장 |

> Google Fonts(`font-src 'self' https: data:`), 인라인 SVG(`img-src 'self' data:`) 등 외부 리소스가 필요한 경우 사용자가 디렉티브 override.

### Default-OFF (opt-in, 22개)

| # | 헤더 | 활성 시 기본값 | 이유 |
|---|---|---|---|
| 12 | `Cross-Origin-Embedder-Policy` | `require-corp` | OWASP 권장이나 서드파티 리소스 깨짐 위험으로 opt-in. cross-origin isolation(SharedArrayBuffer) 필요 시 활성. Safari `credentialless` 미지원 |
| 13 | `Content-Security-Policy-Report-Only` | 사용자 지정 | CSP 정책 모니터링 |
| 14 | `Cross-Origin-Opener-Policy-Report-Only` | 사용자 지정 | COOP 모니터링 |
| 15 | `Cross-Origin-Embedder-Policy-Report-Only` | 사용자 지정 | COEP 모니터링 |
| 16 | `Permissions-Policy-Report-Only` | 사용자 지정 | Permissions-Policy 모니터링 (Chromium 전용) |
| 17 | `Reporting-Endpoints` | 사용자 지정 | CSP/COOP/COEP/Integrity-Policy/NEL 위반 리포트 수신. RFC 9651 Dictionary. `default` endpoint는 fallback 컨벤션 |
| 18 | `Integrity-Policy` | `true` → `{ blockedDestinations: ['script', 'style'] }` | SRI 강제. RFC 9651 Dictionary, `sources` Inner List, `endpoints` Inner List of Token. Q1 2026 universal |
| 19 | `Integrity-Policy-Report-Only` | 사용자 지정 | SRI 모니터링 |
| 20 | `Clear-Site-Data` | `true` → `{ directives: ['cache', 'cookies', 'storage'] }` | 로그아웃 시 브라우저 데이터 삭제. W3C 표준 토큰: `cache`, `cookies`, `storage`, `executionContexts`, `clientHints`, `*`. `prefetchCache`/`prerenderCache`는 Chrome 비표준 |
| 21 | `Cache-Control` | `no-store, max-age=0` | OWASP. PCI DSS §6.4.3 / KISA PIPA §7(6) 적용 라우트는 활성. `pragma`/`expires`로 HTTP/1.0 호환 |
| 22 | `NEL` | 사용자 지정 | 네트워크 에러 로깅 (Chromium 전용). 레거시 `Report-To` 헤더에 의존 — NEL 활성 시 자동 생성 |
| 23 | `Document-Policy` | 사용자 지정 | WICG stalled 2022, Chromium 전용 실험 기능. RFC 9651 Dictionary |
| 24 | `Document-Policy-Report-Only` | 사용자 지정 | Document-Policy 모니터링 |
| 25 | `Require-Document-Policy` | 사용자 지정 | 중첩 콘텐츠 정책 요구 (실험적) |
| 26 | `Document-Isolation-Policy` | 사용자 지정 | 프레임별 격리 (Chrome 137+ stable). `isolate-and-require-corp` / `isolate-and-credentialless` / `none` |
| 27 | `Document-Isolation-Policy-Report-Only` | 사용자 지정 | Document-Isolation-Policy 모니터링 |
| 28 | `Timing-Allow-Origin` | 사용자 지정 | Resource Timing 사이드채널 방지 |
| 29 | `X-Robots-Tag` | `true` → `{ directives: ['noindex', 'nofollow'] }` | 민감 엔드포인트 크롤러 차단 |
| 30 | `X-Download-Options` | `noopen` | IE EOL(2022)이나 보안 스캐너(Qualys) 호환. v2.0(major) 제거 후보 |
| 31 | `X-XSS-Protection` | `0` | 레거시 XSS Auditor 명시 비활성. **OWASP 2026 `headers_add.json` 미포함**. CSP가 표준. 보안 스캐너 호환 opt-in. v2.0 제거 후보. **KISA 호환 모드**(`presets.kisa()`)는 `1; mode=block` 송출 — Korean public-sector 스캐너 대응 |
| 32 | `X-Permitted-Cross-Domain-Policies` (override) | `none` (Default-ON과 동일) | 사용자가 라우트별 `master-only`/`by-content-type`/`all` 설정 시 |
| 33 | `Server-Timing` (제거 권장 — 정보 제공) | — | OWASP cheat sheet 권장. 내부 타이밍 노출 위험. 본 라이브러리는 자동 송출 미실시, removeHeaders 기본 후보군에 포함 |

### 기능 (헤더 제거, 1개)

| # | 기능 | 기본 | 설명 |
|---|---|---|---|
| 34 | `removeHeaders` | OWASP must-strip 4종 + plan 확장 | 정보 노출 헤더 제거. `apply(response)`에서 동작 |

#### removeHeaders 정책

- **기본값** (`removeHeaders: true` 또는 미지정): `Server`, `X-Powered-By`, `X-AspNet-Version`, `X-AspNetMvc-Version` (OWASP must-strip 4종)
- **`removeHeaders: 'owasp'`**: OWASP `headers_remove.json` 전체 70종 (자동 sync test 대상)
- **`removeHeaders: { headers: [...], additional: [...] }`**: 사용자 정의
- 매칭: case-insensitive exact match. 와일드카드(`X-B3-*`, `X-Envoy-*`)는 constants에 known 이름 전개
- **Server 헤더 제거 제약**: Bun.serve / Node http2가 미들웨어 이후 `Server`를 prepend하는 경우 `removeHeaders`로 못 막음. README에 런타임별 우회 레시피 명시

#### OWASP `headers_remove.json` 2026-03-05 (70종)

`$wsep`, `Host-Header`, `K-Proxy-Request`, `Liferay-Portal`, `OracleCommerceCloud-Version`, `Pega-Host`, `Powered-By`, `Product`, `Server`, `Server-Timing`, `SourceMap`, `Via`, `X-AspNet-Version`, `X-AspNetMvc-Version`, `X-Atmosphere-error`, `X-Atmosphere-first-request`, `X-Atmosphere-tracking-id`, `X-B3-ParentSpanId`, `X-B3-Sampled`, `X-B3-SpanId`, `X-B3-TraceId`, `X-BEServer`, `X-Backside-Transport`, `X-CF-Powered-By`, `X-CMS`, `X-CalculatedBETarget`, `X-Cocoon-Version`, `X-Content-Encoded-By`, `X-DiagInfo`, `X-Envoy-Attempt-Count`, `X-Envoy-External-Address`, `X-Envoy-Internal`, `X-Envoy-Original-Dst-Host`, `X-Envoy-Upstream-Service-Time`, `X-FEServer`, `X-Framework`, `X-Generated-By`, `X-Generator`, `X-Jitsi-Release`, `X-Joomla-Version`, `X-Kubernetes-PF-FlowSchema-UI`, `X-Kubernetes-PF-PriorityLevel-UID`, `X-LiteSpeed-Cache`, `X-LiteSpeed-Cache-Control`, `X-LiteSpeed-Purge`, `X-LiteSpeed-Tag`, `X-LiteSpeed-Vary`, `X-Litespeed-Cache-Control`, `X-Mod-Pagespeed`, `X-Nextjs-Cache`, `X-Nextjs-Matched-Path`, `X-Nextjs-Page`, `X-Nextjs-Redirect`, `X-OWA-Version`, `X-Old-Content-Length`, `X-OneAgent-JS-Injection`, `X-Page-Speed`, `X-Php-Version`, `X-Powered-By`, `X-Powered-By-Plesk`, `X-Powered-CMS`, `X-Redirect-By`, `X-Runtime`, `X-Server-Powered-By`, `X-SourceFiles`, `X-SourceMap`, `X-Turbo-Charged-By`, `X-Umbraco-Version`, `X-Varnish`, `X-Varnish-Backend`, `X-Varnish-Cache`, `X-Varnish-Server`, `X-Woodpecker-Version`, `X-dtAgentId`, `X-dtHealthCheck`, `X-dtInjectedServlet`, `X-ruxit-JS-Agent`

#### Plan 확장 (OWASP 미포함 trace ID)

`X-Request-ID`, `X-Correlation-ID`, `X-Envoy-Decorator-Operation` — opt-in.

## Permissions-Policy 피처

**중요**: Permissions-Policy HTTP 헤더는 Chromium + Firefox 지원, Safari 미지원 (~85% 글로벌). Tier 모델은 W3C registry 분류 + 브라우저 지원으로 재정의.

### Registry ↔ 본 라이브러리 emit 매핑 (산정 표)

W3C `webappsec-permissions-policy/features.md` registry 카운트와 본 라이브러리 emit 카운트를 reconcile. **L48 "Standardized 38 + Proposed 13 + Experimental 16 + Retired 2"**의 출처는 registry, **본 라이브러리 emit 53(Tier A 6 + B 35 + C 18) + Tier D off-list**의 출처는 본 라이브러리 union 타입.

| registry 분류 | registry 카운트 | 본 라이브러리 처리 | emit 카운트 | 차이 사유 |
|---|---|---|---|---|
| **Standardized** | **38** | Tier A (6) + Tier B (35) + ch-ua-* 11종 의도적 제외 (Client Hints 영역) | 41 | 38 - 11 ch-ua + 14 = 41이 아니라, Standardized 38은 ch-ua 11 포함 → 38 - 11 = 27 emit. 본 라이브러리 Tier B 35는 27 (Standardized 비-ch-ua) + 8 (registry 외이지만 stable Standardized로 본 라이브러리가 분류한 항목 — `cross-origin-isolated`, `attribution-reporting` 등 일부 registry 분류와 본 라이브러리 분류 차) **검증 필요** |
| **Proposed** | **13** | Tier C에 9종 포함 (`gamepad`, `clipboard-read/write`, `speaker-selection`, `deferred-fetch`, `language-model`, `language-detector`, `summarizer`, `translator`, `writer`, `rewriter`, `autofill` 11종) | 11 | Proposed 13 중 2종(`manual-text` 등)은 보안성 낮음 → Tier D off-list |
| **Experimental** | **16** | Tier C에 7종 포함 (`local-fonts`, `unload`, `browsing-topics`, `captured-surface-control`, `smart-card`, `all-screens-capture`) | 6 | Experimental 16 중 OT 종료 미진입/Privacy Sandbox 광고 항목은 Tier D off-list |
| **Retired** | **2** | 의도적 제외 (`document-domain`, `window-placement`) | 0 | `window-management`로 rename된 신규 키만 Tier B emit |
| **off-registry** (Chromium intent / IWA 전용 / WICG draft) | — | Tier D — `(string & {})` union 폴백으로 사용자 명시 추가 가능, 본 라이브러리 default 미포함 | 0 | `controlled-frame`, `device-attributes`, `on-device-speech-recognition`, `deferred-fetch-minimal` 등 |

> **registry 카운트 검증 절차**: `test/permissions-policy-registry-sync.test.ts`가 weekly `webappsec-permissions-policy/features.md` fetch → table 파싱 → 본 라이브러리 union과 diff. drift 발견 시 PR auto-create (OWASP sync 패턴 동일). 위 표의 "검증 필요" 항목은 첫 sync 실행 시 정확한 분포 확정.

### Tier A (Universal — 모든 엔진 supported, 6)

`*-credentials-get`/`*-credentials-create` 계열. Firefox/Chromium/Safari 모두 헤더 파싱 (실제 enforcement는 엔진별).

| 피처 | 기본값 | 출처 |
|---|---|---|
| `publickey-credentials-get` | `()` | Standardized (registry) |
| `publickey-credentials-create` | `()` | Proposed (WebAuthn-3) |
| `identity-credentials-get` | `()` | Standardized |
| `digital-credentials-get` | `()` | Experimental |
| `digital-credentials-create` | `()` | Experimental |
| `otp-credentials` | `()` | Standardized |

### Tier B (Chromium + Firefox parsed, 35)

W3C registry **Standardized** 섹션에서 Universal 6종을 제외한 나머지. Firefox는 헤더를 받아들이며 일부 directive name을 인식.

`accelerometer`, `ambient-light-sensor`, `attribution-reporting`, `autoplay`, `battery`, `bluetooth`, `camera`, `compute-pressure`, `cross-origin-isolated`, `direct-sockets`, `display-capture`, `encrypted-media`, `execution-while-not-rendered`, `execution-while-out-of-viewport`, `fullscreen`, `geolocation`, `gyroscope`, `hid`, `idle-detection`, `keyboard-map`, `magnetometer`, `mediasession`, `microphone`, `midi`, `navigation-override`, `payment`, `picture-in-picture`, `screen-wake-lock`, `serial`, `storage-access`, `sync-xhr`, `usb`, `web-share`, `window-management`, `xr-spatial-tracking`

기본값: 모두 `()` (완전 비활성). 예외: `sync-xhr=(self)` (OWASP 공식값, 레거시 라이브러리 호환).

> **registry 정정 (vs 기존 plan)**: `gamepad`는 W3C registry **Proposed** 섹션 — Tier C로 이동. `battery`/`direct-sockets`/`mediasession`/`navigation-override`/`execution-while-not-rendered`/`execution-while-out-of-viewport`는 registry **Standardized** — 기존 "unimplemented/cancelled" 사유로 제외했으나 잘못, Tier B에 포함. `direct-sockets`는 IWA 전용이지만 매우 강력(raw TCP/UDP)하므로 default-deny 가치 큼.

### Tier C (Chromium-only stable, Proposed 13 + Experimental shipped 일부)

W3C registry **Proposed** 섹션 + **Experimental**에서 Chromium stable shipped.

| 피처 | 기본값 | registry | Chrome | 비고 |
|---|---|---|---|---|
| `gamepad` | `()` | Proposed | 86+ | (registry 정정으로 Tier C 이동) |
| `clipboard-read` | `()` | Proposed | 86+ | |
| `clipboard-write` | `()` | Proposed | 86+ | |
| `local-fonts` | `()` | Experimental | 103+ | Local Font Access API |
| `unload` | `()` | Experimental | 117+ | OWASP 2026 공식 포함 |
| `browsing-topics` | `()` | Experimental | 115+ | Topics API. **`interest-cohort` 후계자**, FLoC 2022 폐기 |
| `captured-surface-control` | `()` | Experimental | 122+ OT | Conditional Focus |
| `smart-card` | `()` | Experimental | 134+ OT | IWA |
| `speaker-selection` | `()` | Proposed | 미구현 | Speaker Selection API (selectAudioOutput) |
| `all-screens-capture` | `()` | Experimental | OT | Multi-screen capture |
| `deferred-fetch` | `()` | Proposed | 130+ | Fetch Later API. spec default `self` (5MB quota) |
| `language-model` | `()` | Proposed | 138+ | Built-in AI Prompt API |
| `language-detector` | `()` | Proposed | 138+ stable | Built-in AI Language Detector |
| `summarizer` | `()` | Proposed | 138+ stable | Built-in AI Summarizer |
| `translator` | `()` | Proposed | 138+ stable | Built-in AI Translator |
| `writer` | `()` | Proposed | 138+ | Built-in AI Writer |
| `rewriter` | `()` | Proposed | 138+ | Built-in AI Rewriter |
| `autofill` | `()` | Proposed | 미구현 | 인증/credential 보호 벡터 (embedded contexts) |

### Tier D (Origin Trial / Experimental / off-registry, 신중 검토 후 선택 활성)

기본 비포함 — 사용자가 features map에 직접 추가 (`PermissionsPolicyFeature` union의 `(string & {})` 폴백).

- `controlled-frame` — IWA 전용, **W3C registry 외**, chromestatus만
- `deferred-fetch-minimal` — MDN/chromestatus, registry 외(Issue #544)
- `device-attributes` — Chrome 신규 (Feb 2026 intent), registry 외
- `on-device-speech-recognition` — Chrome 신규, registry 외
- `manual-text` — Proposed (registry), 비보안 영역
- `conversion-measurement`, `focus-without-user-activation`, `monetization`, `sync-script`, `vertical-scroll`, `trust-token-redemption`, `join-ad-interest-group`, `run-ad-auction` — Privacy Sandbox/광고/niche
- `private-state-token-issuance`, `private-state-token-redemption`, `shared-storage`, `shared-storage-select-url`, `private-aggregation` — Privacy Sandbox 광고

### 의도적 제외

| 항목 | 사유 |
|---|---|
| `interest-cohort` | FLoC 2022 폐기, registry에서 완전 삭제(Retired 표 아님). `browsing-topics`로 대체 |
| `document-domain` | W3C registry **Retired**. `document.domain` setter 자체 폐기 경로 |
| `window-placement` | **Retired**. `window-management`(Tier B)로 이름 변경 |
| `ch-ua-*` (11종) | Standardized이나 Client Hints 영역, `Accept-CH`/`Critical-CH`로 처리 |

> **DX 참고**: 일반 사용자는 Default(Tier A+B 비활성)를 그대로 사용. 특정 피처만 허용: `permissionsPolicy: { features: { camera: ['self'], microphone: ['self'] } }`. 명시 안 한 피처는 기본값 `()` 유지.

## 의도적 제외 헤더

| 제외 | 사유 |
|---|---|
| CORS 헤더 | `@zipbul/cors` 담당 |
| Access-Control-Allow-Private-Network | CORS 확장 → `@zipbul/cors` |
| Set-Cookie 속성 | 세션 미들웨어. 본 라이브러리 README는 RFC 6265bis-22 prefix(`__Host-`/`__Secure-`) 권장만 명시 |
| Sec-Fetch-* | 요청 헤더 |
| Client Hints (Accept-CH, Critical-CH 등) | 콘텐츠 협상/신뢰성, 보안 정책 아님 |
| WebSocket 헤더 | 프로토콜 레벨 |
| HTTP Signatures (RFC 9421) | API/서비스 간 통신, 브라우저 보안 아님 |
| Content-Digest / Repr-Digest (RFC 9530) | API 무결성 |
| Privacy Sandbox 광고 헤더 (Observe-Browsing-Topics 등) | 광고 측정, 본 라이브러리 범위 외 |
| Set-Login, IdP-SignIn-Status (FedCM) | IdP 전용, niche |
| Activate-Storage-Access | Storage Access API 응답 (action) |
| Service-Worker-Allowed, Service-Worker-Navigation-Preload | 앱 기능, 보안 아님 |
| Speculation-Rules | 성능, 보안 아님. CSP `'inline-speculation-rules'` 키워드만 본 라이브러리 `Csp` 상수에 포함 |
| Web Bundles / Signed Exchanges (Signature, Signed-Headers) | 패키징, 비표준 진행중 |
| No-Vary-Search | 캐시 키 |
| Use-As-Dictionary / Available-Dictionary (RFC 9842) | Compression Dictionary, same-origin 강제 |
| Alt-Svc / Alt-Used / Early-Data | 전송 인프라 |
| Content-Disposition | 라우트별 결정 |
| X-UA-Compatible | IE 폐기 |
| Supports-Loading-Mode | 성능 opt-in |
| Cookie-Indices (현재 미존재) / draft-ietf-httpbis-layered-cookies-01 | 쿠키 영역 |
| **Feature-Policy** | Permissions-Policy로 대체 |
| **Expect-CT** | 폐기 (Chrome 107) |
| **HPKP (Public-Key-Pins)** | 폐기 (Chrome 72, Firefox 72) |
| **DNT** | 폐기 (Firefox 135 토글 제거) |
| **Sec-GPC** | 요청 헤더 |
| **Origin-Isolation** | 폐기, `Origin-Agent-Cluster`로 대체 |
| **`Report-To` (legacy 헤더)** | Reporting API ED 2026-01-02에서 제거. 단 NEL이 여전히 의존 → NEL 활성 시 reporting 모듈에서 자동 생성 |
| Take It Down Act / OSA / OFAC 관련 | 표준 HTTP 헤더 미존재 |

## 옵션 구조

각 헤더: `true`(기본값) / `false`(비활성) / 문자열 또는 객체(커스텀). 모든 `boolean | string` 타입에 `@defaultValue` JSDoc + `@example` + `@see` 필수.

### CSP 디렉티브 커스터마이징 전략: Replace

사용자가 특정 디렉티브를 설정하면 해당 디렉티브의 기본값을 **완전히 교체**(replace), 병합 안 함.

```typescript
// CSP 기본값: default-src 'self'가 모든 fetch 디렉티브에 fallback
// Google Fonts 사용 시 fontSrc 명시
Helmet.create({
  contentSecurityPolicy: {
    directives: { fontSrc: [Csp.Self, 'https://fonts.gstatic.com'] }
  }
});

// 인라인 SVG/data: URI 이미지
Helmet.create({
  contentSecurityPolicy: {
    directives: { imgSrc: [Csp.Self, 'data:'] }
  }
});
```

설정 안 한 디렉티브는 기본값 유지. 설정한 디렉티브만 교체.

### CSP 직렬화 / 검증 규칙

- **직렬화**: 디렉티브명 lowercase, 디렉티브 구분자 `;` (trailing 없음), 소스 구분자 single ASCII space
- **소스 dedup**: 동일 디렉티브 내 중복 제거 (키워드/quoted-source case-sensitive, scheme/host case-insensitive)
- **빈 fetch directive 배열** (`scriptSrc: []`): validate 거부 — fetch는 최소 1개 소스 필요. `'none'` 명시 안내
- **빈 sandbox 배열** (`sandbox: []`): bare `sandbox` 디렉티브로 직렬화 (모든 sandbox 토큰 적용 = 가장 제한적)
- **소스 표현 검증**:
  - 키워드(`'self'`, `'none'`, `'unsafe-inline'`, ...) 따옴표 필수. 따옴표 없는 키워드(`self`, `none`) 감지 시 에러 + `Csp.Self` 사용 안내
  - scheme-source 정규식: `^[a-zA-Z][a-zA-Z0-9+\-.]*:$` (linear, ReDoS-safe)
  - host-source 정규식: scheme(optional) + host(`*` | `*.\w+` | `\w+`) + port(optional) + path(optional). **CI gate**: `recheck` 또는 `safe-regex2`로 정규식 catastrophic backtracking 검증. 입력 길이 상한 2048자
  - **nonce 값** (CSP3 §2.3.1 nonce-source ABNF: `base64-value = 1*(ALPHA / DIGIT / "+" / "/" / "-" / "_") *2"="`):
    - 정규식: `^[A-Za-z0-9+/_-]{16,256}={0,2}$` — `=`를 끝에만 허용 (mid-string 거부), 16자 하한(128bit) + 256자 상한(DoS 방지)
    - base64-std(`+/`)와 base64url(`-_`) 혼용 거부 (단일 alphabet 강제)
    - 거부 문자: `'`, `"`, `\`, `<`, `>`, `;`, ` `(0x20), 모든 C0 controls(U+0000-U+001F NUL/CR/LF 등), DEL(U+007F), Unicode whitespace(U+00A0 NBSP, U+2028 LINE-SEP, U+2029 PARA-SEP, U+FEFF BOM)
  - hash 값 길이: sha256=44, sha384=64, sha512=88 (base64 with padding). 동일 charset/제어문자 정책 적용
  - **헤더 이름 정규화**: HTTP/2/3은 lowercase 강제. `applyHeadersTo()` / `apply()`는 emit 직전 `toLowerCase()` 보장
- **상호 작용 경고** (warn, not error — `helmet.warnings`에 누적):
  - `'unsafe-inline'` + nonce/hash 동시 → 브라우저가 nonce/hash 우선이라 `'unsafe-inline'` 무시 (CSP3 §6.7.3)
  - `'unsafe-eval'` + `'wasm-unsafe-eval'` 동시 → 후자 redundant
  - `default` Trusted Types policy-name 사용 → 모든 sink-side string에 적용되는 default policy 위험성
  - COOP `same-origin` + COEP **OFF** → `crossOriginIsolated` false. SAB/멀티스레드 WASM 미동작
  - Reporting-Endpoints `default` endpoint 누락 → CSP/COOP/COEP `report-to` 미지정 시 fallback 안 됨
  - Permissions-Policy features map 키가 `PermissionsPolicyFeature` union에 없으면 (registry 외 또는 오타)
  - Clear-Site-Data `prefetchCache`/`prerenderCache` 비표준 토큰
  - sandbox 디렉티브 in Report-Only → 브라우저가 무시 (CSP3 명시)
  - `'unsafe-allow-redirects'` 사용 → 종속 디렉티브 `navigate-to`가 CSP3에서 제거되어 effective dead grammar
- **frame-ancestors 제약**: `'unsafe-inline'`, `'unsafe-eval'`, `'strict-dynamic'`, `'unsafe-hashes'`, nonce, hash 거부 (CSP3 §6.4.2). `'self'`, `'none'`, scheme/host-source만 허용
- **폐기 디렉티브 거부 (validate 에러)**:
  - `prefetch-src` (Chromium 112 제거, CSP3 미포함)
  - `plugin-types` (CSP3 제거)
  - `block-all-mixed-content` (CSP3 deprecated, `upgrade-insecure-requests` 사용)
  - `referrer` (CSP1, `Referrer-Policy` 헤더로 대체)
  - `reflected-xss` (CSP1, legacy)
  - `navigate-to` (CSP3 제거)
- **fetch fallback chain 검증** (CSP3 §6.1, §6.6):
  - `script-src-elem`/`-attr` → `script-src` → `default-src`
  - `frame-src` → `child-src` → `default-src`
  - `worker-src` → `child-src` → `script-src` → `default-src`
  - `style-src-elem`/`-attr` → `style-src` → `default-src`
  - `manifest-src`는 `default-src`로 fallback 안 됨 — 사용자가 manifest fetch + default-src만 설정 시 warn
- **Report-Only 제약**: `sandbox` 디렉티브는 Report-Only에서 무시됨 → warn. `frame-ancestors`, `upgrade-insecure-requests`는 honor (CSP3)
- **report-to 값**: `Reporting-Endpoints` token name. 정규식 `^[A-Za-z0-9_-]+$`로 검증
- **report-uri 값**: 공백 구분 URI 리스트 (CSP3 deprecated이나 사양 잔존). WHATWG URL 절대 URL 또는 path-relative URI 파싱 가능. 빈 문자열, 잘못된 URL, javascript: 등 비-fetch 스킴 거부
- **Trusted Types** (W3C ED 2026-02-24 §4.2):
  - `requireTrustedTypesFor`: `'script'` 토큰 1개만
  - `trustedTypes`: policy-name 정규식 `^[A-Za-z0-9\-#=_/@.%]+$` 또는 `'allow-duplicates'` / `'none'` / `*`
  - **`default` 정책 이름**: 예약어. `createPolicy()` 시 이름 미지정 default policy. validator는 사용 시 warn (보안적으로 default 정책은 모든 sink-side string에 적용)
  - 빈 `trustedTypes;` 디렉티브는 유효 (`'none'`과 동등)
  - **report-to group name vs Trusted Types policy-name**: report-to group `^[A-Za-z0-9_-]+$`(짧은 token), policy-name `^[A-Za-z0-9\-#=_/@.%]+$`(특수문자 포함) — validator 분리
  - Firefox 148 stable shipped (2026-02-24, unflagged) — Chromium/Safari/Firefox 모두 enforcement
- **Hash Reporting** (CSP3 ED §2.3.1): `'report-sha256'`/`'-sha384'`/`'-sha512'` 키워드는 매칭이 아니라 매칭에 사용된 hash를 `report-to` endpoint에 송출하라는 지시. `Csp.ReportSha256` 등 상수로 노출
- **Strict CSP 권장 패턴** (JSDoc 문서화, 자동 적용 X):

  ```typescript
  scriptSrc: [Csp.nonce(nonce), Csp.StrictDynamic, "'unsafe-inline'", 'https:']
  // - 'nonce-X' + 'strict-dynamic': 모던 브라우저
  // - 'unsafe-inline': nonce/hash 미지원 구형 브라우저 fallback (모던에서는 nonce에 의해 무시)
  // - https: : 'strict-dynamic' 미지원 구형 브라우저 fallback
  ```

- **A11y / 접근성 영향**: `'unsafe-inline'` 미허용 + nonce/hash strict CSP는 일부 a11y 도구(axe-core inline injection, 스크린 리더 북마클릿, NVDA browse-mode) 동작을 방해할 수 있음. CI에서 a11y 테스트 시 `presets.api()` 또는 사용자 정의 CSP-Report-Only로 영향 측정 후 적용 권장

- **Default-src override 주의**: 사용자가 `scriptSrc`만 override 시 `default-src 'self'` fallback 적용 안 됨(스펙). nonce 사용 시 `scriptSrc`/`styleSrc` 둘 다 명시 권장
- **Service Worker + CSP**: SW는 페이지 CSP를 약화/override 불가. SW 내부 fetched scripts는 SW 자체 CSP(SW script response time)에 종속

### CSP-violation report 형식

- **Legacy `application/csp-report`** (CSP2): kebab-case (`blocked-uri`, `violated-directive`, `original-policy`, `disposition`, `effective-directive`, `referrer`, `status-code`, `source-file`, `line-number`, `column-number`)
- **Reporting API `application/reports+json`** v1: camelCase (`blockedURL`, `effectiveDirective`, `disposition`, `documentURL`, `referrer`, `sample`, `statusCode`)
- `Helmet.parseCspReport(req)`는 양쪽 포맷을 정규화한 typed union 반환
- **입력 검증 (DoS / pollution 방어)**:
  - **Content-Type 화이트리스트**: `application/csp-report`, `application/reports+json`만 수락. 그 외 (`text/plain`, `application/json` 등)는 `HelmetError(UnsupportedCspReportContentType)` throw — Reporting API 스펙 §3.4 enforcement
  - **본문 크기 상한**: 64KB. 초과 시 `HelmetError(CspReportTooLarge)` throw. `request.body` ReadableStream을 chunked read하며 누적 크기 추적 — 전체 buffer 후 크기 검사하면 DoS
  - **단일 보고서 객체 수 상한**: `reports+json`은 배열 — 항목 ≤ 100. 초과 시 truncate + 첫 100개만 반환 (선택적으로 `TooManyReports` warning)
  - **JSON parse 실패**: `HelmetError(InvalidCspReport)` — raw 입력 echo 금지 (`message`는 길이만 노출)
  - **prototype pollution**: parsed 객체는 `Object.create(null)`로 재구성 후 known field만 복사. `__proto__`/`constructor`/`prototype` 키 무시
  - **URL 필드 sanitize**: `blockedURL`/`documentURL`/`source-file`은 WHATWG URL 파서 통과 시만 보존, 실패 시 raw string으로 보존하되 length ≤ 2048 truncate
  - **타임아웃**: body read는 10초 timeout (`AbortController`로 wrap). 초과 시 `HelmetError(CspReportTimeout)`
  - body는 1회 소비 — 호출자가 재사용 필요 시 `request.clone()` 후 전달

### Permissions-Policy 직렬화 규칙

- **RFC 9651 Structured Field Dictionary** 형식
- 빈 features map (`{}`) → 헤더 송출 생략 (빈 SF Dictionary는 invalid)
- Allowlist 직렬화:
  - `[]` → `feature=()` (none)
  - `['*']` → `feature=*` (all, bare token)
  - `['self']` → `feature=(self)` (bare token, **따옴표 없음**)
  - `['self', 'https://x.com']` → `feature=(self "https://x.com")` (origin은 sf-string으로 double-quoted)
- 검증 (보안 강화):
  - **WHATWG URL parse-and-reserialize 강제**: `new URL(input).origin` 추출 → `origin === "null"` 거부, scheme이 `https:`/`http:`이 아닌 경우 거부, userinfo/path/query/fragment 제거. 단순 regex/문자열 split 사용 금지 (sf-string injection 벡터)
  - **sf-string escape 명시 (RFC 9651 §3.3.3)**: `"` → `\"`, `\` → `\\`. 다른 문자는 escape 미허용 (RFC 9651는 매우 제한적). 출력 문자열에 raw `"` / `\` 잔존 시 emit 거부 (assertion failure)
  - `self`, `*`는 bare token으로만 송출. 다른 키워드는 spec 위반 → 에러
  - 잘못된 입력(`'self'` quoted, raw URL 등) 감지 시 자동 보정 + warn 또는 validate 에러
  - **map 키 prototype 보호**: `features` map은 내부적으로 `Object.create(null)` 또는 `Map` 사용. `__proto__`, `constructor`, `prototype` 키 거부 + `HelmetError(InvalidPermissionsPolicyToken)`

### Nonce 주입 규칙

`headers({ nonce })` / `headersRecord({ nonce })` / `apply(response, { nonce })` 호출 시:

- `script-src`에 `'nonce-{value}'` 주입
- `style-src`에 `'nonce-{value}'` 주입
- 사용자가 명시 설정한 `script-src-elem`, `style-src-elem`, `script-src-attr`, `style-src-attr`에도 주입
- 명시 설정 안 한 `-elem`/`-attr` 변형에는 주입 X (fallback으로 `script-src`/`style-src` 적용)
- `Content-Security-Policy-Report-Only` 설정 시 동일 규칙 (모니터링 정확성)
- nonce 주입 시 CSP/CSP-RO만 재생성, 나머지 캐시 반환

### TypeScript 타입

```typescript
// Branded types (충돌 방지)
type Nonce = string & { readonly __brand: 'Nonce' };
type EndpointName = string & { readonly __brand: 'EndpointName' };
type HttpsUrl = `https://${string}`;

/**
 * resolveHelmetOptions 결과 — `HelmetOptions` 정규화 + 모든 default 채워짐 + deep-readonly.
 * 내부 representation은 사용자 입력과 다름:
 * - features map / endpoints map / policies map은 `Map<...>` 또는 `Object.create(null)`
 * - boolean true/false는 명시 객체로 확장
 * - kebab-case 디렉티브 키로 정규화 (camelCase 입력 → kebab-case)
 * - 사용자 미설정 디렉티브는 OWASP default로 채워짐 (CSP)
 * helmet.toJSON()이 이 형태를 반환 (deep-readonly).
 */
type ResolvedHelmetOptions = DeepReadonly<{
  contentSecurityPolicy: ResolvedCspOptions | false;
  contentSecurityPolicyReportOnly: ResolvedCspOptions | undefined;
  crossOriginOpenerPolicy: CoopValue | false;
  crossOriginOpenerPolicyReportOnly: CoopValue | undefined;
  crossOriginEmbedderPolicy: CoepValue | false;
  crossOriginEmbedderPolicyReportOnly: CoepValue | undefined;
  crossOriginResourcePolicy: CorpValue | false;
  originAgentCluster: boolean;
  permissionsPolicy: ResolvedPermissionsPolicyOptions | false;
  permissionsPolicyReportOnly: ResolvedPermissionsPolicyOptions | undefined;
  referrerPolicy: ReferrerPolicyToken[] | false;
  strictTransportSecurity: ResolvedHstsOptions | false;
  xContentTypeOptions: boolean;
  xDnsPrefetchControl: 'on' | 'off' | false;
  xFrameOptions: 'deny' | 'sameorigin' | 'DENY' | 'SAMEORIGIN' | false;
  xPermittedCrossDomainPolicies: 'none' | 'master-only' | 'by-content-type' | 'all' | false;
  reportingEndpoints: ResolvedReportingEndpointsOptions | undefined;
  integrityPolicy: ResolvedIntegrityPolicyOptions | false | undefined;
  integrityPolicyReportOnly: ResolvedIntegrityPolicyOptions | undefined;
  clearSiteData: ResolvedClearSiteDataOptions | false | undefined;
  cacheControl: ResolvedCacheControlOptions | false | undefined;
  nel: ResolvedNelOptions | undefined;
  documentPolicy: ResolvedDocumentPolicyOptions | undefined;
  documentPolicyReportOnly: ResolvedDocumentPolicyOptions | undefined;
  requireDocumentPolicy: ResolvedDocumentPolicyOptions | undefined;
  documentIsolationPolicy: 'isolate-and-require-corp' | 'isolate-and-credentialless' | 'none' | undefined;
  documentIsolationPolicyReportOnly: 'isolate-and-require-corp' | 'isolate-and-credentialless' | 'none' | undefined;
  timingAllowOrigin: string[] | undefined;
  xRobotsTag: ResolvedXRobotsTagOptions | false | undefined;
  xDownloadOptions: boolean;
  xXssProtection: '0' | '1; mode=block' | false;
  removeHeaders: ResolvedRemoveHeadersOptions;
  messageFormatter: HelmetOptions['messageFormatter'];
}>;

/** 깊은 readonly 변환 유틸 */
type DeepReadonly<T> = T extends (...args: any[]) => any
  ? T
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

interface HelmetOptions {
  // ── Default-ON (11) ──
  /** @defaultValue 위 CSP 기본값 설계 근거 참조 */
  contentSecurityPolicy?: boolean | ContentSecurityPolicyOptions;
  /** @defaultValue 'same-origin' */
  crossOriginOpenerPolicy?: boolean | CoopValue;
  /** @defaultValue 'same-origin' */
  crossOriginResourcePolicy?: boolean | CorpValue;
  /**
   * sf-boolean (RFC 9651). `true` → `?1` (origin-keyed agent cluster opt-in).
   * `false` → `?0` (site-keyed opt-out). Chromium origin-keyed default 2025+.
   * @defaultValue true (`?1`)
   */
  originAgentCluster?: boolean;
  /** @defaultValue Tier A+B 비활성, sync-xhr=(self) */
  permissionsPolicy?: boolean | PermissionsPolicyOptions;
  /** @defaultValue 'no-referrer'. ACSC ISM-1788 호환은 `presets.acsc()` 사용 */
  referrerPolicy?: boolean | ReferrerPolicyToken | ReferrerPolicyToken[];
  /** @defaultValue { maxAge: 63072000, includeSubDomains: true } */
  strictTransportSecurity?: boolean | StrictTransportSecurityOptions;
  /** @defaultValue 'nosniff' */
  xContentTypeOptions?: boolean;
  /** @defaultValue 'off' */
  xDnsPrefetchControl?: boolean | 'on' | 'off';
  /**
   * 입력은 case-insensitive, 출력은 입력 case 그대로 송출 (WAF 호환).
   * @defaultValue 'deny' (소문자 OWASP 정규형)
   */
  xFrameOptions?: boolean | 'deny' | 'sameorigin' | 'DENY' | 'SAMEORIGIN';
  /** @defaultValue 'none' */
  xPermittedCrossDomainPolicies?: boolean | 'none' | 'master-only' | 'by-content-type' | 'all';

  // ── Default-OFF (opt-in, 22) ──
  /** @defaultValue 'require-corp' (활성 시). Safari `credentialless` 미지원 */
  crossOriginEmbedderPolicy?: boolean | CoepValue;
  contentSecurityPolicyReportOnly?: ContentSecurityPolicyOptions;
  crossOriginOpenerPolicyReportOnly?: CoopValue;
  crossOriginEmbedderPolicyReportOnly?: CoepValue;
  permissionsPolicyReportOnly?: PermissionsPolicyOptions;
  reportingEndpoints?: ReportingEndpointsOptions;
  integrityPolicy?: boolean | IntegrityPolicyOptions;
  integrityPolicyReportOnly?: IntegrityPolicyOptions;
  clearSiteData?: boolean | ClearSiteDataOptions;
  cacheControl?: boolean | CacheControlOptions;
  nel?: NelOptions;
  documentPolicy?: DocumentPolicyOptions;
  documentPolicyReportOnly?: DocumentPolicyOptions;
  requireDocumentPolicy?: DocumentPolicyOptions;
  documentIsolationPolicy?: 'isolate-and-require-corp' | 'isolate-and-credentialless' | 'none';
  documentIsolationPolicyReportOnly?: 'isolate-and-require-corp' | 'isolate-and-credentialless' | 'none';
  timingAllowOrigin?: string | string[];
  xRobotsTag?: boolean | XRobotsTagOptions;
  /** @defaultValue 'noopen' (IE EOL — v2.0 제거 후보) */
  xDownloadOptions?: boolean;
  /** @defaultValue '0'. KISA 호환은 `presets.kisa()` ('1; mode=block') */
  xXssProtection?: boolean | '0' | '1; mode=block';

  // ── 헤더 제거 ──
  removeHeaders?: boolean | 'owasp' | RemoveHeadersOptions;

  // ── i18n 훅 (deferred contract) ──
  /**
   * 검증 메시지 포매터. ESL 사용자 / 다국어 필요 시 활용.
   * - 미설정: 영문 default message + reason enum
   * - 설정: `(reason, ctx) => translatedMessage` — reason enum이 i18n 키 역할
   * 라이브러리 자체는 i18n 파이프라인 미내장.
   *
   * **호출 시멘틱 (보안)**:
   * - 사용자 함수는 `try/catch`로 wrap. throw 시 영문 default 메시지로 fallback + `HelmetWarning(MessageFormatterFailed)` 누적
   * - 반환값이 `string`이 아니면 (undefined / null / 객체) 동일 fallback
   * - validate 자체는 fallback 후 정상 진행 — 사용자 함수 결함이 라이브러리 검증을 마비시키지 않음
   * - **사용자 함수에 raw user input은 전달 안 함** — `context.path`는 구조 경로(`scriptSrc[2]`), `context.meta`는 길이/인덱스만. echo injection 방지
   * - 동기 함수만 허용 — Promise 반환 시 fallback (validate 동기 보장 위해)
   * - 호출 횟수 상한: violation 1건당 1회. messageFormatter가 의도적으로 felony loop를 만들 수 없음
   */
  messageFormatter?: (reason: HelmetErrorReason | HelmetWarningReason, context: { path: string; meta?: unknown }) => string;
}

// 공통 sub-union 추출 (DRY)
type CoopValue = 'same-origin' | 'same-origin-allow-popups' | 'noopener-allow-popups' | 'unsafe-none';
type CorpValue = 'same-origin' | 'same-site' | 'cross-origin';
type CoepValue = 'require-corp' | 'credentialless' | 'unsafe-none';
```

### 서브 옵션 인터페이스

```typescript
interface ContentSecurityPolicyOptions {
  directives?: CspDirectives;
}

interface CspDirectives {
  // ── Fetch 디렉티브 (17) ──
  defaultSrc?: CspSource[];
  childSrc?: CspSource[];
  connectSrc?: CspSource[];
  fencedFrameSrc?: CspSource[];   // WICG Fenced Frame draft (CSP3 ED 외)
  fontSrc?: CspSource[];
  frameSrc?: CspSource[];
  imgSrc?: CspSource[];
  manifestSrc?: CspSource[];      // default-src로 fallback 안 됨
  mediaSrc?: CspSource[];
  objectSrc?: CspSource[];
  scriptSrc?: CspSource[];
  scriptSrcAttr?: CspSource[];
  scriptSrcElem?: CspSource[];
  styleSrc?: CspSource[];
  styleSrcAttr?: CspSource[];
  styleSrcElem?: CspSource[];
  workerSrc?: CspSource[];

  // ── Document (2) ──
  baseUri?: CspSource[];
  sandbox?: SandboxToken[];

  // ── Navigation (2) ──
  formAction?: CspSource[];
  frameAncestors?: CspSource[];

  // ── Reporting (2) ──
  reportTo?: string;              // Reporting-Endpoints 키 이름 (URL 아님)
  reportUri?: string;             // CSP3 deprecated이나 잔존 (Safari 일부 의존)

  // ── WebRTC (1, CSP3 신규) ──
  webrtc?: 'allow' | 'block';

  // ── 기타 ──
  upgradeInsecureRequests?: boolean;
  /** Trusted Types W3C ED §4.2 */
  requireTrustedTypesFor?: TrustedTypesRequireToken[];
  /** Trusted Types W3C ED §4.2 (policy-name regex 별도) */
  trustedTypes?: TrustedTypesToken[];
}

/**
 * CSP3 ED §2.3.1 keyword-source ABNF + URL/scheme/host expressions.
 * Template literal union으로 컴파일 타임에 따옴표 누락 + scheme/host 형태 강제.
 */
type CspKeywordSource =
  | "'self'" | "'none'" | "'unsafe-inline'" | "'unsafe-eval'"
  | "'strict-dynamic'" | "'unsafe-hashes'" | "'report-sample'"
  | "'wasm-unsafe-eval'" | "'inline-speculation-rules'"
  | "'unsafe-webtransport-hashes'"
  | "'report-sha256'" | "'report-sha384'" | "'report-sha512'";
type CspNonceSource = `'nonce-${string}'`;
type CspHashSource = `'sha256-${string}'` | `'sha384-${string}'` | `'sha512-${string}'`;
type CspSchemeSource = `${string}:`;
type CspHostSource = `https://${string}` | `http://${string}` | `wss://${string}` | `ws://${string}`;
type CspSource =
  | CspKeywordSource
  | CspNonceSource
  | CspHashSource
  | CspSchemeSource
  | CspHostSource
  | '*'
  | (string & {});

type TrustedTypesRequireToken = "'script'";
type TrustedTypesToken = "'allow-duplicates'" | "'none'" | '*' | (string & {});

/**
 * HTML Standard §iframe sandboxing 13 토큰 (canonical) + Storage Access API 확장 1 토큰 = 14 허용.
 * CSP3 ED §6.3.2 sandbox는 HTML iframe sandbox 토큰 집합을 그대로 참조.
 * `allow-storage-access-by-user-activation`은 HTML core 외, Storage Access API 스펙 확장 (Chromium/Safari 지원).
 */
type SandboxToken =
  | 'allow-downloads'
  | 'allow-forms'
  | 'allow-modals'
  | 'allow-orientation-lock'
  | 'allow-pointer-lock'
  | 'allow-popups'
  | 'allow-popups-to-escape-sandbox'
  | 'allow-presentation'
  | 'allow-same-origin'
  | 'allow-scripts'
  | 'allow-storage-access-by-user-activation'  // Storage Access API extension
  | 'allow-top-navigation'
  | 'allow-top-navigation-by-user-activation'
  | 'allow-top-navigation-to-custom-protocols';

interface StrictTransportSecurityOptions {
  /** default: 63072000 (2년, Mozilla 권장) */
  maxAge?: number;
  /** default: true */
  includeSubDomains?: boolean;
  /**
   * default: false. **RFC 6797 비표준** (hstspreload.org 컨벤션).
   * `true` 설정 시 validate가 hstspreload.org 요구사항 강제:
   * - `maxAge >= 31536000` (1년)
   * - `includeSubDomains: true`
   * - 도메인은 base domain (apex)에서만 송출 권장
   * 위반 시 `HelmetError` (HstsPreloadRequirementMissing).
   */
  preload?: boolean;
}

type PermissionsPolicyFeature =
  // ── Tier A (Universal, 6) ──
  | 'publickey-credentials-get' | 'publickey-credentials-create'
  | 'identity-credentials-get' | 'digital-credentials-get' | 'digital-credentials-create'
  | 'otp-credentials'
  // ── Tier B (Chromium + Firefox parsed, 35; W3C registry Standardized 제외 Tier A 6종) ──
  | 'accelerometer' | 'ambient-light-sensor' | 'attribution-reporting' | 'autoplay'
  | 'battery' | 'bluetooth' | 'camera' | 'compute-pressure' | 'cross-origin-isolated'
  | 'direct-sockets' | 'display-capture' | 'encrypted-media'
  | 'execution-while-not-rendered' | 'execution-while-out-of-viewport'
  | 'fullscreen' | 'geolocation' | 'gyroscope' | 'hid' | 'idle-detection'
  | 'keyboard-map' | 'magnetometer' | 'mediasession' | 'microphone' | 'midi'
  | 'navigation-override' | 'payment' | 'picture-in-picture' | 'screen-wake-lock'
  | 'serial' | 'storage-access' | 'sync-xhr' | 'usb' | 'web-share'
  | 'window-management' | 'xr-spatial-tracking'
  // ── Tier C (Chromium-only stable, 18) ──
  | 'gamepad' | 'clipboard-read' | 'clipboard-write' | 'local-fonts'
  | 'unload' | 'browsing-topics'
  | 'captured-surface-control' | 'smart-card' | 'speaker-selection'
  | 'all-screens-capture' | 'deferred-fetch'
  | 'language-model' | 'language-detector' | 'summarizer' | 'translator'
  | 'writer' | 'rewriter' | 'autofill';

type PermissionsPolicyAllowlist = '*' | 'self' | HttpsUrl | (string & {});

interface PermissionsPolicyOptions {
  /**
   * features map. 입력은 `Record`이지만 내부 저장은 `Map<feature, allowlist>` — prototype pollution 방어.
   * 검증:
   * - `__proto__`, `constructor`, `prototype` 키 거부 (`HelmetError(InvalidPermissionsPolicyToken)`)
   * - feature name 길이 상한 64자, allowlist 항목 수 상한 32개 (header bloat 방지)
   * - allowlist origin은 WHATWG URL `new URL(input).origin` reserialize → `origin === "null"` / non-https 거부
   */
  features?: Partial<Record<PermissionsPolicyFeature | (string & {}), PermissionsPolicyAllowlist[]>>;
}

interface ReportingEndpointsOptions {
  /**
   * RFC 9651 Structured Field Dictionary. URL은 sf-string 따옴표.
   * 직렬화: `Reporting-Endpoints: default="https://example.com/reports", csp-endpoint="https://example.com/csp"`
   * `default` 키는 Reporting API fallback 컨벤션.
   * 검증:
   * - 모든 URL은 HTTPS 강제 (HTTP 거부, validate 에러)
   * - URL은 WHATWG URL `new URL(...)` 파싱 후 `.toString()` reserialize (raw 문자열 사용 안 함)
   * - endpoint name 정규식: `^[A-Za-z0-9_-]{1,64}$` — 길이 상한 64자
   * - 내부 저장: `Map<EndpointName, HttpsUrl>` (prototype pollution 방어)
   * - `__proto__`, `constructor`, `prototype` 키 거부
   * - 전체 endpoints 수 상한: 32개 (header bloat + DoS 방지)
   */
  endpoints: Record<string, HttpsUrl>;
}

interface IntegrityPolicyOptions {
  /**
   * RFC 9651 Structured Header Dictionary. 멤버는 Inner List of Token.
   * 직렬화: `blocked-destinations=(script style), sources=(inline), endpoints=(default csp-endpoint)`
   */
  blockedDestinations?: ('script' | 'style')[];
  /** SRI 적용 대상 소스. 현재 `inline`만 유효. 미명시 시 spec 기본값 `(inline)` 자동 적용 */
  sources?: ('inline')[];
  /** Reporting-Endpoints에 정의된 endpoint name(s). 복수 허용 (sf Inner List) */
  endpoints?: string[];
}

interface ClearSiteDataOptions {
  /**
   * W3C 표준 토큰: `cache`, `cookies`, `storage`, `executionContexts`, `clientHints`, `*`.
   * `prefetchCache`, `prerenderCache`는 Chrome 비표준 확장 — validate 경고 (에러 아님).
   * 직렬화 시 토큰은 sf-string 따옴표 (RFC 9651 List of sf-string).
   */
  directives?: ('cache' | 'cookies' | 'storage' | 'executionContexts' | 'clientHints' | 'prefetchCache' | 'prerenderCache' | '*')[];
}

interface CacheControlOptions {
  /**
   * default: `'no-store, max-age=0'` (OWASP).
   * RFC 9111 §5.2.2.5: `no-store` 단독 충분. OWASP 공식값 유지하되 사용자 단순화 가능
   */
  value?: string;
  /** HTTP/1.0 호환: Pragma: no-cache. HTTP/1.1+에서는 무시됨 */
  pragma?: boolean;
  /** HTTP/1.0 호환: Expires: 0. HTTP/1.1+에서는 Cache-Control 우선 */
  expires?: boolean;
}

interface NelOptions {
  /** Reporting-Endpoints에 정의된 endpoint name. validate에서 존재 검증 + Report-To 자동 생성 */
  reportTo: string;
  /** 정책 적용 기간 (초) */
  maxAge: number;
  includeSubdomains?: boolean;
  /**
   * 성공 응답 sampling rate (0.0–1.0). 프로덕션 권장: 0.1 (10%).
   * 미명시 시 spec default(0.0, 성공 미리포트)
   */
  successFraction?: number;
  /**
   * 실패 응답 sampling rate (0.0–1.0). 프로덕션 권장: 1.0 (모든 실패 분석 가치)
   */
  failureFraction?: number;
}

/**
 * NEL/Reporting 운영 가이드 (Reporting API L1 §4.1):
 * - reporting endpoint URL은 same-origin이거나 CORS-enabled 필수
 * - Reporting-Endpoints 헤더의 모든 endpoint URL은 HTTPS 필수
 * - NEL은 Chromium 전용 (Firefox/Safari 미수신)
 * - Reporting-Endpoints 본체는 Chromium + Firefox 149+ (2026-03-24)
 */

interface DocumentPolicyOptions {
  /**
   * RFC 9651 Dictionary. 값은 sf-item: boolean / integer / decimal / string / token / inner-list.
   * 예: `{ 'document-write': false, 'js-profiling': true, 'force-load-at-top': false }`
   *
   * 보안: 내부 저장은 `Map<string, ...>` (prototype pollution 방어).
   * `__proto__`, `constructor`, `prototype` 키 거부. policies 수 상한 64개
   */
  policies: Record<string, string | boolean | number | (string | boolean | number)[]>;
}

interface XRobotsTagOptions {
  directives?: string[];
}

interface RemoveHeadersOptions {
  /**
   * 제거할 헤더 목록 (사용자가 전체 제어 시).
   * 기본: `['Server', 'X-Powered-By', 'X-AspNet-Version', 'X-AspNetMvc-Version']` (must-strip 4종)
   * 입력은 case-insensitive — 라이브러리가 lowercase로 정규화.
   */
  headers?: string[];
  /**
   * 기본 목록에 추가로 제거할 헤더 (병합).
   * `removeHeaders: 'owasp'`로 `headers_remove.json` 70종 프리셋 사용.
   */
  additional?: string[];
}

type ReferrerPolicyToken =
  | 'no-referrer'
  | 'no-referrer-when-downgrade'
  | 'origin'
  | 'origin-when-cross-origin'
  | 'same-origin'
  | 'strict-origin'
  | 'strict-origin-when-cross-origin'
  | 'unsafe-url';

// ── CSP 키워드 상수 (타입 안전성) ──
// 키워드 따옴표 누락은 보안 구멍 — validate에서 감지 시 에러.
// CSP3 ED §2.3.1 keyword-source 전수 반영.
const Csp = {
  // 표준 키워드 (CSP3 ED §2.3.1)
  Self: "'self'",
  None: "'none'",
  UnsafeInline: "'unsafe-inline'",
  UnsafeEval: "'unsafe-eval'",
  UnsafeHashes: "'unsafe-hashes'",
  StrictDynamic: "'strict-dynamic'",
  ReportSample: "'report-sample'",
  WasmUnsafeEval: "'wasm-unsafe-eval'",
  // WebTransport 통합 (CSP3 ED §2.3.1)
  UnsafeWebTransportHashes: "'unsafe-webtransport-hashes'",
  // Speculation Rules — CSP3는 keyword-source 확장 지점만 정의, 토큰 자체는 Speculation Rules / HTML Standard
  InlineSpeculationRules: "'inline-speculation-rules'",
  // CSP Hash Reporting (CSP3 ED §2.3.1) — 매칭이 아니라 사용된 hash를 report-to endpoint에 송출 지시
  ReportSha256: "'report-sha256'",
  ReportSha384: "'report-sha384'",
  ReportSha512: "'report-sha512'",
  // 동적
  nonce: (value: string) => `'nonce-${value}'` as `'nonce-${string}'`,
  hash: (algo: 'sha256' | 'sha384' | 'sha512', value: string) =>
    `'${algo}-${value}'` as `'${typeof algo}-${string}'`,
} as const;

// 의도적 미포함 (출처 검증 후 제외):
// - 'unsafe-allow-redirects' — keyword-source 문법 잔존하나 종속 디렉티브 `navigate-to`가 CSP3 제거 → effective dead grammar
// - 'trusted-types-eval' — keyword-source의 일부이나 Trusted Types 스펙은 별도 메커니즘. 현재 브라우저 enforcement 없음

// 사용 예:
// scriptSrc: [Csp.Self, Csp.StrictDynamic]
// scriptSrc: [Csp.Self, Csp.nonce('abc123')]
// scriptSrc: [Csp.Self, Csp.InlineSpeculationRules] // <script type="speculationrules"> 사용 시
// scriptSrc: [Csp.nonce(n), Csp.StrictDynamic, Csp.ReportSha256] // hash report 활성
// requireTrustedTypesFor: [Csp.Self ❌] // 잘못 — 'script'만 허용
// requireTrustedTypesFor: ["'script'"] // 정상

// ── headers() / apply() 옵션 ──
interface HeadersOptions {
  /**
   * CSP/CSP-Report-Only nonce 주입. 두 헤더만 재생성, 나머지 캐시.
   * 권장: `Helmet.generateNonce()` (16바이트 base64url, branded `Nonce`).
   * 검증: `^[A-Za-z0-9+/=_-]{16,}$` charset, 헤더 인젝션 문자 거부.
   */
  nonce?: Nonce | string;
}
interface ApplyOptions extends HeadersOptions {}
```

## 에러 / 경고 모델

### HelmetErrorReason enum

각 모듈별 검증 에러를 enum으로 표현 (기계 판독 가능). 검증은 **fail-fast가 아닌 batched** — 모든 위반 사항을 aggregate하여 단일 `HelmetError`에 수록 (`error.violations: ViolationDetail[]`).

```typescript
enum HelmetErrorReason {
  // CSP
  InvalidCspKeyword = 'InvalidCspKeyword',
  UnquotedCspKeyword = 'UnquotedCspKeyword',
  InvalidCspScheme = 'InvalidCspScheme',
  InvalidCspHost = 'InvalidCspHost',
  InvalidCspNonceCharset = 'InvalidCspNonceCharset',
  InvalidCspHashLength = 'InvalidCspHashLength',
  EmptyFetchDirective = 'EmptyFetchDirective',
  DeprecatedCspDirective = 'DeprecatedCspDirective',     // prefetch-src, plugin-types, etc.
  InvalidFrameAncestorsKeyword = 'InvalidFrameAncestorsKeyword',
  InvalidSandboxToken = 'InvalidSandboxToken',
  InvalidTrustedTypesPolicyName = 'InvalidTrustedTypesPolicyName',
  InvalidRequireTrustedTypesToken = 'InvalidRequireTrustedTypesToken',
  InvalidReportToGroupName = 'InvalidReportToGroupName',
  InvalidReportUri = 'InvalidReportUri',
  // Permissions-Policy
  InvalidPermissionsPolicyOrigin = 'InvalidPermissionsPolicyOrigin',
  InvalidPermissionsPolicyToken = 'InvalidPermissionsPolicyToken',
  // HSTS
  HstsPreloadRequirementMissing = 'HstsPreloadRequirementMissing',
  HstsMaxAgeInvalid = 'HstsMaxAgeInvalid',
  // Reporting
  UnknownReportingEndpoint = 'UnknownReportingEndpoint',
  ReportingEndpointNotHttps = 'ReportingEndpointNotHttps',
  ReportingEndpointInvalidUrl = 'ReportingEndpointInvalidUrl',
  // Integrity-Policy
  IntegrityPolicyEmpty = 'IntegrityPolicyEmpty',
  InvalidIntegrityDestination = 'InvalidIntegrityDestination',
  // Clear-Site-Data
  InvalidClearSiteDataDirective = 'InvalidClearSiteDataDirective',
  // Headers Options
  InvalidNonceCharset = 'InvalidNonceCharset',
  NonceCallbackUnsupported = 'NonceCallbackUnsupported', // 함수형 디렉티브 (helmet 마이그레이션)
  // 기타
  ResponseBodyConsumed = 'ResponseBodyConsumed',
  OpaqueResponseUnsupported = 'OpaqueResponseUnsupported',
  // 입력 한도 / 보안
  InputTooLarge = 'InputTooLarge',                       // 배열/맵 길이 초과
  ReservedKeyDenied = 'ReservedKeyDenied',               // __proto__/constructor/prototype 등
  ControlCharRejected = 'ControlCharRejected',           // C0/DEL/Unicode WS 헤더 인젝션 방어
  TooManyViolations = 'TooManyViolations',               // violations 배열 256 초과 시 마지막 항목으로 추가
  // CSP report parsing
  UnsupportedCspReportContentType = 'UnsupportedCspReportContentType',
  CspReportTooLarge = 'CspReportTooLarge',               // 본문 64KB 초과
  InvalidCspReport = 'InvalidCspReport',                 // JSON parse 실패 / 스키마 위반
  CspReportTimeout = 'CspReportTimeout',                 // body read 10초 초과
}

interface ViolationDetail {
  reason: HelmetErrorReason;
  path: string;                      // 구조 경로만, e.g., 'contentSecurityPolicy.directives.scriptSrc[2]'
  /**
   * 사람 읽기용 메시지. **raw user input 절대 echo 금지** — log injection / HTML escape 회피 위험.
   * `path` + `reason` enum으로만 위치 식별. 사용자 입력은 길이 + 인덱스만 노출 (값 자체 X).
   */
  message: string;
  remedy?: string;
}

class HelmetError extends Error {
  readonly reason: HelmetErrorReason;
  readonly violations: readonly ViolationDetail[];
}
```

### HelmetWarning (non-fatal)

`helmet.warnings`에 누적. 기계 판독 가능한 reason + path + message.

```typescript
enum HelmetWarningReason {
  UnsafeInlineWithNonce = 'UnsafeInlineWithNonce',
  UnsafeEvalWithWasm = 'UnsafeEvalWithWasm',
  CoopWithoutCoep = 'CoopWithoutCoep',                // crossOriginIsolated unavailable
  CoopBreaksOauthPopup = 'CoopBreaksOauthPopup',      // COOP `same-origin` + popup-based OAuth detected
  ReportingDefaultEndpointMissing = 'ReportingDefaultEndpointMissing',
  UnknownPermissionsPolicyFeature = 'UnknownPermissionsPolicyFeature',
  NonStandardClearSiteDataToken = 'NonStandardClearSiteDataToken',
  SandboxInReportOnly = 'SandboxInReportOnly',
  UnsafeAllowRedirectsDeadGrammar = 'UnsafeAllowRedirectsDeadGrammar',
  TrustedTypesDefaultPolicy = 'TrustedTypesDefaultPolicy',
  ManifestSrcNoFallback = 'ManifestSrcNoFallback',
  SelfDoesNotMatchWebSocketScheme = 'SelfDoesNotMatchWebSocketScheme',  // connectSrc 'self' but no wss: host
  ApplyOnSwitchingProtocols = 'ApplyOnSwitchingProtocols',              // apply() on 101 — headers ignored
  // Migration warnings (fromHelmetOptions)
  HelmetUseDefaultsIgnored = 'HelmetUseDefaultsIgnored',                // helmet `useDefaults: false` 무시
  HelmetXFrameOptionsDefaultTightened = 'HelmetXFrameOptionsDefaultTightened', // helmet SAMEORIGIN → zipbul deny
  HelmetXssFilterHarmful = 'HelmetXssFilterHarmful',                    // pre-v4 helmet xssFilter true 의도 (Auditor — 현재 유해)
  HelmetAliasRedundant = 'HelmetAliasRedundant',                        // alias + canonical 동시 지정
  HelmetReportOnlyLifted = 'HelmetReportOnlyLifted',                    // reportOnly: true → contentSecurityPolicyReportOnly
  HelmetNonceCallbackUnsupported = 'HelmetNonceCallbackUnsupported',    // 함수형 directive — error 후보지만 마이그레이션 시 명확한 안내
  // i18n / 사용자 콜백 fallback
  MessageFormatterFailed = 'MessageFormatterFailed',                    // messageFormatter throw / 비-string 반환 / Promise — 영문 default로 fallback
  RemoveHeadersForcedByLegacy = 'RemoveHeadersForcedByLegacy',          // removeHeaders:false + legacy xPoweredBy:false 충돌 시 ['X-Powered-By'] 강제 주입
  // 입력 한도 sentinel
  TooManyWarnings = 'TooManyWarnings',                                  // warnings 배열 256 초과 시 마지막 항목으로 추가 (truncate 사실 명시)
}

interface HelmetWarning {
  reason: HelmetWarningReason;
  path: string;
  message: string;
}
```

## 파일 구조

테스트 컨벤션: `.spec.ts` = 단위 (src/ 내), `.test.ts` = 통합 (test/), `.bench.ts` = 벤치 (test/).

```text
packages/helmet/
├── index.ts                              # Public API barrel export
├── src/
│   ├── helmet.ts                         # Helmet 클래스 (create, headers, apply, applyHeadersTo, derive, toJSON, ...)
│   ├── helmet.spec.ts
│   ├── enums.ts                          # HelmetErrorReason, HelmetWarningReason
│   ├── interfaces.ts                     # HelmetError, HelmetWarning, HelmetOptions, sub-options
│   ├── types.ts                          # ResolvedHelmetOptions, branded types (Nonce, EndpointName), CspSource union 등
│   ├── constants.ts                      # Csp 키워드 상수 (public)
│   ├── options.ts                        # resolveHelmetOptions + validateHelmetOptions (각 모듈 위임, batched)
│   ├── options.spec.ts
│   ├── presets.ts                        # strict/api/spa/observatoryAPlus/kisa/acsc/bsi/ncsc/ipa
│   ├── presets.spec.ts
│   ├── migration.ts                      # fromHelmetOptions (express-helmet v8/v9)
│   ├── migration.spec.ts
│   ├── lint.ts                           # lintCsp (csp-evaluator 동등 휴리스틱)
│   ├── lint.spec.ts
│   ├── reports.ts                        # parseCspReport (legacy + Reporting API)
│   ├── reports.spec.ts
│   ├── hash.ts                           # hashFromString (Web Crypto)
│   ├── hash.spec.ts
│   │
│   ├── structured-fields/                # RFC 9651 직렬화 유틸 (공유)
│   │   ├── index.ts
│   │   ├── serialize.ts                  # sf-boolean, sf-string, sf-token, Inner List, Dictionary, sf-date, sf-displaystring
│   │   ├── grammar.ts                    # token grammar, key grammar
│   │   ├── constants.ts
│   │   └── structured-fields.spec.ts     # RFC 9651 테스트 벡터
│   │
│   ├── csp/                              # CSP + Report-Only
│   ├── hsts/                             # HSTS (preload validator 포함)
│   ├── permissions-policy/               # Permissions-Policy + RO (Tier A/B/C 53종)
│   ├── cross-origin/                     # COOP/CORP/COEP + RO
│   ├── reporting/                        # Reporting-Endpoints, NEL, Report-To 자동 생성
│   ├── integrity-policy/                 # Integrity-Policy + RO
│   ├── document-policy/                  # Document-Policy / Require / Document-Isolation-Policy + RO
│   ├── cache-control/                    # Cache-Control + Pragma/Expires
│   ├── clear-site-data/                  # Clear-Site-Data
│   ├── simple-headers/                   # XFO, Referrer-Policy, X-CTO, X-DNS-PC, X-PCDP, X-XSS-P, X-DO, OAC, Timing-Allow-Origin, X-Robots-Tag
│   ├── remove-headers/                   # 정보 노출 헤더 제거
│   └── adapters/                         # 프레임워크 nonce passthrough/적용 헬퍼 (subpath export)
│       ├── next.ts                       # withNonce(headers, nonce), nonceFromHeaders()
│       ├── sveltekit.ts                  # transformPageChunk + applyHeadersTo 헬퍼
│       ├── remix.ts                      # entry.server.tsx 통합
│       ├── astro.ts                      # context.locals.nonce 패턴
│       ├── hono.ts                       # c.set('nonce') / c.res.headers in-place
│       ├── elysia.ts                     # onAfterHandle Response 전달
│       └── electron.ts                   # applyToWebRequest(session, helmet)
│
├── test/
│   ├── helmet.test.ts                    # 통합 테스트
│   ├── helmet.bench.ts                   # 벤치 (CSP nonce, headersRecord, apply, applyHeadersTo, derive)
│   ├── helmet.edge-cases.test.ts         # 빈 Headers / Response.redirect / HSTS+UIR / Set-Cookie 다중 / 프록시 헤더 / Worker immutable
│   ├── owasp-sync.test.ts                # ci/headers_add.json + headers_remove.json 동기화 (pinned SHA)
│   ├── observatory.test.ts               # Mozilla Observatory v2 e2e (nightly, ephemeral Pages)
│   ├── csp-fuzz.test.ts                  # CSP FastCheck fuzz (round-trip + 키워드 인젝션)
│   ├── permissions-policy-fuzz.test.ts   # P-P SF Dictionary fuzz
│   ├── playwright/                       # 브라우저 fixture (minimal sf-string 인용 검증)
│   │   ├── strict.spec.ts
│   │   ├── api.spec.ts
│   │   └── ...
│   ├── wpt/                              # vendored WPT fixture (커밋 SHA pin, W3C 3-clause BSD)
│   │   ├── content-security-policy/
│   │   ├── permissions-policy/
│   │   ├── referrer-policy/
│   │   ├── trusted-types/
│   │   ├── integrity-policy/
│   │   ├── reporting/
│   │   ├── clear-site-data/
│   │   ├── cross-origin-*/
│   │   ├── mixed-content/
│   │   ├── subresource-integrity/
│   │   └── README.md                     # SHA pin + 라이선스 정보
│   ├── structured-field-tests/           # vendored httpwg/structured-field-tests (서브모듈 또는 snapshot)
│   └── golden/                           # 헤더 직렬화 golden (JSON, sorted)
│       ├── default-on.json
│       ├── presets-strict.json
│       ├── presets-api.json
│       ├── presets-spa.json
│       ├── presets-observatoryAPlus.json
│       ├── presets-kisa.json
│       ├── presets-acsc.json
│       ├── presets-bsi.json
│       ├── presets-ncsc.json
│       ├── presets-ipa.json
│       ├── default-on.with-nonce.json
│       └── ...
├── package.json                          # subpath exports: ./csp, ./hsts, ./permissions-policy, ./reports, ./hash, ./presets
├── tsconfig.json
├── tsconfig.build.json
├── bunfig.toml
└── .npmignore
```

## 구현 순서

### Step 1: shared 패키지 — HttpHeader enum 확장

`packages/shared/src/enums/http-header.ts`에 보안 헤더 추가:

- CSP, CSP-Report-Only, COOP, COOP-Report-Only, CORP, COEP, COEP-Report-Only
- Origin-Agent-Cluster, Permissions-Policy, Permissions-Policy-Report-Only, Referrer-Policy, HSTS
- X-Content-Type-Options, X-DNS-Prefetch-Control, X-Frame-Options
- X-Permitted-Cross-Domain-Policies, X-XSS-Protection, X-Download-Options
- X-Powered-By, Server, X-Robots-Tag, Server-Timing
- Reporting-Endpoints, Report-To (NEL 자동 생성용), NEL, Clear-Site-Data, Cache-Control, Pragma, Expires
- Integrity-Policy, Integrity-Policy-Report-Only
- Document-Policy, Document-Policy-Report-Only, Require-Document-Policy
- Document-Isolation-Policy, Document-Isolation-Policy-Report-Only
- Timing-Allow-Origin

### Step 2: 패키지 스캐폴딩

- `packages/helmet/` 디렉토리 + 설정 파일
- `package.json` (subpath exports 포함), `tsconfig.json`, `tsconfig.build.json`, `bunfig.toml`, `.npmignore`
- `bun install` (workspace link)

### Step 3: 핵심 타입

- `src/enums.ts` — `HelmetErrorReason`, `HelmetWarningReason`
- `src/interfaces.ts` — `HelmetError`(violations 배열), `HelmetWarning`, `HelmetOptions`, `HeadersOptions`, sub-options
- `src/types.ts` — `ResolvedHelmetOptions`(deep-readonly), branded types(`Nonce`, `EndpointName`, `HttpsUrl`), `CspSource` template literal union, sub-types
- `src/constants.ts` — `Csp` 키워드 상수 (CSP3 ED §2.3.1 전수 반영)

### Step 4: 기능 모듈 (의존성 순)

0. **`src/structured-fields/`** — RFC 9651. 의존성 0. 가장 먼저. 이후 모든 SF 모듈이 import. sf-date / sf-displaystring round-trip 보장
1. `src/simple-headers/` — Origin-Agent-Cluster sf-boolean(`?1`/`?0`)은 structured-fields 사용. X-Frame-Options 입력 case 보존(WAF 호환)
2. `src/remove-headers/` — OWASP 70종 + must-strip 4종. owasp-sync test
3. `src/cross-origin/` — COOP/CORP/COEP + RO (CoopValue/CorpValue/CoepValue 추출 sub-union)
4. `src/cache-control/` — Cache-Control + Pragma/Expires
5. `src/clear-site-data/` — RFC 9651 List of sf-string. 비표준 토큰 warn
6. `src/hsts/` — preload validator (hstspreload.org: maxAge≥1y + includeSubDomains 강제)
7. `src/reporting/` — Reporting-Endpoints (sf Dictionary), NEL + Report-To 자동 생성. HTTPS 강제
8. `src/integrity-policy/` — sf Dictionary, Inner List, sources auto-`(inline)`
9. `src/document-policy/` — sf Dictionary, value: bool/int/dec/string/token/inner-list
10. `src/permissions-policy/` — Tier A(6) + B(35) + C(18) + RO. registry 정정 반영
11. `src/csp/` — 가장 복잡. 27 디렉티브, sandbox 14-token, Trusted Types(policy-name regex 분리), nonce 주입, CSP3 ED §2.3.1 키워드 + report-sha* + Report-Only. 폐기 디렉티브 거부. fallback chain warn

### Step 5: 통합 레이어

- `src/options.ts` — resolveHelmetOptions (각 모듈 위임) + validateHelmetOptions (batched, 모든 violation aggregate)
- `src/options.spec.ts`
- 교차 검증 규칙:
  - CSP `reportTo` / COOP-RO / COEP-RO / Permissions-Policy-RO / Integrity-Policy `endpoints` / Document-Policy `report-to`가 참조하는 endpoint name이 `reportingEndpoints`에 정의되어 있는지 검증
  - NEL `reportTo`가 `reportingEndpoints`에 정의 시 `Report-To` 자동 생성. 미정의 시 에러
  - `default` endpoint 누락 시 warn
  - CSP 따옴표 없는 키워드 감지 시 에러 + `Csp` 사용 안내
  - `sandbox` 14-token enum 외이면 에러
  - `requireTrustedTypesFor`가 `'script'` 외이면 에러
  - `trustedTypes` policy-name `[A-Za-z0-9-#=_/@.%]+` 검증. `default` 사용 시 warn
  - HSTS `preload: true` 시 `maxAge ≥ 31536000` && `includeSubDomains: true` 강제 (위반 → HstsPreloadRequirementMissing)
  - Clear-Site-Data `prefetchCache`/`prerenderCache` 시 비표준 warn
  - Permissions-Policy features 키가 `PermissionsPolicyFeature` union 외이면 warn (registry 외 또는 오타)
  - `originAgentCluster: false` 시 `?0` 송출 (sf-boolean false). 일반적인 비활성이 아닌 origin-keyed 명시 opt-out
  - **COOP `same-origin` (Default-ON) + COEP OFF**: warn (CoopWithoutCoep). SAB/멀티스레드 WASM 미동작
  - Reporting endpoint URL HTTPS 강제 (HTTP 거부)
  - Permissions-Policy origin: `'self'`/`'*'` 외 문자열은 URL 파서 검증 (origin-only)
  - 폐기 CSP 디렉티브(prefetch-src, plugin-types, block-all-mixed-content, referrer, reflected-xss, navigate-to) 사용 시 에러
  - manifest-src + default-src만 + manifest fetch 시도 → warn (fallback 없음)

### Step 6: Helmet 클래스

- `src/helmet.ts` — create(throw), headers(options?), headersRecord(options?), apply(response, options?), applyHeadersTo(headers, options?), derive(partial), toJSON(), headerNames(), headersToRemove(), warnings
- nonce 지원: pre-tokenized 템플릿. `headers({ nonce })` / `headersRecord({ nonce })` / `apply(.., { nonce })`만 CSP 2개 재생성, 나머지 캐시. **`String.prototype.replaceAll(placeholder, () => nonceValue)` 함수 형식 강제** (cache poisoning 방지)
- `apply()` 구현: `new Response(response.body, { headers, status, statusText })` body stream 미소비
- `applyHeadersTo()` mutates Headers in place. 응답 첫 byte 송출 전에만 호출 가능 — JSDoc 명시
- `derive()` 부모 캐시 재사용 + 새 frozen 인스턴스
- 모든 `Map`/`Object.create(null)` 내부 저장 (prototype pollution 방어)
- `helmet.warnings`는 생성 후 `Object.freeze` (TS readonly + 런타임 freeze)
- `src/helmet.spec.ts`

### Step 7: 정적 헬퍼 + 프리셋 + 도구

- `src/presets.ts` — strict, api, spa, observatoryAPlus, kisa, acsc, bsi, ncsc, ipa
- `src/migration.ts` — fromHelmetOptions (v8/v9 키 매핑 + 사라진 키 warn)
- `src/lint.ts` — lintCsp (wildcard, missing object-src/base-uri, weak nonce, etc.)
- `src/reports.ts` — parseCspReport (legacy + Reporting API normalization)
- `src/hash.ts` — hashFromString (Web Crypto subtle.digest)
- `Helmet.csp(opts)`, `Helmet.hsts(opts)`, etc. — 정적 헬퍼 ([name, value] 튜플 반환)
- `Helmet.endpoints(map)` — Reporting-Endpoints 단축 빌더
- `helmet.toMetaTag()` — 메타-CSP 직렬화 (Cordova/Electron file://용)
- `helmet.toTauriConfig()` — Tauri 2.x `tauri.conf.json` 블록
- `Helmet.toExtensionManifestCsp(opts)` — MV3 manifest.json content_security_policy.extension_pages
- 프레임워크 어댑터 모듈: `src/adapters/next.ts`, `sveltekit.ts`, `remix.ts`, `astro.ts`, `hono.ts`, `elysia.ts`, `electron.ts` — `withNonce(headers, nonce)`, `nonceFromContext(ctx)`, `applyToWebRequest(session, helmet)` 등 프레임워크별 nonce passthrough/적용 헬퍼

### Step 8: Public API + 통합 테스트

- `index.ts` — barrel export + subpath re-exports
- `package.json`의 `exports` 필드에 다음 subpath 추가 (tree-shake):
  - 코어 모듈: `./csp`, `./hsts`, `./permissions-policy`, `./cross-origin`, `./reporting`, `./integrity-policy`, `./document-policy`, `./cache-control`, `./clear-site-data`, `./simple-headers`, `./remove-headers`
  - 도구: `./reports`, `./hash`, `./presets`, `./lint`, `./migration`
  - 어댑터: `./next`, `./sveltekit`, `./remix`, `./astro`, `./hono`, `./elysia`, `./electron`
  - 비-Web 직렬화: `./meta-tag`, `./tauri`, `./extension-manifest`
- **subpath별 의존성 minimization**: `./csp`만 import 시 `./permissions-policy`, `./reporting`, 어댑터 모듈은 끌려오지 않음. `index.ts`만 모든 모듈 re-export. `package.json` `sideEffects: false` 보장 (Webpack/Rollup tree-shake)
- **CI-enforced size budgets** (`size-limit` + `publint` + `attw`): 코어(`./csp` + `./hsts`) < 8KB gzipped, 전체 helmet < 50KB gzipped, 어댑터 각 < 2KB
- `test/helmet.test.ts` — 통합 시나리오 (각 프리셋 + apply + derive + nonce)
- `test/golden/` — 헤더 직렬화 회귀 방지

### Step 9: 검증

- `bun test` + `bun test --coverage` — **CI 임계값** (`bunfig.toml`의 `[test.coverageThreshold]`로 강제):
  - **line ≥ 95%** / **branch ≥ 90%** / **function ≥ 95%** / **statement ≥ 95%**
  - branch가 line보다 낮은 사유: validate batched 모듈에서 unreachable defensive branch (`switch` exhaustiveness `default`)가 다수 존재. 90%는 모든 의미 있는 분기를 cover하면서 defensive default를 면제
  - 제외: `**/*.spec.ts`, `**/*.test.ts`, `test/**/*`, `dist/**`, `**/types.ts` (타입만 선언, 실행 코드 0)
  - **mutation ≥ 80% via StrykerJS 8.x with `command` runner**:
    - mutator set: StrykerJS 기본 (`StringLiteral`, `BooleanLiteral`, `LogicalOperator`, `EqualityOperator`, `ArithmeticOperator`, `ConditionalExpression`, `BlockStatement`, `ArrayDeclaration`, `ObjectLiteral`, `Regex`, `OptionalChaining`, `UnaryOperator`, `UpdateOperator`, `ArrowFunction`, `MethodExpression`)
    - 제외 mutator: 없음 (모든 default mutator 적용)
    - 제외 파일: `test/golden/**` (스냅샷 fixture는 mutate 무의미), `**/*.spec.ts`, `**/*.test.ts`, `test/wpt/**`, `test/structured-field-tests/**`
    - mutation score 80% 기준: killed mutants / (total mutants - timeout - no-coverage). `--scoreType killed` 명시
  - `command` runner 명시 사유: Bun bun:test가 StrykerJS native runner 미지원 (2026-04 시점). `command: { command: 'bun test' }`로 Bun test runner 직접 호출
- `bun test:bench` — 회귀 감지. **methodology**: `mitata`로 100회 warmup + 1000회 측정, p50/p99 보고. CI는 **CodSpeed**(`@codspeed/bun`)로 p99 기준 +10% 회귀 게이트. `Bun.gc(true)` 델타로 allocations-per-call 추적. `crypto.getRandomValues` 200ns 비용은 nonce budget에 명시 포함
  - **bench 도구 결정 (mitata 채택)**: tinybench 대신 mitata 단일 채택. 사유: (a) Bun 코어 팀 유지보수 (`oven-sh` 산하), Bun 통합 first-class, (b) sub-microsecond 측정에서 tinybench보다 overhead 1/3 (warmup phase에서 V8/JSC inlining 안정화 후 측정), (c) `mitata.summary()`가 p50/p99/min/max 동시 보고. tinybench는 fallback 후보로만 유지 (Node-only 환경에서 mitata 호환성 이슈 발생 시)
  - `headers()` < 5μs (warmup 후)
  - `headers({nonce})` < 10μs (nonce 생성 200ns + CSP 재토큰화)
  - `apply()` < 20μs
  - `applyHeadersTo()` < 5μs (zero-allocation 목표 — `headersRecord()` 핫패스)
  - `headersRecord()` < 3μs
- `bun run build`
- **다중 런타임 CI 매트릭스** (2026-04 LTS 기준):
  - Bun 1.x (primary)
  - Node **20 LTS, 22 LTS, 24 current** (Node 18 LTS는 2025-04-30 EOL — 미지원)
  - Cloudflare Workers via wrangler dev
  - **Deno 2.x** (Deno 1.x는 2024-10 EOL — 미지원)
  - Vercel Edge Runtime via `@edge-runtime/vm` (npm 패키지, `@vercel/edge` 아님)
  - core grep gate: `bun:*` 또는 `node:*` import이 `src/` 코어에 없는지 검증
- **Spec conformance (vendored fixtures, no UA execution)**:
  - **WPT 벡터 import** — `test/wpt/` 디렉토리. WPT는 UA 하네스이므로 직접 실행하지 않음. `*.headers` / serialized 정책 문자열 fixture만 vendored (W3C 3-clause BSD 라이선스 헤더 보존). 대상: `wpt/content-security-policy/`, `wpt/permissions-policy/`, `wpt/referrer-policy/`, `wpt/mixed-content/`, `wpt/html/semantics/embedded-content/the-iframe-element/sandbox*`, `wpt/reporting/`, `wpt/trusted-types/`, `wpt/clear-site-data/`, `wpt/fetch/cross-origin-*/`, `wpt/subresource-integrity/`, `wpt/integrity-policy/`. 커밋 SHA pin
  - **WPT weekly auto-sync** — OWASP sync 패턴(아래 OWASP `headers_add.json` 항목 참조)과 동등한 cron:
    - GitHub Actions `wpt-sync.yml` — 매주 일요일 03:00 UTC. `web-platform-tests/wpt` HEAD를 `git ls-remote`로 SHA 조회 → vendored SHA(`test/wpt/SHA.txt`)와 diff
    - 위 vendored 디렉토리 12종에 한정 (sparse checkout 또는 `git archive --remote ... <subdir>`로 binary fixture 제외, text/header fixture만 가져옴)
    - 각 sub-tree 별 LICENSE.md / META.yml 자동 보존
    - diff 발견 시 PR 자동 생성: 변경 유형별 changeset (text-only diff → patch, 새 fixture → minor, 삭제 → review-required)
    - **auto-merge 금지** — 라이선스/스펙 의미 변경 가능성 manual review 필수
    - 실패 시 (network/permission) Slack notification (선택), CI는 green 유지 (sync는 informational)
  - **RFC 9651 §4 테스트 벡터** — `httpwg/structured-field-tests` (https://github.com/httpwg/structured-field-tests) 서브모듈/snapshot, 커밋 SHA pin. Item / List / Dictionary / Inner List round-trip
  - **W3C webappsec 픽스처** — `w3c/webappsec-csp/tests/`, `w3c/webappsec-trusted-types/tests/`, `w3c/webappsec-permissions-policy/tests/` 픽스처는 대체로 WPT에 미러됨. WPT 우선 사용
  - **자기 인증 한정** — W3C는 적합성 인증 미발행. 라이브러리는 "RFC 9651 generator", "CSP3 ED §X serializer" 자기 attest만. "W3C conformance level" 주장 금지
  - **OWASP `headers_add.json` / `headers_remove.json`** — pinned SHA. weekly GitHub Actions cron이 OWASP repo fetch → diff → auto-PR 생성 (token-only 변경 → patch changeset, 새 헤더 → minor, 제거 → major). manual review 필수, auto-merge 금지
- **Property-based 테스트 (FastCheck)**:
  - SF round-trip property: `parse(serialize(x)) === x` for Item/List/Dictionary/InnerList
  - CSP fuzz: 디렉티브 조합, 키워드 따옴표 주입, nonce charset preservation under `headers({nonce})` 주입
  - Permissions-Policy: SF Dictionary of Inner List allowlist fuzz, origin URL 검증
  - HSTS token ordering, Reporting-Endpoints sf-string escape (`"`, `\`)
- **Snapshot/golden file**: `test/golden/*.json` — 9 presets × {default, nonce=fixed} = 18 JSON 파일. 형식: `{ headerName: value }` sorted (헤더 순서 변경에도 diff 안정). re-bless: `bun test --update-snapshots` + 커밋 시 CHANGELOG entry 강제 (pre-push hook). spec revision (CSP3 ED 등) 갱신 시 별도 골든 파일 추가
- **Browser fixture (minimal Playwright)**: 각 major preset에 대해 1개 시나리오. 정적 fixture 페이지 → `presets.X()` 헤더 송출 → Playwright `page.evaluate(() => document.featurePolicy.allowsFeature(...))` + CSP violation event capture. golden file이 못 잡는 sf-string 인용 버그 검출용 (실제 enforcement 검증 아님)
- **Mozilla Observatory v2 nightly**: ephemeral Cloudflare Pages preview에 `presets.observatoryAPlus()` emit한 정적 fixture 배포 → `POST https://observatory-api.mdn.mozilla.net/api/v2/scan?host=<preview>` → `grade === "A+"` assert
- **Documentation tests**: `typescript-docs-verifier` 또는 `eslint-plugin-jsdoc` `@example` extraction → 컴파일 검증. README 마크다운 fence는 `tsx --check` 또는 `tsd`로 type-check
- **Edge case integration tests**:
  - 빈 `Headers` input
  - `Response.redirect()` (302, 본문 부재 — RFC 9110 §15.4) — 헤더 적용 정상 동작
  - HSTS + `upgrade-insecure-requests` 조합 + 응답 본문 내 `http:` 리소스 — UIR 동작
  - 다중 `Set-Cookie` `apply()` + `applyHeadersTo()` 양쪽 보존
  - `X-Forwarded-Proto` 등 프록시 헤더 — 본 라이브러리 미참조 (request 분석 안 함) 명시
  - HTTP/3 응답 (헤더 의미 변경 없음 — RFC 9110 §1.2)
  - Worker `fetch()` 응답의 immutable Headers — `helmet.apply()`만 사용 가능 검증
- **정적/공급망 검증**: GitHub CodeQL (semantic JS), `semgrep --config p/owasp-top-ten`, `bun audit` weekly, **npm provenance** (`--provenance`), **SLSA L3** (`slsa-framework/slsa-github-generator`), **Sigstore** keyless signing (cosign)

### Step 10: HTTP/외부 도구 검증

- Mozilla Observatory v2 — A+ 등급 (presets.observatoryAPlus())
- Google CSP Evaluator — 기본 CSP "moderate", `lintCsp({level:'strict'})` 통과 시 "strict"
- securityheaders.com — A+
- WPT (Web Platform Tests) 관련 conformance 점검
- Manual: Chrome DevTools / Firefox Inspector / Safari Web Inspector

## 컴플라이언스 매핑

### Mozilla Observatory v2

A+ (boost: SRI test, HSTS preload bonus, cookies penalty 회피). `presets.observatoryAPlus()`는 다음을 보장:

- Default-ON 11종 활성
- Permissions-Policy 송출
- COOP `same-origin` + CORP `same-origin`
- HSTS preload-eligible (max-age≥1년 + includeSubDomains + preload)
- Integrity-Policy 활성 → SRI test 보너스

### Google CSP Evaluator

기본 CSP는 `script-src` 명시 부재로 "moderate". Strict 등급:

```typescript
scriptSrc: [Csp.nonce(nonce), Csp.StrictDynamic, "'unsafe-inline'", 'https:']
```

`Helmet.lintCsp(directives, { level: 'strict' })`가 동등 휴리스틱 수행 — wildcard/missing object-src/base-uri/weak nonce 검출.

### PCI DSS 4.0.1 (mandatory since 2025-04-01)

| 요구사항 | 본 라이브러리 매핑 |
|---|---|
| §6.4.3 (script authorization + integrity) | `Integrity-Policy` 활성 + CSP `Csp.hash()` / `Csp.nonce()` |
| §11.6.1 (security-impacting header tamper detection) | `getAppliedHeaders()`/`headerNames()` 출력 → 외부 모니터로 livecheck. Reporting-Endpoints + CSP `report-to` |
| §6.4.3 권장 레시피 | `presets.strict()` + `integrityPolicy: true` + `reportingEndpoints: { default: ... }` |

### OWASP ASVS 5.0 V14.4 매핑

| 컨트롤 | 헤더/설정 |
|---|---|
| V14.4.1 (Content-Type with charset) | 본 라이브러리 범위 외 (응답 본체) |
| V14.4.2 (anti-clickjacking) | CSP `frame-ancestors 'none'` + X-Frame-Options `deny` |
| V14.4.3 (CSP) | Content-Security-Policy + `requireTrustedTypesFor 'script'` (DOM-XSS) |
| V14.4.4 (X-Content-Type-Options) | `nosniff` |
| V14.4.5 (HSTS) | `max-age≥1y` + includeSubDomains |
| V14.4.6 (Referrer-Policy) | `no-referrer` (또는 ACSC ISM-1788 호환은 `presets.acsc()`) |
| V14.4.7 (allowed methods) | 본 라이브러리 범위 외 (라우터/CORS) |

### NIST SP 800-53 Rev. 5 / FedRAMP Rev. 5

| 컨트롤 | 헤더 |
|---|---|
| SC-8 (Transmission Confidentiality) | HSTS |
| SC-18 (Mobile Code) | CSP, Trusted Types |
| SC-23 (Session Authenticity) | COOP, CORP |
| SI-10 (Information Input Validation) | CSP, X-Content-Type-Options |
| AC-4 (Information Flow Enforcement) | COOP, COEP, CORP, X-Frame-Options |

### CWE Top 25 (2025) 매핑

| CWE | 헤더 mitigation |
|---|---|
| CWE-79 (XSS, #1) | CSP, Trusted Types, X-Content-Type-Options |
| CWE-1021 (UI redress / clickjacking) | X-Frame-Options, CSP frame-ancestors |
| CWE-352 (CSRF, partial) | SameSite cookies (범위 외), Origin 검증 (`@zipbul/cors`) |
| CWE-693 (Protection Mechanism Failure) | 다수 |
| CWE-829 (Untrusted Inclusion) | CSP, Integrity-Policy, SRI |
| CWE-757 (Less-Secure Algorithm) | HSTS |

### MITRE ATT&CK / D3FEND

| ATT&CK | D3FEND | 헤더 |
|---|---|---|
| T1189 (Drive-by Compromise) | D3-SCH (Script Hardening) | CSP |
| T1557 (AiTM) | D3-CH (Certificate Hardening) | HSTS |
| T1185 (Browser Session Hijacking) | D3-IFW (Inbound Frame Filtering) | X-Frame-Options, CSP frame-ancestors |
| T1539 (Steal Web Session Cookie) | (cookie middleware) | (범위 외) |

### Korean 표준 (KISA / ISMS-P / PIPA / TTA)

| 표준 | 매핑 / preset |
|---|---|
| KISA 「웹서버 보안 강화 가이드」 (2024) | `presets.kisa()` (X-XSS-Protection `1; mode=block`, Cache-Control no-store on PII routes) |
| KISA 「정보시스템 구축·운영 지침」 / 행안부 SW 보안 가이드 | `presets.kisa()` |
| ISMS-P 인증기준 2.10.6 (전송구간 보안), 2.6.7 | HSTS, COOP, CORP |
| 개인정보보호법(PIPA) §29 + 개인정보 안전성 확보조치 §7(6) | 개인정보 라우트 `cacheControl: { value: 'no-store', pragma: true, expires: true }` |
| TTA TTAK.KO-12.0345 (HTTP 보안 헤더 권고) | Default-ON 11 |
| eGovFrame Security 모듈 | `presets.kisa()` 권장 |

### 기타 국가 표준

| 표준 | 매핑 |
|---|---|
| IPA「安全なウェブサイトの作り方」第7版 (2024) | `presets.ipa()` (X-Frame-Options uppercase `DENY` 옵션) |
| ACSC ISM (Australia, Mar-2025) ISM-1424/1552 | HSTS+CSP. ISM-1788 ↔ `presets.acsc()` (Referrer-Policy strict-origin-when-cross-origin) |
| BSI Germany TR-03116-4 / TR-03161 | `presets.bsi()` (Cache-Control no-store 강제) |
| ANSSI France RGS v2.0 §R37 | Default-ON satisfies |
| NCSC UK secure development | `presets.ncsc()` (CSP-RO + Reporting-Endpoints monitoring-first) |
| CCCS Canada ITSP.40.111 / ITSG-33 | TLS+HSTS+CSP. Default-ON satisfies |
| Cyber Essentials Plus (UK 2025 Willow) | Default-ON satisfies |
| CISA Secure by Design (Goal 3, 7) | Default-ON 11 + SECURITY.md + SBOM |
| EU CRA Article 13 (apply 2027-12) | SECURITY.md (vulnerability disclosure), SBOM, automated config update (OWASP sync test) |
| NIS2 Directive (apply 2024-10) | 동일 |

### CSA CCM v4 / SOC 2

| 컨트롤 | 헤더 |
|---|---|
| CCM DSI-04 (Data Security in Transit) | HSTS |
| CCM AIS-04 (Application Security) | CSP, COOP, COEP |
| SOC 2 CC6.6/CC6.7 (boundary, encryption-in-transit) | HSTS + `toJSON()` evidence snapshot |
| HIPAA §164.312(e)(1) | HSTS |

### 컴플라이언스 운영 체크리스트

- `helmet.toJSON()` 스냅샷을 SOC 2 evidence 수집기에 송출
- `helmet.headerNames()`로 §11.6.1 모니터에 livecheck
- `Reporting-Endpoints` token 정기 rotation (CSP report 위조 방지)
- nonce 라이프사이클: 요청당 1회 생성, 응답 + HTML 모두에 동일 nonce
- CSP 정책 staged rollout: Report-Only → 비교 → enforce (NCSC 패턴, `presets.ncsc()` 활용)

### 관측성 (Observability)

- `Helmet.parseCspReport()`는 향후 OpenTelemetry semantic conventions로 매핑 가능한 typed object 반환 — **2026-04 시점 OTel `http.security.*` 안정 conv 미정** (https://github.com/open-telemetry/semantic-conventions). 사용자가 자체 attribute mapping으로 OTel exporter 송출
- 메트릭 후보: `bytes_added` (apply() 결과 헤더 합 - 입력 헤더 합), `bytes_removed` (removeHeaders 효과), `headers_count` — 사용자가 toJSON() + headerNames() 조합으로 산출 (라이브러리 내장 X, 의존성 0 유지)
- 로그/warn: 라이브러리 자체는 console 출력 없음. `helmet.warnings`를 사용자 로깅 시스템에 위임

### 다국어 (i18n) 정책

- 에러 메시지 본문은 **영문 default** (industry standard, `@zipbul/cors`와 일관)
- `HelmetErrorReason` / `HelmetWarningReason` enum 값이 **i18n 키 역할** — 기계 판독 보장
- 사용자 옵션 `messageFormatter?: (reason, ctx) => string`으로 다국어 번역 파이프라인 연결 가능 (deferred contract)
- 라이브러리 자체는 i18n 파이프라인 미내장 (스코프 외, 의존성 0 유지)

## helmet.js v8/v9 마이그레이션 표

`Helmet.fromHelmetOptions(legacyConfig)`이 다음 매핑을 자동 수행. 14 canonical + 8 legacy alias 처리.

### 직접 매핑 (이름 보존)

| helmet 옵션 | @zipbul 매핑 | 비고 |
|---|---|---|
| `contentSecurityPolicy: false` | `contentSecurityPolicy: false` | 직접 |
| `contentSecurityPolicy: { directives, useDefaults?, reportOnly? }` | `contentSecurityPolicy: { directives }` 또는 `contentSecurityPolicyReportOnly` | `useDefaults` **무시** (OWASP defaults 항상 병합) + `HelmetUseDefaultsIgnored` warn. `reportOnly: true`는 top-level `contentSecurityPolicyReportOnly`로 lift + `HelmetReportOnlyLifted` warn |
| `crossOriginEmbedderPolicy: bool \| {policy}` | `crossOriginEmbedderPolicy: bool \| CoepValue` | `{policy:x}` unwrap |
| `crossOriginOpenerPolicy: bool \| {policy}` | `crossOriginOpenerPolicy: bool \| CoopValue` | unwrap |
| `crossOriginResourcePolicy: bool \| {policy}` | `crossOriginResourcePolicy: bool \| CorpValue` | unwrap |
| `originAgentCluster: bool` | `originAgentCluster: bool` | 직접 |
| `referrerPolicy: bool \| {policy}` | `referrerPolicy: bool \| token \| token[]` | `{policy}` unwrap |
| `strictTransportSecurity: bool \| {maxAge,includeSubDomains,preload}` | `strictTransportSecurity` (동일) | 직접. `maxAge < 31536000` + `preload: true` 시 `HstsPreloadRequirementMissing` 에러 |
| `xContentTypeOptions: bool` | `xContentTypeOptions: bool` | 직접 |
| `xDnsPrefetchControl: bool \| {allow}` | `xDnsPrefetchControl: bool \| 'on' \| 'off'` | `{allow:true}`→`'on'`, `{allow:false}`→`'off'` |
| `xDownloadOptions: bool` | `xDownloadOptions: bool` | 직접 (v2.0 제거 후보) |
| `xFrameOptions: bool \| {action}` | `xFrameOptions: bool \| 'deny' \| 'sameorigin'` | `{action}` unwrap. **default 차이**: helmet=`SAMEORIGIN`, zipbul=`deny`. 사용자가 omit 시 (helmet default 의존) `HelmetXFrameOptionsDefaultTightened` warn |
| `xPermittedCrossDomainPolicies: bool \| {permittedPolicies}` | `xPermittedCrossDomainPolicies: bool \| token` | unwrap |
| `xXssProtection: bool` | `xXssProtection: bool \| '0' \| '1; mode=block'` | helmet `true`→`'0'` (현재 의미). pre-v4 의도(Auditor 활성화) 의심 시 `HelmetXssFilterHarmful` warn |

### Alias rename

| helmet alias | @zipbul canonical |
|---|---|
| `hsts` | `strictTransportSecurity` |
| `noSniff` | `xContentTypeOptions` |
| `dnsPrefetchControl` | `xDnsPrefetchControl` |
| `ieNoOpen` | `xDownloadOptions` |
| `frameguard` | `xFrameOptions` |
| `permittedCrossDomainPolicies` | `xPermittedCrossDomainPolicies` |
| `hidePoweredBy` | `removeHeaders` 라우팅 (semantic remap, 아래) |
| `xssFilter` | `xXssProtection` |

alias + canonical 동시 지정 시 `HelmetAliasRedundant` warn, canonical 우선.

### Semantic remap (헤더 제거)

| helmet 옵션 | @zipbul 동작 |
|---|---|
| `xPoweredBy: false` | `removeHeaders: { headers: ['X-Powered-By'] }` (또는 default `removeHeaders: true`로 자동 처리) |
| `hidePoweredBy: true` | 동일 |

helmet의 이 플래그들은 setter가 아니라 **header removal**. zipbul에서는 top-level `xPoweredBy` 옵션이 없으며 must-strip 4종 default에 `X-Powered-By` 포함됨.

#### `removeHeaders: false` + legacy `xPoweredBy: false` 충돌 처리 (결정적 우선순위)

사용자가 `Helmet.fromHelmetOptions(legacyConfig)` 호출 시 두 옵션이 동시 지정될 수 있다 — `xPoweredBy: false`(헤더 제거 의도) + `removeHeaders: false`(전체 제거 비활성). 라이브러리는 다음 결정적 정책을 적용:

1. **legacy intent 보존 우선**: `xPoweredBy: false`/`hidePoweredBy: true`가 명시되면 사용자의 명백한 의도. `removeHeaders: false`보다 우선
2. 자동 변환: `removeHeaders: { headers: ['X-Powered-By'] }` 강제 주입 — 다른 must-strip 4종(`Server`, `X-AspNet-Version`, `X-AspNetMvc-Version`)은 포함 안 함 (legacy intent 범위 외)
3. **명시 warning**: `HelmetWarning(RemoveHeadersForcedByLegacy)` 누적. message는 "removeHeaders:false was overridden because legacy xPoweredBy:false specified explicit X-Powered-By removal intent"
4. 사유: legacy migration의 신뢰할 수 있는 안전한 default. `removeHeaders: false`로 X-Powered-By가 노출되면 보안 회귀 (helmet에서 동일 옵션이 제거를 보장)

```typescript
// legacy
{ xPoweredBy: false, removeHeaders: false }
// → @zipbul 결과
{
  removeHeaders: { headers: ['X-Powered-By'] },
  warnings: [{ reason: 'RemoveHeadersForcedByLegacy', path: 'removeHeaders' }]
}
```

대안 (사용자가 명시적으로 X-Powered-By까지 노출하길 원할 때): `xPoweredBy` legacy 키를 제거하고 `removeHeaders: false`만 명시. 이 경우 warning 없음.

### Hard error (마이그레이션 차단)

| helmet 패턴 | 사유 + 안내 |
|---|---|
| `directives: { scriptSrc: [(req, res) => `'nonce-${res.locals.nonce}'`] }` (함수형) | `HelmetError(NonceCallbackUnsupported)`. 안내: `Helmet.generateNonce()` + `headers({ nonce })` / `applyHeadersTo(headers, { nonce })` 사용 |
| `dangerouslyDisableDefaultSrc` symbol | error: "use `presets.api()` for `default-src 'none'`" |

### 동반 의존성 검출 (manual preflight)

`fromHelmetOptions`는 다음을 README 가이드로 안내 (자동 처리 아님):

- `lusca` — XFO/CSRF 중복 → 제거
- `csurf` — deprecated, CVE-prone → 다른 CSRF 솔루션
- helmet의 `expectCt`, `referrerPolicy`만 사용하는 패턴 → 신규 옵션으로 변환

## 운영 가이드 (README)

### Nonce 사용

```typescript
const nonce = Helmet.generateNonce();          // 16바이트 base64url, branded `Nonce`
const headers = helmet.headers({ nonce });
// 또는
const secured = helmet.apply(response, { nonce });
// HTML 렌더링 시 동일 nonce: <script nonce="${nonce}">...</script>
```

`crypto.randomUUID()` 비권장 — 122bit로 CSP3 §8 미달.

### Cookie 보안 (범위 외, 권장)

`Set-Cookie`는 본 라이브러리 미관여. draft-ietf-httpbis-rfc6265bis-22 prefix 권장:

- `__Host-`: `Secure` + `Path=/` + Domain 미지정 → 서브도메인 cookie injection 방지
- `__Secure-`: `Secure` 강제

`SameSite=Lax`/`Strict`, `HttpOnly`, `Secure` 조합을 세션 cookie에 적용.

### SRI 사용 (Integrity-Policy + 빌드 통합)

신규 콘텐츠는 **sha384** 권장 (W3C SRI Level 2 FPWD 2025-04-22 — CR 미진입 ED). sha256은 호환 유지.

```html
<script src="..." integrity="sha384-..." crossorigin="anonymous"></script>
```

빌드 통합 — Vite/Rollup/webpack에서 번들 hash 추출:

```typescript
const hash = await Helmet.hashFromString(scriptText, 'sha384');
const helmet = Helmet.create({
  contentSecurityPolicy: {
    directives: { scriptSrc: [Csp.Self, Csp.hash('sha384', hash)] }
  }
});
```

**알고리즘 매트릭스** (CSP3 ED §2.3.1 hash-algorithm + Web Crypto subtle.digest 런타임 지원):

| 알고리즘 | CSP3 spec | Bun | Node | Workers | Deno | Safari/Web | 권장 |
|---|---|---|---|---|---|---|---|
| SHA-256 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 호환 |
| SHA-384 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **2026 권장** |
| SHA-512 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 고가치 |
| SHA-3 / Keccak | ✗ (CSP3 미정의) | ✗ | ✗ | ✗ | ✗ | ✗ | 미지원 |
| ML-DSA / SLH-DSA (PQ) | ✗ (2026 미정) | ✗ | ✗ | ✗ | ✗ | ✗ | 미지원 |

`Csp.hash()`는 `'sha256' | 'sha384' | 'sha512'` 유니온만 허용. SHA-3 / 포스트퀀텀은 CSP3 spec 미정의 — 향후 W3C 결정 시 minor.

`Helmet.hashFromString()` 입력 타입: `string | ArrayBuffer | Uint8Array | Blob | ReadableStream`. 파일 hash가 필요한 경우 사용자가 런타임별로 입력 변환 (Bun: `await Bun.file(path).arrayBuffer()`, Node: `await fs.readFile(path)`, Workers: `await fetch(url).then(r => r.arrayBuffer())`).

**SubtleCrypto incremental API 부재 트레이드오프**: Web Crypto `subtle.digest`는 chunked/incremental 입력을 지원하지 않음 — 입력 전체를 buffer에 누적 후 단일 호출. `ReadableStream` 입력 시 라이브러리는 내부적으로 `for await (const chunk of stream)`로 Uint8Array에 concat하여 전달. 매우 큰 파일(>100MB)에는 메모리 비용 → 빌드 도구(Vite/Rollup)에서 파일별 분할 hash 권장. JS native SHA-2 폴백은 의도적으로 미제공 (의존성 0 유지).

### 핫패스 최적화

요청당 `headers()` 할당 부담 시 `headersRecord()` (Hono `c.header(name, value)` 루프) 또는 `applyHeadersTo()` (in-place):

```typescript
const record = helmet.headersRecord({ nonce });
for (const [name, value] of Object.entries(record)) c.header(name, value);

// 또는 in-place
helmet.applyHeadersTo(c.res.headers, { nonce });
```

### Cross-origin isolation (SharedArrayBuffer)

`crossOriginIsolated` 활성화 조건 (모두 충족):

1. COOP `same-origin` (Default-ON ✓)
2. COEP `require-corp` 또는 `credentialless` (**Default-OFF** — 명시 활성 필요)
3. 또는 Document-Isolation-Policy `isolate-and-require-corp` / `isolate-and-credentialless` (Chromium 전용, Chrome 137+ stable)

```typescript
Helmet.create({ crossOriginEmbedderPolicy: 'require-corp' });
```

COOP `same-origin` + COEP OFF 시 `helmet.warnings`에 `CoopWithoutCoep` 누적.

### Server 헤더 제거 제약

런타임이 미들웨어 이후 `Server`를 prepend하는 경우 `removeHeaders`로 못 막음:

- **Bun.serve**: `serverHeader` 옵션으로 비활성 (`Bun.serve({ ..., serverHeader: '' })`)
- **Node http/http2**: 응답 후 `res.removeHeader('Server')` 또는 reverse proxy(nginx `server_tokens off;`) 우회
- **Cloudflare Workers / Vercel Edge**: 플랫폼 자동 주입 (사용자 제어 불가)

### WAF 호환

Cloudflare/Akamai 일부 시그니처가 `X-Frame-Options: DENY`(uppercase) 정확 매칭. `xFrameOptions: 'DENY'` 입력 시 입력 case 그대로 송출 (lowercase 정규화 안 함).

### 응답 헤더 바이트 예산

기본 활성 헤더 + 큰 CSP + OWASP removeHeaders 프리셋 시 응답 헤더 합계 4–8KB 도달 가능:

- Bun.serve: 64KB (기본)
- Node http: 16KB (--max-http-header-size로 조정)
- nginx `large_client_header_buffers`: 기본 4×8KB
- Cloudflare: 32KB (Worker 응답)
- AWS API Gateway: 10KB

해결: CSP `frame-ancestors 'none'` 사용 시 X-Frame-Options 생략 가능 / Permissions-Policy 미사용 피처는 명시 안 함 / removeHeaders는 실제로 노출되는 헤더만.

### 런타임 호환성

코어 모듈은 `globalThis.crypto`, `Headers`, `Response`만 사용 — 런타임 비종속:

- Bun 1.x ✓ (primary target)
- Cloudflare Workers ✓ (compatibility_date `2024-09-23` 이상, `streams_enable_constructors` 권장)
- Deno 1.40+ / Deno Deploy ✓
- Vercel Edge Runtime ✓
- Node.js 19+ ✓

`Bun.*` API 미사용. 통합 예제만 Bun 우선 표기.

### Cloudflare 운영 가이드

**Transform Rules 우선, Workers는 동적 정책 전용.** 정적 헤더 (Default-ON 11종 등)는 [Cloudflare Modify Response Header Transform Rules](https://developers.cloudflare.com/rules/transform/response-header-modification/)에서 엣지 캐시 레이어에 송출 — 컴퓨트 비용 0. Worker는 다음에만 사용:

- 요청별 nonce가 필요한 CSP (SSR, SPA hydration)
- 테넌트별/A-B별 CSP-Report-Only
- Reporting-Endpoints 토큰 동적 회전

**Worker `Response.headers` immutability**: `fetch()`로 받은 Response의 헤더는 immutable. `applyHeadersTo(fetched.headers)`는 `TypeError: immutable` throw. 반드시 `helmet.apply(fetched)` 또는 `new Response(fetched.body, { headers: new Headers(fetched.headers) })`로 클론 후 사용.

**Pages Functions vs Workers**: Pages는 `_headers` 파일이 있고 `cf-*` 자동 주입. `_headers`와 Helmet 출력 충돌 시 Pages가 prepend → `_headers`에서 동일 헤더 미설정 권장.

**번들 사이즈 한도**: Worker 1MB compressed (Free: 1MB, Paid: 10MB). `@zipbul/helmet/csp` + `@zipbul/helmet/hsts`만 import 시 코어 < 8KB gzipped 목표.

### 미래 헤더 watchlist (현재 미배출)

다음 헤더는 표준 진행 중이나 본 라이브러리는 stable 진입까지 미배출:

- **Connection-Allowlists** (Chrome OT 148-151) — deny-by-default 네트워크 방화벽 응답 헤더. OT 종료 후 stable 도달 시 minor 추가
- **Sec-Fetch-Storage-Access** / **Activate-Storage-Access** (Chrome 133+ shipped) — Storage Access API. 동작 헤더이며 본 라이브러리 보안 정책 범위 외 (참고: Plan §의도적 제외 표 참조)
- **HTTPS-Upgrades / HTTPS-First** (Chrome 147 ESB, Chrome 154 default 2026-Q4) — 브라우저 기능. **HSTS는 여전히 필수** (HTTPS-Upgrades는 fallback 레이어, HSTS 대체 아님). 본 라이브러리 변경 없음
- **Signature-based SRI Ed25519** — `'ed25519-...'` integrity prefix. SRI L2 CR 진입 + 브라우저 stable 시 `Csp.hash` 알고리즘 union 확장

### Vercel 운영 가이드

- **헤더 적용 순서**: `next.config.js headers()` → middleware.ts → Route Handler → Helmet. **Vercel은 `next.config.js`를 마지막에 적용**할 수 있어 Helmet 출력을 clobber. Helmet 사용 시 `next.config.js headers()` 제거 또는 보조 사용
- Edge Functions vs Node Functions: Headers API parity 보장. `runtime: 'edge'` export 시 `globalThis.crypto` 사용 가능
- `x-vercel-*` 헤더(`x-vercel-cache`, `x-vercel-id`, `x-vercel-edge-region` 등)는 `removeHeaders` 후보군에 추가 권장 (plan-extension)

### Deno / JSR

본 라이브러리는 **npm + JSR 양쪽 게시** 검토. `@zipbul/helmet`은 npm, `@zipbul/helmet`은 JSR(jsr.io). JSR slow types 정책에 부합 — 모든 export에 명시 타입 (no inferred types in public API).

Deno 1.40+ `Headers.delete()`는 `Set-Cookie` 다중 값을 모두 삭제 (Deno 1.40 미만은 첫 항목만). `apply()` 알고리즘은 `getSetCookie()` + `append`로 다중 값 명시 보존 → 안전.

### Bun 운영 가이드

```typescript
const helmet = Helmet.create();

Bun.serve({
  serverHeader: '',
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/static/')) {
      // Bun.file() static serving — Helmet 적용
      const file = Bun.file(`./public${url.pathname}`);
      const res = new Response(file);
      return helmet.apply(res);
    }
    return helmet.apply(new Response('hello'));
  },
});
```

Bun dev hot-reload 시 헤더 캐시는 모듈 재로드와 함께 재생성 → 일관성 유지.

## 프레임워크 통합

### Hono (Bun)

```typescript
import { Hono } from 'hono';
import { Helmet } from '@zipbul/helmet';

const helmet = Helmet.create();
const app = new Hono();

app.use(async (c, next) => {
  await next();
  const nonce = Helmet.generateNonce();
  c.set('nonce', nonce);                       // 템플릿에서 c.get('nonce') 사용
  helmet.applyHeadersTo(c.res.headers, { nonce });
});
```

### Elysia (Bun)

```typescript
import { Elysia } from 'elysia';
import { Helmet } from '@zipbul/helmet';

const helmet = Helmet.create();
new Elysia()
  .onAfterHandle(({ response }) =>
    response instanceof Response ? helmet.apply(response) : response
  );
```

### `Bun.serve` (raw)

```typescript
const helmet = Helmet.create();
Bun.serve({
  serverHeader: '',                            // Server 헤더 제거
  fetch(req) {
    return helmet.apply(new Response('hello'));
  },
});
```

### Express (Node, 어댑터 필요)

Web `Response` 기반이므로 Express(Node `res`)와 직접 호환 안 됨. Hono 어댑터(`@hono/node-server`) 사용 권장.

### Next.js (App Router, `@zipbul/helmet/next`)

```typescript
// middleware.ts
import { NextResponse } from 'next/server';
import { Helmet } from '@zipbul/helmet';
import { withNonce } from '@zipbul/helmet/next';

const helmet = Helmet.create();

export function middleware(request: Request) {
  const nonce = Helmet.generateNonce();
  const response = NextResponse.next({
    request: { headers: withNonce(request.headers, nonce) },  // x-nonce 헤더로 RSC에 전달
  });
  helmet.applyHeadersTo(response.headers, { nonce });
  return response;
}

// app/layout.tsx
import { headers } from 'next/headers';
const nonce = (await headers()).get('x-nonce') ?? '';
return <Script nonce={nonce} ... />;
```

**주의**: `next.config.js headers()` 사용 시 Vercel이 마지막에 적용하여 Helmet 출력을 덮어쓸 수 있음 — 둘 중 하나만 사용 권장.

### SvelteKit (`@zipbul/helmet/sveltekit`)

```typescript
// hooks.server.ts
import type { Handle } from '@sveltejs/kit';
import { Helmet } from '@zipbul/helmet';

const helmet = Helmet.create();

export const handle: Handle = async ({ event, resolve }) => {
  const nonce = Helmet.generateNonce();
  const response = await resolve(event, {
    transformPageChunk: ({ html }) => html.replaceAll('%nonce%', nonce),
  });
  helmet.applyHeadersTo(response.headers, { nonce });
  return response;
};
```

### Remix (`@zipbul/helmet/remix`)

```typescript
// app/entry.server.tsx
import { Helmet } from '@zipbul/helmet';
const helmet = Helmet.create();

export default function handleRequest(request, status, responseHeaders, context) {
  const nonce = Helmet.generateNonce();
  const stream = renderToReadableStream(<RemixServer context={context} url={request.url} nonce={nonce} />);
  helmet.applyHeadersTo(responseHeaders, { nonce });
  return new Response(stream, { status, headers: responseHeaders });
}
```

### Astro (`@zipbul/helmet/astro`)

```typescript
// src/middleware.ts
import { defineMiddleware } from 'astro:middleware';
import { Helmet } from '@zipbul/helmet';

const helmet = Helmet.create();
export const onRequest = defineMiddleware(async (context, next) => {
  const nonce = Helmet.generateNonce();
  context.locals.nonce = nonce;
  const response = await next();
  helmet.applyHeadersTo(response.headers, { nonce });
  return response;
});
```

### eGovFrame (Korean public sector)

`presets.kisa()` 사용 + Spring/Java 응답 객체 변환 어댑터 (사용자 작성).

### 비-Web/하이브리드 컨텍스트 (Tauri / Electron / Mobile WebView)

본 라이브러리는 **HTTP 응답 헤더 엔진**이지만, 일부 환경은 헤더가 무시된다 (`file://` 스킴) 또는 별도 메커니즘(메타-CSP, 매니페스트 CSP, custom scheme handler) 사용. 보조 직렬화 API 제공:

- `helmet.toMetaTag()` — `<meta http-equiv="Content-Security-Policy" content="...">` 직렬화. `file://` Cordova / Electron 로컬 페이지 / Capacitor 호환 안전망. CSP만 — HSTS/COOP/COEP/X-Frame-Options 등은 메타로 강제 불가 (스펙 명시)
- `helmet.toTauriConfig()` — Tauri 2.x `tauri.conf.json` `app.security.csp` + `app.security.headers` 블록 직렬화
- `Helmet.toExtensionManifestCsp(options)` — Chrome MV3 `manifest.json` `content_security_policy.extension_pages` 직렬화. 원격 https / `'unsafe-eval'` 거부 (MV3 정책 위반)

**Tauri 2.x**: `tauri.conf.json`에 빌드 시 주입. dev server는 별도. `helmet.toTauriConfig()` 결과를 `tauri.conf.json`에 commit.

**Electron**: `file://`은 `onHeadersReceived` 미호출 → 메타-CSP만 가능. 원격 로드는 `session.defaultSession.webRequest.onHeadersReceived`로 응답 헤더 주입. `adapters/electron.ts`의 `applyToWebRequest(session, helmet)`이 두 경로 모두 처리

**React Native WebView / WKWebView / Android WebView**: 래핑된 Chromium/WebKit과 동일하게 HTTP 응답 헤더 honor. `https://` 또는 `WebViewAssetLoader`(`https://appassets.androidplatform.net`) 출처는 정상 적용. iOS `loadFileURL:` `file://`은 헤더 무시 → 메타-CSP

**Capacitor / Ionic**: `capacitor://localhost`(iOS), `https://localhost`(Android) — 커스텀 스킴이지만 헤더 honor. `WebViewAssetHandler.getResponseHeaders()`에서 Helmet 출력 적용. 안전 디폴트로 메타-CSP 동시 송출 권장

**Cordova `file://`**: 헤더 무시. 메타-CSP만. `<meta http-equiv>`로 `index.html`에 embed (별도 가이드)

**TWA / PWA**: 정상 HTTPS, 모든 헤더 적용. 단 `/.well-known/assetlinks.json` 라우트는 `Cache-Control: no-store` 예외 권장 (TWA verification 캐시 필요)

**WebExtensions MV3**: 확장 페이지 CSP는 `manifest.json`에 정적 정의. HTTP 헤더 미적용. `Helmet.toExtensionManifestCsp()` 직렬화 사용. 확장이 로컬 서버를 운영한다면 그 응답에는 일반 Helmet 적용

**CEF (Chromium Embedded Framework)**: `CefResourceHandler::GetResponseHeaders`에서 `helmet.headers()` / `helmet.headersRecord()` 출력 매핑. API 변경 없음

**ServiceWorker**: SW 내부 `new Response(body, { headers })` 합성 시 `helmet.apply(synthResponse)` 그대로 사용 가능. SW가 응답 source-of-truth가 되려면 보안 헤더 포함 필수

**SSE**: `connect-src` 거버넌스. `Cache-Control: no-store`는 SSE buffering proxy 멈춤 방지에도 필수 (BSI/KISA 프리셋이 자연 지원)

**WebSocket upgrade (101 Switching Protocols)**: 브라우저는 101 응답 헤더를 JS에 노출하지 않음. `apply()` 호출 시 status 101 감지하면 `ApplyOnSwitchingProtocols` warning. CSP `connect-src 'self'`는 `wss:`와 매칭 안 됨 (CSP 이슈 #7) — `connectSrc: ['self']`만 + 명시 wss host 미설정 시 `SelfDoesNotMatchWebSocketScheme` warning

**WebTransport**: HTTP/3 CONNECT, `connect-src` + `'unsafe-webtransport-hashes'`. 추가 헤더 없음

## 버전 관리 정책

| 변경 | bump | 비고 |
|---|---|---|
| Default-ON 헤더 제거 | **major** | 기본 보호 약화 |
| Default-ON 기본값 변경 (강화/완화) | **major** | 보안 수준 변경 |
| 옵션 interface field 제거 / type narrowing | **major** | breaking |
| 옵션 interface field rename | **major** | breaking |
| `HelmetErrorReason` enum 값 제거 | **major** | machine-readable 계약 |
| Permissions-Policy Tier 재배치 (B→C 등) | **major** | 사용자가 Tier 별 처리 시 |
| 의존성 중요 변경 (peerDeps 추가 등) | **major** | |
| 새 Default-OFF 헤더 | **minor** | opt-in이므로 기존 동작 영향 없음 |
| 새 옵션 field 추가 | **minor** | 기존 동작 영향 없음 |
| 새 preset 추가 (`presets.X()`) | **minor** | |
| 새 정적 헬퍼 (`Helmet.X()`) | **minor** | |
| Permissions-Policy 신규 피처 (registry 기반) | **minor** | 자동 OWASP sync test가 PR 트리거 |
| 새 `HelmetErrorReason` / `HelmetWarningReason` 값 추가 | **minor** | exhaustive switch는 breaking 아님 (default 케이스 권장) |
| 새 framework adapter (`@zipbul/helmet/foo`) | **minor** | 새 subpath export |
| 버그 수정 | **patch** | 동작 정정 |
| 문서/JSDoc 개선 | **patch** | |
| serialize 형식 수정 (스펙 정정, 동작 변경 없음) | **patch** | golden file diff 동반 |
| OWASP JSON SHA bump (token-only 변경) | **patch** | 자동 PR + manual review |
| OWASP JSON SHA bump (신규 헤더) | **minor** | |
| OWASP JSON SHA bump (헤더 제거) | **major** | |

자동화: GitHub Actions weekly cron이 Permissions-Policy registry + OWASP JSON drift 감지 → 변경 종류에 맞는 changeset 자동 첨부 (`.changeset/*.md`) PR 생성. **auto-merge 금지**, manual review 후 changesets bot이 version PR 생성 → merge 시 npm publish.

### 헤더 폐기 대응

브라우저/표준 기관이 헤더를 폐기할 경우:

1. 해당 헤더 옵션에 `@deprecated` JSDoc + 마이그레이션 안내 (minor)
2. `helmet.warnings`에 `DeprecatedHeader` warning 송출 (minor)
3. 다음 major에서 Default-ON → Default-OFF 전환 또는 옵션 자체 제거
4. CHANGELOG에 마이그레이션 가이드 + 종속 컴플라이언스 표준 영향 (PCI/KISA/etc.) 명시

### CHANGELOG / Release

레포 표준 changesets (`.changeset/`) 사용. 각 변경 PR은 `.changeset/*.md` 포함:

```markdown
---
"@zipbul/helmet": minor
---

Add browsing-topics to Permissions-Policy Tier C (replaces interest-cohort).
```

자동화: `changeset-release/main` PR이 모든 changeset을 모아 version PR 생성 → merge 시 npm publish.

v2.0(major) 후보:

- X-XSS-Protection 제거 (KISA preset 사용자가 줄어들 때까지 잔존)
- X-Download-Options 제거 (IE EOL)
- X-DNS-Prefetch-Control Default-OFF 전환

### 에러 메시지 정책

- 런타임 에러 메시지는 **영문** (industry standard, `@zipbul/cors`와 일관). reason은 enum (`HelmetErrorReason`)으로 기계 판독
- JSDoc / README / CHANGELOG는 다국어 가능 (현재 한글)
- validate 에러는 batched — 모든 violation 포함: 위반 옵션 경로(`contentSecurityPolicy.directives.scriptSrc[2]`), 위반 사유 enum, 권장 수정 (`Use Csp.Self instead of bare "self"`)

## 참조 파일 (기존 패턴)

- `packages/cors/src/cors.ts` — 클래스 구조 (private constructor, static create() throws, handle/headers 패턴)
- `packages/cors/src/options.ts` — resolve/validate 패턴
- `packages/cors/src/interfaces.ts` — Error 클래스, Options 인터페이스
- `packages/cors/src/enums.ts` — Reason enum
- `packages/cors/package.json` — 패키지 설정 템플릿

## 보안 거버넌스

### 라이브러리 자체 보안 (input hardening)

- **입력 한도 (DoS 방지)** — 모든 사용자 입력에 명시 상한:
  - CSP `directives` 배열: 디렉티브당 소스 항목 ≤ 64
  - CSP 전체 디렉티브 키 ≤ 32
  - `removeHeaders.headers` 배열 ≤ 256
  - `permissionsPolicy.features` 키 ≤ 64, allowlist 항목 ≤ 32
  - `reportingEndpoints.endpoints` ≤ 32
  - `documentPolicy.policies` ≤ 64
  - `clearSiteData.directives` ≤ 8 (스펙상 7 + `*`)
  - `nonce` 길이 16-256자 (charset `^[A-Za-z0-9+/_-]{16,256}={0,2}$`)
  - 단일 헤더 값 길이 ≤ 16KB
  - `violations` / `warnings` 배열 ≤ 256 — **truncate sentinel 정책**:
    - violations: 첫 255개를 그대로 보존 + 256번째 슬롯에 `ViolationDetail { reason: HelmetErrorReason.TooManyViolations, path: '$', message: 'truncated at 256; N more suppressed' }` 추가. `N`은 truncate된 실제 개수 (raw 입력 echo 아님)
    - warnings: 동일 패턴, `HelmetWarningReason.TooManyWarnings` sentinel을 256번째 슬롯에
    - sentinel 추가 후 배열은 `Object.freeze` (deep-freeze 정책 일관)
    - 사유: 무제한 누적은 메모리/로깅 시스템 DoS. 침묵 truncate는 디버깅 불가능. sentinel은 truncate 사실을 기계 판독 가능하게 보장
- **Prototype pollution 방어** — 사용자 키 controlled record는 모두 `Map` 또는 `Object.create(null)`. `__proto__`, `constructor`, `prototype` 키는 `ReservedKeyDenied` 에러
- **Header injection 방어** — 모든 사용자 입력에서 거부:
  - C0 controls (U+0000–U+001F: NUL, CR, LF, TAB 등)
  - DEL (U+007F)
  - Unicode whitespace: U+00A0 NBSP, U+2028 LINE-SEP, U+2029 PARA-SEP, U+FEFF BOM
  - sf-string escape 외 raw `"`, `\`
- **Cache poisoning 방어** — nonce 주입은 `String.prototype.replaceAll(placeholder, () => value)` **함수 형식** 강제. string 두 번째 인자는 `$&` 등 메타문자 해석 → 캐시 손상 + cross-request 오염 가능
- **Information disclosure 방어** — `ViolationDetail.message`는 raw 사용자 입력 echo 금지. `path` + `reason` enum만 위치 식별
- **ReDoS 방지** — 모든 정규식은 CI에서 `recheck` / `safe-regex2` gate. host-source 등 불확정 정규식은 입력 길이 상한 2048자
- **Concurrency 안전** — JS event loop 단일 스레드 + frozen instance + per-call defensive copy로 안전. `Helmet` 인스턴스를 `worker_threads` `postMessage`로 전송 금지 (cloned되어 freeze가 끊김) — 각 worker가 자체 `Helmet.create()` 권장
- **WAF 호환 trade-off** — `xFrameOptions` 입력 case 보존. 사용자가 `===` 비교 시 case-sensitive 주의 (문서화)

### 공급망 (Supply chain)

- `SECURITY.md` — vulnerability disclosure (CRA Article 13 + NIS2 충족)
- `package.json`에 SBOM 메타데이터 (SPDX 또는 CycloneDX)
- **npm provenance** (`--provenance`) — Sigstore keyless 서명
- **SLSA Level 3** — `slsa-framework/slsa-github-generator` 사용:
  - Branch protection on `main` (linear history, required reviews, status checks)
  - Tag protection on `v*`
  - Environment protection on `npm-publish` GitHub environment (required reviewers + restricted to `release.yml`)
  - 빌드 격리: hosted runner only (self-hosted 금지)
- **의존성 정책**:
  - `eval`, `new Function()`, `child_process`, native bindings(`node-gyp`) 금지 — package.json scripts grep gate
  - `bun install --frozen-lockfile` CI 강제
  - Renovate/dependabot 주간 업데이트 + manual review (auto-merge 금지)
  - lockfile 변경 PR은 별도 reviewer 필수 (CONTRIBUTING.md 명시)
- **취약점 통보** — Cosign signed releases, GitHub Security Advisory 통합
- **OSV 등록** — public 취약점은 OSV.dev (Open Source Vulnerability) 등록
- `test/owasp-sync.test.ts`가 OWASP JSON drift 감지 → CI 실패 시 CHANGELOG 업데이트 의무
- 정기 dependency audit (`bun audit` weekly)
- 보안 리포트 통로: `security@zipbul.dev` (또는 GitHub Security Advisory)

### 라이선스 (vendored fixtures)

| 자료 | 라이선스 | 처리 |
|---|---|---|
| WPT (`web-platform-tests/wpt`) | BSD-3-Clause | `test/wpt/README.md`에 SHA pin + 라이선스 텍스트 보존 |
| `httpwg/structured-field-tests` | Apache-2.0 | `test/structured-field-tests/README.md`에 NOTICE + 라이선스 (Apache §4) |
| OWASP `headers_add.json` / `headers_remove.json` (JSON only) | Apache-2.0 | `test/owasp-fixtures/README.md`에 SHA + 라이선스 |
| OWASP Cheat Sheets (prose) | CC BY-SA 4.0 | **본 라이브러리 source 주석에 verbatim 복사 금지**. 패러프레이즈하거나 별도 `docs/` 디렉토리(CC-licensed sub-tree)에 격리 |
| W3C webappsec specs | W3C Software and Document License (3-clause BSD-style) | 인용/링크만, 패러프레이즈 |
| 본 라이브러리 라이선스 | Apache-2.0 (또는 MIT/Apache dual — repo 정책 따름) | LICENSE + NOTICE |

## 검증 방법

```bash
cd packages/helmet
bun test                                       # 모든 테스트 통과
bun test --coverage                            # 95% 이상
bun test test/owasp-sync.test.ts               # OWASP JSON 동기화
bun test test/observatory.test.ts              # nightly Observatory v2
bun test test/csp-fuzz.test.ts                 # CSP 파서 fuzz
bun run build                                  # dist/ 생성
```
