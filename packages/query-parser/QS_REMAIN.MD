# query-parser 잔존 이슈

리팩터링 커밋 `ba3411e` 기준, 원본 품질 리뷰 33개 항목 중 미해결 4건.

---

## 1. H3 — `decodeURIComponent` URIError 미처리

| 항목 | 내용 |
|------|------|
| 심각도 | High |
| 위치 | `src/query-parser.ts` — `processPair()` |
| 현상 | `%zz`, `%E0%A4` 등 잘못된 퍼센트 인코딩 입력 시 `decodeURIComponent`가 `URIError`를 던짐. try/catch 없이 전파되어 `QueryParserError`로 래핑되지 않음 |
| 영향 | 호출자가 `QueryParserError`만 catch하면 런타임 크래시. strict/non-strict 구분 없이 발생 |
| 해결 방향 | safe decoder 함수 도입 또는 `processPair` 내 try/catch + `Err<QueryParserErrorData>` 반환 |

```typescript
// 현재 코드 (문제)
const key = keyRaw.includes('%') ? decodeURIComponent(keyRaw) : keyRaw;

// 제안
const key = keyRaw.includes('%') ? safeDecodeURIComponent(keyRaw) : keyRaw;
```

---

## 2. M8 — `parameterLimit` 기본값 1000

| 항목 | 내용 |
|------|------|
| 심각도 | Medium |
| 위치 | `src/constants.ts` — `DEFAULT_QUERY_PARSER_OPTIONS.parameterLimit` |
| 현상 | 기본값 1000은 업계 표준(qs 라이브러리 등)과 동일하지만, 대부분 실제 사용에서는 과대 |
| 영향 | 기본 설정으로 DoS 표면이 넓어질 수 있음. 유효성 검사(≥1 정수)가 추가되어 위험은 완화됨 |
| 해결 방향 | 명시적 설계 근거 문서화 또는 기본값 하향 검토 (100~200 범위) |

---

## 3. T6 — 잘못된 인코딩 테스트 미흡

| 항목 | 내용 |
|------|------|
| 심각도 | Test |
| 위치 | `src/query-parser.spec.ts` |
| 현상 | 잘못된 퍼센트 인코딩 테스트(`should throw on malformed percent encoding`)가 `.toThrow()`만 검증. `URIError`가 아닌 `QueryParserError` 래핑을 검증해야 함 |
| 영향 | H3 해결 전까지는 현재 동작(URIError 전파)을 기록하는 수준. H3 해결 후 반드시 업데이트 필요 |
| 종속 | H3 해결 시 연동 수정 |

---

## 4. T7 — 통합 테스트 부재

| 항목 | 내용 |
|------|------|
| 심각도 | Test |
| 위치 | `test/` (빈 디렉토리) |
| 현상 | 리팩터링으로 미들웨어 제거 후 통합 테스트(`.test.ts`)가 전무. `TST-LAYER` 기준 `test/` 디렉토리에 cross-module 통합 테스트 필요 |
| 영향 | `QueryParser.create()` → `parse()` 흐름의 모듈 간 결합(options 해석 → 엔진 파싱 → Result 처리)이 통합 레벨에서 미검증 |
| 해결 방향 | `test/query-parser.test.ts` 작성 — `create` + `parse` public API 기반 end-to-end 시나리오 |
