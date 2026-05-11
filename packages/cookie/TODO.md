# @zipbul/cookie TODO

## 완료

- [x] `cloneCookieWithValue`에서 `||` → `??` 변경 (`maxAge: 0`, `path: ""`, `expires: 0` 등 falsy 유의미 값 소실 버그)
- [x] `options.ts` 추출 — `resolveCookieParserOptions()` + `validateCookieParserOptions()` (Result 패턴)
- [x] `types.ts` 추가 — `ResolvedCookieParserOptions`, `ResolvedCookieDefaults`, `SigningAlgorithm`
- [x] `@zipbul/result` 의존성 추가
- [x] `create()` 리팩터 — resolve → validate → `if (isErr) throw` 패턴
- [x] CookieParserOptions 확장 — 쿠키 기본 속성 (httpOnly, secure, sameSite, path, domain, maxAge, expires, partitioned)
- [x] `createCookie()` 메서드 — 파서 기본값 병합 + 개별 쿠키 override
- [x] 서명 알고리즘 설정 — algorithm 옵션 (`sha256` | `sha384` | `sha512`)
- [x] Prefix 자동 검증 — prefixValidation 옵션
- [x] secure auto-detect — `secure: 'auto'` + `SerializeContext`
- [x] `serialize()` 확장 — nullable defaults 적용, auto-secure 해소, auto-prefix 검증
- [x] RFC 6265 / RFC 6265bis-22 / RFC 1034·1123 / NIST SP 800-38D·800-108 / RFC 5869 / FIPS 198-1 / CHIPS 표준 부합
- [x] HKDF-SHA256/384/512 키 도출 + 4-byte KID 박힘 (sign + encrypt 모두 strict 매칭)
- [x] `__Http-` / `__Host-Http-` prefix, `Priority=` attribute, `onEncrypt` IV 카운터 hook
- [x] `CookieJar.getSetCookieHeaders()` 병렬화
- [x] `test/{conformance,security,fuzz}/` git 트래킹 (330 테스트 / 라인 커버리지 99.49%)

## 계획

- 현재 cookie 파서 스코프 내 미해결 항목 없음.

## 의도적으로 스코프 밖

이 패키지가 책임지지 않는 항목 — 별도 패키지에서 처리:

- 세션 저장소, CSRF 토큰, observability/audit hook 통합 → 미들웨어 패키지
- 전체 PSL 데이터 자동 동기화 → `psl` / `tldts` 등을 `publicSuffixCheck` 옵션에 주입
- DBSC (Device-Bound Session Credentials) → 표준 미확정. cookie 파서가 아닌 인증 프로토콜 영역
