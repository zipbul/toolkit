# @zipbul/cookie TODO

## 완료

- [x] `cloneCookieWithValue`에서 `||` → `??` 변경 (`maxAge: 0`, `path: ""`, `expires: 0` 등 falsy 유의미 값 소실 버그)
- [x] `options.ts` 추출 — `resolveCookieParserOptions()` + `validateCookieParserOptions()` (Result 패턴, 모노레포 공통 아키텍처)
- [x] `types.ts` 추가 — `ResolvedCookieParserOptions`, `ResolvedCookieDefaults`, `SigningAlgorithm`
- [x] `@zipbul/result` 의존성 추가
- [x] `create()` 리팩터 — resolve → validate → `if (isErr) throw` 패턴
- [x] CookieParserOptions 확장 — 쿠키 기본 속성 (httpOnly, secure, sameSite, path, domain, maxAge, expires, partitioned)
- [x] `createCookie()` 메서드 — 파서 기본값 병합 + 개별 쿠키 override
- [x] 서명 알고리즘 설정 — algorithm 옵션 (`sha256` | `sha384` | `sha512`)
- [x] Prefix 자동 검증 — prefixValidation 옵션
- [x] secure auto-detect — `secure: 'auto'` + `SerializeContext`
- [x] `serialize()` 확장 — nullable defaults 적용, auto-secure 해소, auto-prefix 검증
- [x] `cloneCookieWithDefaults()` — nullable defaults 적용 (sign/encrypt/unsign/decrypt)
- [x] 테스트 — options.spec.ts 신규, unit/integration/e2e 업데이트, 커버리지 100%
