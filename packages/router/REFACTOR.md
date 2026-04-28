# Router 리팩토링 계획서

> 본 문서는 `@zipbul/router` 의 코드 품질·구조·SRP·중복·일관성을 업계 최고 수준으로
> 끌어올리기 위한 리팩토링 계획이다. 모든 발견은 **file:line 으로 재현 가능한 사실**
> 이며, 추측은 배제했다. 서브에이전트 보고를 그대로 받아쓰지 않고 핵심 주장은
> 직접 코드를 읽어 교차 검증했다 — 일부 주장은 기각·완화되어 본 문서에 반영되지
> 않았다 (§ 부록 B 참조).

- 대상 디렉토리: `packages/router/`
- 라인 합계: src 4,069 lines (테스트 제외), test 추가 약 1,800
- 테스트: 561 pass / 0 fail (커버리지 라인 100%, branch 일부 81~86%)
- 재현 환경: Bun 1.3.13, x64-linux, Intel i7-13700K @ 5.45GHz

---

## 0. 베이스라인 (작업 직전 측정값)

작업 시작 시점 `bun run bench` 결과. 모든 후속 단계는 이 수치 대비 회귀 ±2 ns
이내, 핫패스 항목은 회귀 0% 를 목표로 한다.

### 0.1 핫패스 — 매칭

| 벤치 | avg | p75 |
|---|---:|---:|
| static match (10 routes) | 327.50 ps | 292.24 ps |
| static match (100 routes) | 428.28 ps | 291.99 ps |
| static match (500 routes) | 718.18 ps | 293.70 ps |
| static match (1000 routes) | 2.93 ns | 302.00 ps |
| param match: `/users/:id` | 40.08 ns | 37.79 ns |
| param match: `/users/:id/posts/:postId` | 47.06 ns | 46.16 ns |
| param match: 3-deep params | 61.41 ns | 61.13 ns |
| param match: 3-deep (org/team/member) | 85.29 ns | 83.45 ns |
| wildcard match: short suffix | 25.64 ns | 24.38 ns |
| wildcard match: deep suffix | 32.54 ns | 31.27 ns |
| wildcard match: very long suffix | 38.68 ns | 38.03 ns |
| 404 miss (10/100/1000 routes) | 16.50 / 14.16 / 14.83 ns | – |
| multi-method GET / POST / DELETE / PATCH | 44.71 / 44.59 / 45.32 / 47.86 ns | – |
| multi-method 405 (wrong method) | 3.66 ns | 3.62 ns |
| regex param `/:id(\d+)` | 45.91 ns | 43.44 ns |
| regex param 2-deep | 40.82 ns | 39.85 ns |
| regex param `/:id(\d+)/comments` | 48.51 ns | 47.71 ns |
| optional param `/en/docs` | 38.79 ns | 37.75 ns |
| optional param `/docs` (omitted) | 30.72 ns | 30.55 ns |
| optional nested `/:lang?/docs/:section` | 54.45 ns | 53.63 ns |

### 0.2 핫패스 — 캐시

| 벤치 | avg | p75 |
|---|---:|---:|
| cache hit (100) | 12.66 ns | 13.54 ns |
| cache hit (1000) | 15.31 ns | 15.37 ns |
| param cache hit `/users/:id` | 22.86 ns | 21.39 ns |
| param cache hit 3-deep | 15.37 ns | 14.93 ns |
| regex param cache hit | 12.17 ns | 10.99 ns |
| optional cache hit (with) / (without) | 16.02 / 13.57 ns | – |
| no-cache 100 / 1000 | 3.50 / 3.42 ns | – |
| param no-cache `/users/:id` | 31.20 ns | 30.01 ns |
| param no-cache 3-deep | 58.09 ns | 57.62 ns |

### 0.3 콜드패스 — full-options 매칭

| 벤치 | avg |
|---|---:|
| full-options static | 59.53 ns |
| full-options param | 85.60 ns |
| full-options wildcard | 87.82 ns |
| full-options trailing slash | 111.92 ns |
| full-options collapsed slashes | 75.19 ns |

### 0.4 빌드 시간

| 벤치 | avg |
|---|---:|
| add+build 10 / 100 / 500 / 1000 static | 115.78 µs / 197.03 µs / 456.93 µs / 793.38 µs |
| add+build 100 mixed | 229.60 µs |
| add+build 100 mixed + cache | 234.86 µs |
| addAll+build 100 / 500 / 1000 static | 192.36 µs / 479.60 µs / 818.27 µs |
| addAll+build 100 / 500 / 1000 param | 210.99 µs / 530.13 µs / 947.96 µs |

### 0.5 경쟁사 비교 베이스라인 (단계 A1 *시작 전* 캡처 의무)

§ 0.1~0.4 만으로는 *내부 회귀* 만 검출 가능. 경쟁 라이브러리 대비 절대
수치가 깨졌는지 (예: find-my-way 보다 빨랐던 항목이 느려졌는지) 는
별도 베이스라인 필요. **단계 A1 진입 전** 다음 4 종 베이스라인을
영속 저장한다 — 비영속 `/tmp` 사용 금지.

저장 경로: `packages/router/bench/baseline/` (git-tracked, 본 디렉토리
신설). 각 파일은 `bun run` 출력의 raw 텍스트 + 추출된 핵심 수치 표.

| 파일 | 내용 | 비교 대상 |
|---|---|---|
| `baseline/router.bench.txt` | § 0.1~0.4 전체 (`bench/router.bench.ts` raw 출력, ANSI strip) | 자체 회귀 |
| `baseline/comparison.bench.txt` | `bench/comparison.bench.ts` raw 출력 | find-my-way / hono / koa-tree-router / memoirist / rou3 |
| `baseline/complex-shapes.bench.txt` | `bench/complex-shapes.bench.ts` raw 출력 | 자체 (복잡 라우트 shape) |
| `baseline/percent-gate.bench.txt` | `bench/percent-gate.bench.ts` raw 출력 | decode 게이트 정책 |
| `baseline/env.txt` | OS / Bun 버전 / CPU / freq / 메모리 / 동시 부하 | 재현성 |

**캡처 절차 (단계 A1 PR 의 첫 commit)**:
```bash
cd packages/router
mkdir -p bench/baseline
bun run bench > bench/baseline/router.bench.txt 2>&1
bun run bench/comparison.bench.ts > bench/baseline/comparison.bench.txt 2>&1
bun run bench/complex-shapes.bench.ts > bench/baseline/complex-shapes.bench.txt 2>&1
bun run bench/percent-gate.bench.ts > bench/baseline/percent-gate.bench.txt 2>&1
{ uname -a; bun --version; lscpu | head -20; } > bench/baseline/env.txt
git add bench/baseline && git commit -m "bench: capture baseline for refactor"
```

**비교 정책 (단계 D2 + 모든 PR)**:
- 자체 회귀 (§ 0.1 핫패스 p75): ±2 ns 임계.
- 경쟁사 대비: *상대 순위* 가 떨어지지 않는지 확인. 절대 수치 ±5% 임계.
  (경쟁사 측정값도 같이 변동하므로 절대 임계는 무의미 — 순위·비율 기준)
- 모든 PR 의 머지 게이트: `bun run bench` + diff 출력 PR 본문 첨부.

---

## 1. 원칙 — 어떤 리팩토링도 다음을 위반하지 않는다

1. **기능 보존**: 모든 라우팅 시멘틱 (정적/파람/와일드카드/옵셔널/regex,
   404/405, 캐시, 충돌 검출 8 종) 은 동일 입력 → 동일 출력을 유지한다.
2. **성능 보존**: 핫패스 평균 회귀 0% 를 목표, 회귀 허용 한계는 ±2 ns.
3. **재현 가능성**: 본 문서의 모든 주장은 file:line 으로 재현된다.
   교차 검증된 기각 항목은 § 부록 B 에 별도 기록.
4. **export 경계 엄격화**: `index.ts` 노출 항목 외 어떤 내부 심볼도
   배럴 export · re-export · 우회 import 로 누수되지 않는다.
5. **테스트 통과**: 모든 단계에서 `bun test` 그린 유지. 단순 "561 pass"
   유지가 아니라 **§ 1.1 의 테스트 정책** 을 동시에 준수.
6. **단일 단계 PR**: 한 단계는 단일 리뷰 가능 PR (≤500 LOC diff) 로 묶는다.
7. **no abstraction speculation**: 가상의 미래 요구를 위한 추상화 금지 —
   현재 두 곳 이상에서 실제로 중복인 경우만 추출.

### 1.1 테스트 정책 (정석 통과 의무 — 우회 금지)

본 리팩토링 동안 *기존 테스트가 빨개지면 끄거나 모킹으로 우회하는 행위*
는 절대 금지. 다음 7 항목은 PR 머지 게이트.

1. **테스트 우회 금지**:
   - `it.skip` / `describe.skip` / `it.todo` / `xit` 사용 0 건. 단계 진행
     중 임시 사용 금지 (PR 시점에 0 건이어야 함).
   - 테스트 *삭제* 는 *동작이 의도적으로 제거된 경우* 만. 예: F9 의
     wildcardNames cross-method 충돌 검사 제거 → 기존 cross-method 충돌
     테스트는 *삭제* 가 아니라 *공존 동작 검증으로 수정*. 삭제 시 PR 본문에
     "동작 X 가 § F9 처방으로 제거됨" 명시 의무.
2. **모킹·스터빙 금지**:
   - private 메서드 stubbing, 내부 의존성 주입 우회 0 건. 외부 경계
     (사용자 코드 진입점) 만 spec 입력으로 사용.
   - `vi.spyOn` / `mock.module` 류 호출 0 건 (현재도 0 건 — 유지).
3. **타입 우회 정책** (단순 0 건이 아니라 *합법 / 불법* 분류):
   - **불법** — 0 건 강제:
     - `// @ts-ignore` / `// @ts-expect-error` (단, F8 contract test 의
       의도된 negative case 는 예외).
     - public API 의 *정상 호출* 결과를 `as any` 로 우회 (결과 타입을
       바꾸기 위한 캐스트).
   - **합법** — 명시적 의도가 있는 경우 허용:
     - 잘못된 입력 시뮬레이션: `router.add('PURGE' as any, '/x', v)` 형태.
       사용자 코드가 비-표준 HTTP method 문자열을 넘길 때의 동작을 검증.
     - guarantee/internal-state 테스트: `(r as unknown as { trees: ... }).trees`
       처럼 *내부 invariant 검증* 목적의 introspection. 이 경우 PR 본문에
       "internal-state inspection" 분류 명시.
   - 본 정책은 현재 `audit-repro.test.ts`, `router-cache.test.ts`,
     `router.test.ts`, `router-errors.test.ts`, `guarantees.test.ts`,
     `handler-rollback.test.ts` 의 기존 사용을 *합법* 으로 인정.
4. **신규 동작 → 신규 spec 의무**:
   - 단계 A5 wildcardNames 메서드별 분리 → method-scoped 충돌 / 메서드 횡단
     공존 spec 신규 추가.
   - 단계 A3 RouterErrData discriminated union → kind 별 narrowing spec
     (단계 F8 contract test 와 별개로 런타임 spec 도 추가).
   - 단계 B 4 레이어 분해 → 각 레이어 단위 테스트 (Registration / Build /
     Match) 신규 추가. Codegen 은 emit 출력 동등성으로 갈음 (audit-repro).
   - 단계 F1 createRouter 팩토리 → 모든 기존 `new Router(...)` spec 을
     `createRouter(...)` 로 일괄 마이그레이션 + factory 식별 spec 추가.
   - 단계 F2 phantom state → 잘못된 호출 (build 후 add 등) 이 컴파일
     에러임을 검증하는 type test (`tsd` 또는 contract test 활용).
5. **branch coverage 게이트**:
   - 단계 A~E: line 100% 유지, branch 회귀 0 (현 81~86% 유지 또는 상승).
   - 단계 F6 후: branch 100% PR 게이트 활성화. 그 이후 PR 은 branch 100%
     미달 시 머지 차단.
6. **property test 보존**:
   - `test/router.property.test.ts` 는 모든 단계에서 그린 유지. 단계 F7
     후 codegen property test 도 그린 유지.
7. **테스트 변경 PR 의 추가 의무**:
   - PR 본문에 변경된 테스트의 *변경 이유* (동작 변경 / 리팩토링 적응 /
     커버리지 보강) 를 분류 명시. 단순 "테스트 수정" 으로는 머지 불가.

> 본 정책의 목적: "561 pass" 라는 *숫자만 맞추기 위한 우회* 를 차단.
> 진짜 보장은 *모든 기존 라우팅 시멘틱이 변하지 않음을 모든 스펙이
> 정직하게 검증* 하는 것.

---

## 2. 검증된 발견 (Findings — 재현 가능)

각 항목은 `file:line` + 발췌 + 사실 + 근거 + 영향 + 처방 형식. 심각도는
`설계(상)` / `중복·일관성(중)` / `네이밍·주석(하)`.

### F1 [상] `Router` 클래스가 9 개 이상의 책임을 단일 클래스에 집약 (SRP 위반)
- 위치: `src/router.ts:90-941`
- 사실: 단일 클래스 `Router<T>` 가 ① 라우트 등록 (`add`, `addAll`,
  `addOne`), ② 메서드 코드 매핑, ③ 정적 라우트 맵, ④ 세그먼트 트리 빌드,
  ⑤ 충돌 검출 (`checkWildcardNameConflict`, `checkStaticWildcardConflict`),
  ⑥ codegen (`emitSpecializedWildMatchImpl` 64 lines, `emitGenericMatchImpl`
  159 lines), ⑦ 캐시 컨테이너 보유, ⑧ 경로 정규화 (`normalizePathForLookup`),
  ⑨ 매칭 디스패치 (`match`, `allowedMethods`) 를 모두 직접 보유.
- 근거: 파일 라인 941, 필드 15+, 메서드 11+. 직접 라인 카운트.
- 영향: 변경 사유가 9 가지 중 무엇이든 동일 클래스를 수정. 테스트 격리도
  Router 인스턴스 단위로만 가능 → 단위 테스트 의존도 과다.
- 처방: 단계 B 에서 4 개 협력자로 분해 (RegistrationLayer, BuildLayer,
  CodegenLayer, MatchLayer). § 단계 B 참조.

### F2 [상] `emitGenericMatchImpl` 159 줄 codegen 함수의 단일 책임 결손
- 위치: `src/router.ts:546-705`
- 사실: 단일 메서드가 ① closure 인수 15 개 패킹, ② 길이 검사 emit,
  ③ method dispatch emit, ④ 쿼리 strip emit, ⑤ trailing slash trim emit,
  ⑥ case fold emit, ⑦ 정적 lookup emit, ⑧ 캐시 hit/miss emit (조건부),
  ⑨ 트리 워커 호출 emit, ⑩ optional defaults emit, ⑪ `new Function` 컴파일,
  ⑫ factory 호출까지 한 함수에서 처리.
- 근거: 라인 546-705 직접 카운트. emit 헬퍼 (`emitPathLenCheck` 등) 를
  이미 추출했음에도 호출자 단일 함수 안에서 모든 단계가 직렬로 inline.
- 영향: 진단/수정 비용 매우 높고, codegen 의 분기 (캐시 on/off, optional
  on/off, dynamic on/off) 가 같은 함수에서 상태 폭발.
- 처방: 단계 C 에서 `MatchFunctionEmitter` 클래스로 추출. 각 단계 메서드
  로 분해 후 `compile()` 단일 진입점.

### F3 [상] `path-parser.ts` 의 SRP 분산 — 검증·정규화·파싱 혼재
- 위치: `src/builder/path-parser.ts:46-177` (`parse` 메서드)
- 사실: 단일 `parse()` 가 ① 첫 글자 `/` 검사 (48-54), ② 세그먼트 분할
  + lower-case + segment 길이 검사 (`normalizeSegments` 호출, 57-72),
  ③ 세그먼트 수 한도 (`MAX_SEGMENTS`) 검사, ④ 파람 수 한도 (`MAX_PARAMS`)
  검사, ⑤ 파람/와일드카드 토크나이즈 + 검증을 모두 수행.
- 근거: 메서드 길이 132 lines, 4 단계 명시적 식별 가능.
- 처방: § 단계 A2 — `validatePath`, `tokenize`, `parseTokens` 의 3 단계
  파이프라인으로 분해.

### F4 [상] `route-expand.ts` 폭증 가드와 조합 생성 결합
- 위치: `src/builder/route-expand.ts:32-128`
- 사실: `expandOptional` 한 함수가 ① optional param 인덱스 수집, ②
  `MAX_OPTIONAL` 가드, ③ 2^N 조합 생성, ④ 정적 세그먼트 병합 호출까지
  포함. 가드 로직 (라인 47-53) 이 수집 루프 내부에 inline 되어 있어
  "가드 단독 검증" 이 불가능.
- 근거: 라인 32-128 (97 lines) 단일 함수.
- 처방: § 단계 A2 — `validateOptionalCount` + `enumerateExpansions` +
  `mergeStaticParts` 3 함수로 분해.

### F5 [상] 데드 코드 — `PatternUtils.acquireCompiledPattern` + `compiledPatternCache`
- 위치: `src/builder/pattern-utils.ts:9, 16-39`
- 사실: `acquireCompiledPattern` 메서드 (24 lines) 와 `compiledPatternCache`
  필드 (line 9) 는 src 어디에서도 호출되지 않는다. 사용처는 오직
  `pattern-utils.spec.ts` 의 단위 테스트뿐.
- 근거: `grep -rn 'acquireCompiledPattern' src/ test/ index.ts` →
  `pattern-utils.spec.ts` 만 매치, src 호출자 0 건. matcher 의 `RegExp`
  컴파일은 `segment-tree.ts:158` 에서 `new RegExp(...)` 로 직접 수행.
- 처방: § 단계 A1 — 메서드·필드·해당 spec describe block 모두 삭제.
  관련 import (`Result`, `err`, `RouterErrData`) 도 미사용이 되면 함께 제거.

### F6 [상] `index.ts` 의 export 경계 — 내부 타입 누수 가능성과 비검증
- 위치: `index.ts:1-17`, `src/types.ts:29-31` (`PatternTesterFn`,
  `TesterResult`), `src/builder/types.ts` (`BuilderConfig`,
  `QuantifierFrame`, `RegexSafetyConfig`, `RegexSafetyAssessment`),
  `src/router.ts:114` (`import('./builder/path-parser').PathPart`)
- 사실: ① index.ts 가 type-only export 9 개를 한 번에 노출하지만,
  내부 전용 타입과 공개 타입을 구분해 명시한 주석/문서가 없다. ②
  router.ts 가 builder 내부 타입 `PathPart` 를 dynamic import 타입으로
  공개 메서드 시그니처에 포함시킴 — 이 메서드는 `private` 이므로 노출되진
  않으나 의존 방향이 역행 (top → builder).
- 근거: 직접 라인 확인. `PathPart` 는 builder 내부 IR 타입.
- 처방: § 단계 E — `PathPart` 를 builder 외부에 노출하지 않도록 router.ts
  의 직접 import 제거. 내부 IR 타입을 `src/types.ts` 의 internal 영역으로
  통합하거나 router 가 자체 타입으로 변환.

### F7 [중] `RouterErrData` 가 단일 인터페이스 — kind 별 discriminated union 결손
- 위치: `src/types.ts:58-75`
- 사실: `RouterErrData` 의 9 개 필드 중 필수는 `kind`, `message` 단 2 개,
  나머지 7 개 (`path`, `method`, `segment`, `conflictsWith`, `suggestion`,
  `registeredCount` 등) 는 모두 optional. kind 별로 어떤 필드가 강제되는지
  타입 시스템이 보장하지 않음.
- 근거: 라인 직접 확인. router.ts 의 에러 생성 9 곳에서 kind 별 필드
  채움 패턴이 일관되지 않음 (예: `route-conflict` 는 `segment`,
  `conflictsWith`, `method` 모두 채우지만 `route-parse` 는 `path`,
  `segment` 만).
- 처방: § 단계 A3 — kind 별 discriminated union 으로 재정의.
  ```ts
  type RouterErrData =
    | { kind: 'router-sealed'; message: string; suggestion: string; path?: string; method?: string }
    | { kind: 'route-duplicate'; message: string; path: string; method: string; suggestion?: string }
    | { kind: 'route-conflict'; message: string; segment: string; method: string; conflictsWith?: string }
    | { kind: 'route-parse'; message: string; path: string; segment?: string }
    | { kind: 'param-duplicate'; message: string; path: string; segment: string }
    | { kind: 'regex-unsafe' | 'regex-anchor'; message: string; segment: string; suggestion?: string }
    | { kind: 'method-limit'; message: string; method: string; path?: string }
    | { kind: 'segment-limit'; message: string; segment?: string; suggestion?: string };
  ```

### F8 [중] sealed / not-built 가드 / `isErr → throw RouterError` 변환 패턴 중복
- 위치: `src/router.ts:191-231`, `233-257`, `260-264`, 그리고 `match()` /
  `allowedMethods()` 의 build 전 가드.
- 사실: `add()`, `addAll()` 가 동일한 sealed 메시지·suggestion 텍스트를
  inline 으로 반복 (라인 195 vs 237). `isErr → throw new RouterError(...)`
  변환이 `add()` 에 3 회, `addAll()` 에 1 회 반복. `match()` 측의
  build-전 가드는 sealed 와 다른 kind (`not-built`) 를 가지므로 단일 헬퍼로
  통합 불가.
- 처방: § 단계 A4 — registration 측은 `assertNotSealed(ctx)` +
  `unwrapOrThrow(result, ctx)` 두 헬퍼로 통합. match 측은 § 단계 B4 에서
  MatchLayer 가 자체 `assertBuilt()` 를 보유하도록 분리 (kind 가 다르므로
  단계도 다름).

### F9 [중] `wildcardNames` 충돌 검사가 메서드 횡단 (의도 불명확)
- 위치: `src/router.ts:153, 802-844, 868`
- 사실: `wildcardNames: Map<string, string>` 가 메서드별로 분리되지 않음.
  주석 라인 868 "Check for wildcard name conflicts across methods" 은
  의도가 cross-method 임을 명시. 즉 `GET /api/*file` 등록 후
  `POST /api/*name` 은 `route-conflict` 로 거부됨.
- 근거: 라인 직접 확인. 단일 Map 자료구조.
- 평가: 본 정책의 근거가 코드·주석 어디에도 없음. cross-method 충돌은
  과도한 제약 — 메서드별 라우트는 독립적이므로 wildcard 이름도 메서드
  스코프여야 자연스럽다.
- 처방: § 단계 A5 — `Map<methodCode, Map<prefix, name>>` 로 분리.
  메서드별 스코프 검사로 변경.

### F10 [중] `MatchOutput<T>` 와 `CachedMatchEntry<T>` 의 부분 중복
- 위치: `src/types.ts:101-108`, `src/router.ts:54-57`
- 사실: 두 타입 모두 `value: T; params: ...`. CachedMatchEntry 는 meta
  없음 (lookup 시 STATIC/CACHE/DYNAMIC meta 가 별도 부착, 라인 618 등).
- 처방: § 단계 A3 — `MatchPayload<T>` 베이스 타입 도입, MatchOutput 은
  `MatchPayload<T> & { meta }`, CachedMatchEntry 는 `MatchPayload<T>` 의
  alias. 라인 절감 + 의도 명시.

### F11 [중] `MethodRegistry.getAllCodes` 의 결과를 router 가 매번 재구성
- 위치: `src/method-registry.ts:58-60`, `src/router.ts:266-270`
- 사실: `getAllCodes()` 가 `ReadonlyMap<string, number>` 반환. router.ts
  build() 에서 매번 NullProtoObj 로 변환하여 `methodCodes` 에 저장.
- 처방: § 단계 A6 — MethodRegistry 가 NullProtoObj 기반 저장소 제공
  (`getCodeMap(): Readonly<Record<string, number>>`). router.ts 변환 제거.
  Map 은 size·iteration 용도로만 유지.

### F12 [중] codegen 워커 결정 로직이 3 곳에 분산
- 위치: `src/matcher/segment-walk.ts:125-150` (`createSegmentWalker`),
  `src/matcher/segment-compile.ts:25-81` (`compileSegmentTree`),
  `src/router.ts:380-386, 433-454` (compileMatchFn dispatch /
  detectSingleMethodWildSpec)
- 사실: 4 종 워커 (specialized wildcard codegen / generic codegen /
  iterative / recursive) 의 선택 조건 (fanout cap, source size,
  ambiguous node) 이 세 파일에 흩어짐. 어느 워커가 어느 조건에서
  선택되는지 한 곳에서 설명 불가.
- 처방: § 단계 C2 — `WalkerStrategy` 타입 + `selectWalker(spec)` 단일
  진입점. 결정 함수에 모든 조건을 모은 뒤 4 개 builder 함수 중 하나 호출.

### F13 [중] `path-parser` 파람 검증 4 곳 반복
- 위치: `src/builder/path-parser.ts:237-272, 295-310, 341-365`
- 사실: `validateParamName(...)` 호출 + `activeParams.has(name)` 검사 +
  duplicate 에러 생성 + `activeParams.add(name)` 의 4 줄 패턴이 4 곳에서
  중복 (param `+`, `*`, 일반, wildcard).
- 처방: § 단계 A2 — `registerParam(name, kind)` 헬퍼 추출.

### F14 [중] codegen `JSON.stringify` escape 정책 미문서화
- 위치: `src/matcher/segment-compile.ts:129, 217, 226, 251, 260, 304,
  313-314, 335, 344, 368, 407`
- 사실: codegen emit 에서 사용자 입력 (param/wildcard name, prefix) 을
  `JSON.stringify(...)` 로 감싸 JS 문자열 리터럴화. 안전성은 path-parser
  의 `validateParamName` 메타문자 차단 (`builder/path-parser.ts:437-468`)
  으로 보장됨. 단, 이 보장이 codegen 측에 명시적 코멘트로 표현되지 않음.
- 처방: § 단계 C1 — `segment-compile.ts` 상단에 escape 정책 코멘트.
  `escapeJsString(s)` 어휘 별칭 도입 (의도 명시, 동작 동일).

### F15 [중] `pattern-utils.normalizeParamPatternSource` 의 암묵 반환
- 위치: `src/builder/pattern-utils.ts:41-84`
- 사실: 시그니처 `Result<string, RouterErrData>`. 라인 44-45 의 빈 문자열
  분기에서 `return normalized` (빈 string) 반환. `Result<T,E> = T | Err<E>`
  유니온이라 타입상 valid (string 도 T) 하지만, `''` 는 caller 에서
  `''+slash` 같은 다운스트림에서 별도 처리되지 않음.
- 처방: § 단계 A2 — 빈 입력은 caller 에서 사전 체크하도록 옮기거나,
  `'.*'` 으로 fallback 명시.

### F16 [중] codegen emit 변수명 비-fresh 일관성 결여 (`qi`, `len`, `mc` 등)
- 위치: `src/matcher/path-normalize.ts:32-34` (`var qi`),
  `src/matcher/segment-compile.ts` 의 emit 블록 다수 (`var len`, `var mc`,
  param/value 임시변수 등 — 라인 113 의 `fresh()` 카운터를 우회한 hard-coded
  변수명이 산재)
- 사실: `segment-compile.ts:113` 에 이미 `fresh()` 카운터 헬퍼가 존재하나
  path-normalize 와 일부 segment-compile emit 분기가 이를 사용하지 않고
  하드코딩 식별자를 emit. 현재는 builder 단위로 emit 스코프가 격리되어
  있어 실제 충돌은 발생하지 않으나, 단계 B/C 에서 emit 합성 단위가 바뀌면
  strict-mode 재선언 에러로 회귀할 수 있음.
- 처방: § 단계 C1 — `fresh()` 카운터를 모든 emit 헬퍼의 단일 진입점으로
  통일. path-normalize 와 segment-compile 의 하드코딩 식별자를 일괄
  교체. 단순 일관성 개선이 아니라 단계 B/C 분해의 안전 가드.

### F17 [중] segment-walk 단일-파람 fast path 와 sibling loop 코드 중복
- 위치: `src/matcher/segment-walk.ts:205-269`
- 사실: head 인라인 처리 (205-236) 와 sibling loop (240-269) 가 거의
  동일한 tester 검사 + match 호출 + state.params 할당 로직 반복.
- 평가: 단일-파람 fast path 는 의도된 분기 (커밋 abb90cd 의 1-2 ns 회복분).
  함수 추출이 이 회복분을 깨뜨리지 않는지 벤치로 검증 필요.
- 처방: § 단계 D1 — 인라인 helper (JSC DFG/FTL 인라이닝 의존) 형태로
  추출 후 bench 비교. 회귀 시 코멘트로 의도 명시 후 원복.

### F18 [하] private 필드 `_` 접두사 일관성 결여
- 위치: `src/router.ts:95-102`
- 사실: 5 개 필드만 `_` 접두사 (`_ignoreTrailingSlash`, `_caseSensitive`,
  `_maxPathLength`, `_maxSegmentLength`, `_normalizePath`). 나머지 10+
  private 필드는 접두사 없음.
- 처방: § 단계 A4 — 모두 제거. TypeScript `private` 키워드로 충분.

### F19 [하] `OptionalParamDefaults.isEmpty` 의 단축 평가 중복
- 위치: `src/builder/optional-param-defaults.ts:32-34`
- 사실: `behavior === 'omit' || defaults.size === 0`. 그러나 record(...)
  가 `behavior === 'omit'` 시 항상 early-return 하므로 (라인 14-15),
  `omit` 인 경우 `defaults.size` 는 항상 0. 좌항 검사가 redundant.
- 처방: § 단계 A1 — `defaults.size === 0` 단축.

### F20 [하] `processor/` 디렉토리에 17 줄 단일 파일 (`decoder.ts`)
- 위치: `src/processor/decoder.ts`
- 사실: 디렉토리 단독 파일. 사용처는 router.ts 1 곳, segment-walk.ts 1 곳뿐.
- 처방: § 단계 A1 — `matcher/decoder.ts` 로 이동, processor/ 디렉토리
  제거. import 그래프 단순화 (matcher 단일 트리).

### F21 [하] `constants.ts` 가 정규식 패턴만 보유 — charCode 매직 넘버 흩어짐
- 위치: `src/builder/constants.ts:1-3`, `src/builder/path-parser.ts:48,
  78, 102, 104, 139, 195, 198, 208, 210, 451-453`
- 사실: `47=/`, `58=:`, `42=*`, `63=?`, `43=+`, `40=(`, `41=)` 의
  charCodeAt 비교가 path-parser 에 산재. constants.ts 에는 이런 상수
  없음. path-parser.ts:451-453 에 코드맵 주석만 존재.
- 처방: § 단계 A1 — `constants.ts` 에 charCode 상수 추가. path-parser
  의 모든 매직 비교를 식별자로 교체.

### F22 [하] `segmentTrees` build() 후 freeze 미적용
- 위치: `src/router.ts:119, 264, 919-923`
- 사실: `sealed` flag 가 add 경로를 차단하지만 `segmentTrees` 배열
  자체는 freeze 되지 않음. 외부에서 prototype-pollution 등으로 접근
  가능성은 없으나 명시적 immutable 표현 부재.
- 처방: § 단계 A4 — build() 종료 시 *build-only* 테이블에만
  `Object.freeze` 적용 (`segmentTrees`, `wildSpecs`, `staticMap`,
  `staticRegistered`, `activeMethodCodes`). **핫패스 lookup 테이블
  (`handlers`, `trees`, `staticOutputsByMethod`, `methodCodes`) 은 의도적
  비-동결** — 컴파일된 matchImpl 이 closure-capture 한 frozen 객체를
  매 dynamic match 시 인덱싱하면 JSC inline cache 가 degrade 되어
  5-10 ns/match 회귀 (bench 검증 결과). `sealed` 가 모든 외부 변형
  경로를 거부하므로 비-동결로 인한 실질적 위험은 0.

### F24 [중] `MAX_PARAMS = 32` 상수 분산 (path-parser ↔ match-state)
- 위치: `src/builder/path-parser.ts:85, 88` (`> 32`, 메시지 `"the maximum
  of 32"` 하드코딩), `src/matcher/match-state.ts:35` (`const MAX_PARAMS
  = 32`), `src/builder/route-expand.ts:14` (`const MAX_OPTIONAL = 10`).
- 사실: 동일 파라미터 한도가 builder 측은 매직 넘버 `32`, matcher 측은
  상수 `MAX_PARAMS` 로 분리. 둘이 어긋나면 builder 가 허용한 라우트를
  matcher 의 사전 할당 배열이 못 받는 silent corruption 위험. 현재는
  값이 동일해 안전하나 타입·상수 단일 소스가 없음.
- 처방: § 단계 A1 (F21 charCode 통합과 동시) — `src/constants.ts` 또는
  `src/builder/constants.ts` 에 `MAX_PARAMS`, `MAX_OPTIONAL`, `MAX_SEGMENTS`
  를 단일 정의로 모으고 path-parser / match-state / route-expand 가 동일
  심볼 import. 매직 넘버 0 건 화.

### F25 [상] `Router` 가 facade 임에도 class — 인스턴스화 비용·`instanceof` 오용 위험
- 위치: `src/router.ts:90` (현재), B5 후 ~120 lines facade.
- 사실: B5 완료 후 Router 의 모든 메서드는 1~3 줄 위임. 클래스 보유 명분
  (식별·`instanceof`·private state) 이 코드·문서 어디에도 명시되지 않음.
  외부 사용자가 `instanceof Router` 분기를 작성할 명분도 없음 (테스트
  코드베이스 grep 결과 0 건).
- 처방: § 단계 F1 — `createRouter<T>(opts): RouterApi<T>` 팩토리 함수로
  전환. `RouterApi<T>` 는 `add/addAll/build/match/allowedMethods/clearCache`
  를 보유한 frozen object. 인스턴스 식별이 필요한 외부 사용자는 brand
  symbol 로 처리. 클래스 제거로 `this` 인라이닝 의존 0 건.

### F26 [상] Router 라이프사이클이 boolean flag 산재 — 상태 머신 부재
- 위치: `src/router.ts:119` (`sealed`), `src/router.ts` build 완료 표시는
  `matchFn !== null` 로 *암묵* 표현. B 단계 후에도 `pipeline/registration.ts`
  의 `sealed`, `pipeline/match.ts` 의 `built` 가 분리된 boolean.
- 사실: 라이프사이클 `Unsealed → Sealed → Built` 가 독립 boolean 두 개로
  표현되어 `Unsealed && Built` 같은 *불가능한 상태* 가 타입상 합법.
  `assertNotSealed` / `assertBuilt` 가드는 런타임 검사일 뿐.
- 처방: § 단계 F2 — phantom type 으로 상태 머신 강제.
  ```ts
  type RouterApi<T, S extends 'unsealed' | 'built'> = ...;
  add(...): RouterApi<T, 'unsealed'>;     // 'built' 에서 호출 시 컴파일 에러
  build(): RouterApi<T, 'built'>;
  match(...): MatchOutput<T> | null;       // 'built' 에서만 가능
  ```
  런타임 가드는 보존 (외부 from-untyped 진입 보호).

### F27 [중] `Result<T, E> = T | Err<E>` duck-typing — narrow 실수에 취약
- 위치: `packages/result/src/types.ts` (별도 패키지, 본 리팩토링 대상은
  consumer 측). `src/builder/path-parser.ts`, `pattern-utils.ts`,
  `regex-safety.ts`, `method-registry.ts` 가 `isErr(r)` 로 분기.
- 사실: bare T 와 `Err<E>` 가 같은 자리에서 반환되므로 narrowing 누락 시
  `Err` 객체가 T 처럼 다운스트림 흐를 수 있음. TypeScript `--strict` 도
  `T = unknown` 케이스에서 가드 우회 가능.
- 처방: § 단계 F3 — `Result` 를 태그 유니온으로 마이그레이션 가능성 평가.
  `{ ok: true; value: T } | { ok: false; error: E }`. **선결**: 태그
  객체 할당 비용 측정 (router 핫패스에는 Result 없음, 빌드 패스에만
  존재 — 영향 작을 것으로 예측, 그러나 정량 필요). 본 패키지 외부 영향
  분석 후 채택 여부 결정.

### F28 [중] codegen 이 string concat — typed emit IR 부재
- 위치: `src/codegen/segment-compile.ts` 전반 (C1 후 위치), `src/codegen/
  emitter.ts` (B3 후 위치).
- 사실: emit 이 `\`...\${JSON.stringify(name)}...\`` 같은 raw 문자열 합성.
  `escapeJsString` alias (F14, C1) 로 안전성은 명시되지만, *식별자 충돌*
  (F16) / *escape 누락* / *변수 누수* 는 여전히 *런타임 가드* (fresh()
  + audit-repro.test 스냅샷) 에만 의존.
- 처방: § 단계 F4 — typed emit IR 도입.
  ```ts
  type EmitNode =
    | { kind: 'lit'; src: string }
    | { kind: 'id'; name: string }      // 자동 fresh
    | { kind: 'str'; value: string }    // 자동 escape
    | { kind: 'block'; body: EmitNode[] };
  function serialize(nodes: EmitNode[]): string;
  ```
  emit 결과 바디는 byte-for-byte 동일 (리팩토링 invariant). 식별자 누수와
  escape 누락이 *컴파일타임* 에 차단됨.

### F29 [하] generic `T` 단일 문자 — 의도 표현 부족
- 위치: `src/router.ts:90` (`Router<T>`), `src/types.ts:101`
  (`MatchOutput<T>`), `src/router.ts:54` (`CachedMatchEntry<T>`),
  pipeline/* 전반.
- 사실: `T` 가 *handler value type* 인지 *route metadata* 인지 식별자
  자체로 표현되지 않음. 결벽증 코드베이스는 `THandler` 또는 `TValue` 사용.
- 처방: § 단계 F5 — `T` → `THandler` 일괄 rename. 외부 노출 제네릭
  파라미터 이름 변경은 *타입 이름 동등성* 영향 없음 (구조 동일).

### F30 [중] branch coverage 81~86% 잔존 (line 100% 이지만)
- 위치: § 0 baseline 기록. `coverage` 출력에서 일부 builder/* 와
  matcher/* 의 branch 커버리지 미달.
- 사실: § 0 의 측정값 외 본 문서가 100% 화 작업을 단계로 정의하지 않음.
- 처방: § 단계 F6 — coverage 100% line + branch 도달까지 누락 분기마다
  spec 추가. 단계 F6 후 PR 게이트 (`bun run coverage` branch 100% 미만
  머지 차단) 도입.

### F31 [중] codegen property-based test 부재
- 위치: `test/audit-repro.test.ts` 단일 스냅샷, `test/walker-fallbacks.test.ts`
  4 strategy 커버.
- 사실: 임의 라우트 shape (random tree fanout / depth / param mix) 에서
  emit 산출물이 invariant (동일 입력 → 동일 출력, 모든 경로 커버) 를
  유지하는지 *fuzzing 검증 부재*.
- 처방: § 단계 F7 — `fast-check` 도입 (외부 의존 1 건 추가, dev only).
  `route-spec → emit → eval → match-result` 의 round-trip 을 1000+ 케이스
  자동 검증.

### F32 [중] public API contract test 부재 — signature drift 무방어
- 위치: `index.ts:1-17` 의 9 개 type + 2 개 class export.
- 사실: 외부 사용자 시점의 시그니처 변경 (예: `Router.add` 의 인자 순서
  변경, `MatchOutput` 의 필드 추가) 이 타입 테스트 없이 통과 가능. § E2
  는 *내부 누수 차단* 만 검증.
- 처방: § 단계 F8 — `test/public-api.contract.ts` 신설. `expectType<...>`
  / `expectAssignable<...>` 으로 시그니처 동등성 강제. RouterErrData
  discriminated union 의 narrowing 결과도 동시 가드.

### F33 [하] 에러 메시지가 각 사이트 inline — 카탈로그 부재
- 위치: `src/builder/path-parser.ts` 의 에러 메시지 8 곳, `src/router.ts`
  9 곳, `src/builder/route-expand.ts` / `regex-safety.ts` / `method-registry.ts`
  각 1~2 곳.
- 사실: 에러 메시지가 영문 inline 문자열. 동일 카테고리 (예: `route-parse`)
  메시지 포맷이 사이트마다 다름.
- 처방: § 단계 F9 — `src/error-messages.ts` 단일 카탈로그 + 포맷터 함수.
  RouterErrData discriminated union (F7) 의 각 kind 가 자기 메시지
  포맷터를 보유. 외부 i18n 가능성도 동시 확보.

### F23 [하] `route-expand.mergeStaticParts` 의 `//` 정규화 — 서로 다른 invariant 보호
- 위치: `src/builder/route-expand.ts:86-104` (skip 분기의 trailing-slash
  trim) 과 `route-expand.ts:130-151` (mergeStaticParts 의 `//` → `/`)
- 사실: 두 위치는 표면상 유사하지만 invariant 가 다르다. 라인 86-104 는
  *드롭된 optional 직전 static* 의 trailing slash 만 trim 하고, 130-151 은
  *연속 static part 병합 후* 발생하는 `//` 를 정규화한다. 라인 123 의
  empty fallback (`/`) 까지 고려하면 두 패스는 각각 다른 케이스를 커버.
- 처방: § 단계 A2 — mergeStaticParts 를 *순수 concat 으로 단순화하지 말 것*.
  대신 두 invariant 를 **명시적 docstring** 으로 분리 기록하고, property
  test (router.property.test.ts) 로 `//` 가 어떤 입력에서도 발생하지
  않음을 검증. 처방 우선순위는 가장 낮음 — 동작 변경 금지.

---

## 3. 단계별 리팩토링 계획

각 단계는 **독립 PR** 로 머지 가능. 각 PR 후 561 tests + 핫패스 bench
회귀 ±2 ns 검증 필수. 단계 간 의존성은 명시.

### 단계 A — 저위험 정리 (의존 없음, 병렬 PR 가능)

이 단계는 코드 형태에는 영향이 있지만 동작 의미·핫패스 codegen 은
변하지 않는다. 가장 먼저 수행 — 후속 단계의 diff 면적을 줄임.

#### A1. 데드 코드 / redundancy 제거 / 매직 상수 통합 (≈ −80 LOC)
- F5: `PatternUtils.acquireCompiledPattern`, `compiledPatternCache` 필드
  + spec describe block 삭제. 미사용 import 제거.
- F19: `OptionalParamDefaults.isEmpty` → `defaults.size === 0`.
- F20: `processor/decoder.ts` → `matcher/decoder.ts`. router.ts import
  업데이트. processor/ 디렉토리 삭제.
- F21 + F24: `src/builder/constants.ts` 에 charCode 상수 + `MAX_PARAMS`
  (32) + `MAX_OPTIONAL` (10) + `MAX_SEGMENTS` 를 단일 정의로 추가.
  path-parser / match-state / route-expand 의 매직 넘버 0 건 화.
- 검증: `bun test`, `bun run bench` 회귀 ±0.5 ns.

#### A2. builder 파이프라인 분해 (`path-parser`, `route-expand`, `pattern-utils`)
- F3: `PathParser.parse` 를 `validatePath → tokenize → parseTokens` 의
  3 단 파이프라인으로 분해. 중간 단계는 `private` 으로 유지.
- F13: `registerParam(name, kind, path)` 헬퍼 추출, 4 곳 호출자 단순화.
- F4: `expandOptional` 을 `collectOptionalIndices` + `validateOptionalCount`
  + `enumerateExpansions` + `mergeStaticParts` 의 4 함수로 분해.
- F15: `normalizeParamPatternSource` 빈 입력 처리 명시. caller 사전 체크
  추가.
- F23: `mergeStaticParts` 를 순수 concat 으로. trailing slash 정리는
  `enumerateExpansions` 에 단일화.
- 검증: builder/*.spec.ts (path-parser.spec / route-expand 신규 / regex-safety)
  100% 유지. property tests (`router.property.test.ts`) 통과.

#### A3. 타입 정합화 (RouterErrData / MatchPayload)
- F7: `RouterErrData` discriminated union 으로 재정의. 모든 에러 생성
  사이트의 필드 누락 지점을 컴파일 타임에 검출.
- F10: `MatchPayload<T>` 베이스 타입 도입.
- 영향 파일: `types.ts`, `router.ts` 에러 생성 9 곳, `path-parser.ts`
  에러 생성 8 곳, `route-expand.ts` 1 곳, `regex-safety.ts` 1 곳,
  `method-registry.ts` 1 곳.
- 검증: 단일 type assertion 추가 없음 (= as any 0 건). spec 통과.

#### A4. router.ts 마이크로 정리
- F8: `assertNotSealed(ctx)` / `unwrapOrThrow(result, ctx)` 헬퍼.
  add/addAll 단순화.
- F18: `_` 접두사 5 개 일괄 제거.
- F22: build() 후 *build-only* 테이블 동결 (`segmentTrees`, `wildSpecs`,
  `staticMap`, `staticRegistered`, `activeMethodCodes`). `handlers` /
  `trees` / `staticOutputsByMethod` / `methodCodes` 는 hot-path 에서
  closure-capture 되어 매 dynamic match 시 인덱싱되므로 비-동결 (JSC IC
  degradation 5-10 ns/match 회피).
- 검증: freeze partition lock-in spec 추가 (frozen 5 / not-frozen 4 +
  TypeError throw 시도). bench: 핫패스 ±1 ns 이내.

#### A5. wildcardNames 자료구조 메서드별 분리
- F9: `wildcardNames: Map<string, string>` 을 `wildcardNamesByMethod:
  Map<number, Map<string, string>>` 로 변경 (key = methodCode).
  `checkWildcardNameConflict`, `checkStaticWildcardConflict` 가 method
  스코프 내에서만 검사하도록 수정. 메서드 횡단 충돌은 더 이상 발생하지
  않음 (예: `GET /api/*file` + `POST /api/*name` 공존 가능).
- 검증: 기존 충돌 검사 spec 의 메서드 횡단 케이스가 있는지 확인.
  있으면 메서드별로 분리하여 갱신, 없으면 새 spec 추가.

#### A6. MethodRegistry 강화
- F11: `getCodeMap(): Readonly<Record<string, number>>` 추가. router.ts
  의 변환 코드 (266-270) 제거. 기존 `getAllCodes()` 는 backwards-compat
  레이어 없이 그대로 유지 (활성 메서드 카운트에 사용 — 라인 333-341).
- 검증: method-registry.spec 100% 유지.

### 단계 B — Router 클래스 분해 (F1) — `pipeline/` 디렉토리 신설

> 디렉토리 정책: 단계 B 의 4 레이어 중 **build/codegen/match 의 시점이
> 다르므로** (build-time vs runtime) 한 디렉토리에 모으지 않는다.
> Registration / Build / Match 의 *파이프라인 본체* 만 `pipeline/` 에
> 모으고, Codegen 은 단계 C 에서 별도 `codegen/` 디렉토리로 분리한다.
> Build 는 codegen 의 emit 결과를 소비하는 build-time 협력자 — pipeline
> 측에 둔다 (런타임 의존 없음).

#### B1. Registration 추출 → `src/pipeline/registration.ts`
- 책임: add / addAll / addOne / 충돌 검사 (`checkWildcardNameConflict`,
  `checkStaticWildcardConflict`) / staticMap / staticRegistered /
  segmentTrees / handlers / wildcardNamesByMethod (A5 적용 후) /
  activeMethodCodes 계산.
- 시그니처:
  ```ts
  class Registration<T> {
    constructor(opts: BuilderConfig, methodReg: MethodRegistry, parser: PathParser, optDefaults: OptionalParamDefaults);
    add(method, path, value): void;
    addAll(entries): void;
    seal(): RegistrationSnapshot<T>; // 이후 Build 가 소비
  }
  type RegistrationSnapshot<T> = {
    staticMap, staticRegistered, segmentTrees, handlers,
    activeMethodCodes, methodCodes, wildSpecs,
  };
  ```
- Router 는 `private registration: Registration<T>` 만 보유.

#### B2. Build 추출 → `src/pipeline/build.ts`
- 책임: build() 의 트리 컴파일 (`createSegmentWalker`), normalizer
  생성 (`buildPathNormalizer`), MatchConfig 조립. Codegen 호출 진입점.
- 시그니처:
  ```ts
  class Build<T> {
    static fromRegistration(snapshot: RegistrationSnapshot<T>, opts: RouterOptions): MatchConfig<T>;
  }
  ```

#### B3. Codegen 추출 → `src/codegen/emitter.ts` (F2 처방 포함)
- **디렉토리 신설**: `src/codegen/` 을 별도 도입 (단계 C 에서 채워짐).
  본 단계에서는 `emitter.ts` 만 추가.
- 책임: `MatchFunctionEmitter` 클래스, `emitSpecializedWildMatchImpl` /
  `emitGenericMatchImpl` 의 단계별 메서드 분해. closure 인수 패킹은
  builder 메서드 1 개로 격리.
- **성능 가드 (필독)**: 본 분해는 *codegen 파이프라인* (build-time, 비-핫
  패스) 만을 재배치한다. emit 결과로 `new Function(...)` 으로 생성되는
  매칭 함수의 *바디 문자열* 은 byte-for-byte 동일해야 한다. PR 검증 시
  emit 출력을 baseline 과 diff 하여 동일성 확인 (`audit-repro.test`
  스냅샷 활용). 매칭 함수 내부에 layer 메서드 호출이 새로 끼어드는 변경은
  금지 — JSC FTL 인라이닝이 깨지면 § 0.1 의 핫패스 회귀 즉시 발생.

#### B4. Match 추출 → `src/pipeline/match.ts`
- 책임: `match`, `allowedMethods`, `clearCache`, `normalizePathForLookup`.
- 캐시 컨테이너는 본 레이어가 보유. `enableCache=false` 일 때 노드
  자체가 생성되지 않도록 분기.
- F8 not-built 가드: `assertBuilt()` private 메서드 보유 (registration
  측 `assertNotSealed` 와 다른 kind 이므로 분리).

#### B5. Router facade 재조립 → `src/router.ts` (~120 lines)
- Router 는 3 파이프라인 레이어 (registration / build / match) +
  codegen emitter 를 조립하는 thin facade. 공개 API (add, addAll, build,
  match, allowedMethods, clearCache) 시그니처는 동일.
- 모든 메서드는 1~3 줄 위임 — substance 없음 (의도된 표면화).

> 검증 (B1~B5): 매 단계마다 `bun test`, `bun run bench`. 마지막 B5 후
> diff 가 ≥1500 LOC 이면 두 PR 로 분할 (B1+B2 / B3+B4+B5).

### 단계 C — codegen 정합화 → `src/codegen/` 채우기

> 단계 C 에서 `codegen/` 디렉토리를 완성한다. matcher/ 에 있던
> *build-time 전용* 모듈을 codegen/ 으로 이동시키고 walker-strategy 를
> 신설하여 *시점 (build vs runtime)* 으로 디렉토리 경계를 정렬한다.
> matcher/ 에는 *순수 런타임* 모듈만 남는다.

#### C1. emit 헬퍼 정합 / fresh 카운터 / escape 정책 (F14, F16)
- 이동: `src/matcher/segment-compile.ts` → `src/codegen/segment-compile.ts`
  (build-time 전용이므로 codegen/ 가 적정 위치).
- 신규: `src/codegen/escape.ts` — `escapeJsString(s)` alias + escape 정책
  docstring (메타문자 차단은 `builder/path-parser.ts:437-468` 의
  `validateParamName` 에서 보장됨을 명시).
- 수정: `src/matcher/path-normalize.ts:emitQueryStrip(...)` fresh 카운터
  받도록 시그니처 변경. `src/codegen/segment-compile.ts` 의 `var len`,
  `var mc` 등 하드코딩 식별자를 fresh() 로 일괄 교체.
- 검증: codegen-sensitive 테스트 (walker-fallbacks.test, audit-repro.test)
  통과 + emit 바디 byte-diff 0.

#### C2. 워커 디스패치 통합 (F12) → `src/codegen/walker-strategy.ts`
- 신규 모듈: `enum WalkerStrategy { SpecializedWild, Generic, Iterative,
  Recursive }` + `selectWalker(spec): WalkerStrategy` 단일 진입.
- 이동: `src/matcher/segment-walk.ts` 에서 detection 함수
  (`detectWildCodegenSpec`, `hasWideFanout`, `hasAmbiguousNode`) 와
  `src/router.ts` 의 `detectSingleMethodWildSpec` 을 모두 walker-strategy
  로 이동. segment-walk.ts 는 *런타임 워커 함수* 만 보유.
- `createSegmentWalker(spec, strategy)` 시그니처: strategy 를 인자로 받아
  builder 함수만 호출. 결정 로직 0 건.
- 검증: walker-fallbacks.test 가 모든 4 strategy 를 커버하는지 확인.

### 단계 D — 성능 검증 / 회귀 가드

#### D1. 단일-파람 fast path 보존 검증 (F17)
- 후보 변경: 인라인 helper 추출. abb90cd 회복분 (~1-2 ns) 이 깨지는지
  micro-bench (`param match: /users/:id` 40.08 ns 기준) 비교.
- 회귀 ≥ 1 ns 시 원복 + "intentional duplicate, JSC inlining 의존" 코멘트.

#### D2. 전체 벤치 회귀 검증 (baseline 디렉토리 대비 diff)
- `packages/router/bench/baseline/*.txt` 의 § 0.5 캡처본과 *현재 측정값*
  을 동일 박스에서 동일 절차로 비교.
- `bun run bench` 전체 비교 (벤치 § 0.1~0.4 항목 모두). p75 기준 ±2 ns 이내.
- `bench/comparison.bench.ts` (find-my-way / hono / koa-tree-router /
  memoirist / rou3) — *상대 순위* 보존, 절대 수치 ±5% 이내.
- `bench/complex-shapes.bench.ts` 회귀 없음 확인.
- `bench/percent-gate.bench.ts` 결과 첨부 (decode 게이트 정책 보존 검증).
- 산출물: `bench/baseline/diff.md` — 단계 D 종료 시 baseline 대비 diff
  표를 PR 본문에 첨부.

### 단계 E — Export 경계 정리 (F6)

#### E1. 내부 타입 외부 누수 차단
- `router.ts:803` 의 `import('./builder/path-parser').PathPart` 직접 의존
  제거. 옵션 두 가지:
  - (a) `PathPart` 를 `src/types.ts` 의 internal 영역으로 이동 후 builder /
    router 가 동일 모듈 import.
  - (b) Router 가 path-parser 결과를 자체 IR (`RouteSpec`) 로 변환 후
    이후 단계가 IR 만 소비.
- 권장: (a) — 변환 비용 0, 단일 IR 유지.
- 검증: `src/router.ts` 가 `src/builder/**` 의 internal 타입 import 0 건
  (grep 검증).

#### E2. index.ts public API 검증
- `index.ts:1-17` 의 9 개 type + 2 개 class export 가 실제로 외부 사용자가
  소비할 수 있는 표면인지 검토. internal 전용 (`PatternTesterFn`,
  `TesterResult`, `BuilderConfig`, `QuantifierFrame`, `RegexSafetyConfig`,
  `RegexSafetyAssessment`) 은 export 되지 않음을 확인 (grep).
- 검증: `tsc --noEmit` 으로 외부 가상 import 시뮬레이션
  (`import { Internal } from '@zipbul/router'` 이 실패하는지).

---

### 단계 F — 결벽증 끝맺음 (enterprise-grade hardening)

> 본 단계는 단계 A~E 완료 후 *추가* 적용. 단계 A~E 만으로도 SRP·중복·타입
> 정합은 건강한 수준에 도달하지만, 단계 F 는 라이브러리 1.0 수준의
> 무결성을 목표로 한다. 각 항목은 독립 PR.

#### F1. Router class → 팩토리 전환 (F25)
- `class Router<T>` → `function createRouter<THandler>(opts?): RouterApi<THandler>`.
- `RouterApi` 는 `Object.freeze` 된 plain object — `add/addAll/build/match/
  allowedMethods/clearCache` 메서드 보유.
- 인스턴스 식별이 필요한 외부 사용자에게는 `BRAND: typeof RouterBrand`
  symbol 노출. `instanceof` 의존 제거.
- **breaking**: `new Router(...)` 시그니처 deprecation 후 다음 major 에서
  제거. semver impact: major.
- 검증: 기존 spec 의 `new Router` 사용 일괄 치환, 561 tests 유지.

#### F2. Router 라이프사이클 phantom-type 상태 머신 (F26)
- 타입:
  ```ts
  type RouterApi<T, S extends 'unsealed' | 'built' = 'unsealed'> = {
    add: S extends 'unsealed' ? (...) => RouterApi<T, 'unsealed'> : never;
    build: S extends 'unsealed' ? () => RouterApi<T, 'built'> : never;
    match: S extends 'built' ? (...) => MatchOutput<T> | null : never;
    // ...
  };
  ```
- 런타임 가드 (`assertNotSealed`, `assertBuilt`) 보존 — untyped 진입 보호.
- 검증: 잘못된 호출 (build 후 add 등) 이 컴파일 에러로 catch 되는지 type
  test 추가.

#### F3. Result 태그 유니온 마이그레이션 평가 (F27)
- **선결 측정**: 현재 `T | Err<E>` vs `{ ok: true; value } | { ok: false;
  error }` 의 builder 패스 시간 차이를 micro-bench 로 정량화. 빌드 패스
  영향만 측정 (런타임 핫패스에는 Result 없음).
- 임계: builder 회귀 ≤ 2% 면 마이그레이션. 그 이상이면 *현 duck-typing
  유지* + ADR 로 결정 근거 영구 기록 (단계 F7 ADR 과 연동).
- 패키지 경계: `packages/result` 자체 변경 (consumer 영향 평가 필수).

#### F4. codegen typed emit IR (F28)
- `src/codegen/ir.ts` 신규: `EmitNode` 유니온 + `serialize(nodes): string`.
- emitter.ts / segment-compile.ts 의 raw string 합성을 IR 빌더 호출로
  교체. fresh() 식별자 자동 생성, escape 자동 적용 — 식별자 누수 / escape
  누락이 컴파일타임 차단.
- **invariant**: serialize 출력은 단계 C 완료 시점의 baseline 과 byte-for-
  byte 동일. audit-repro.test 스냅샷이 가드.
- 검증: 매칭 함수 바디 byte-diff 0 + 핫패스 벤치 회귀 0.

#### F5. generic 이름 정합화 (F29)
- `T` → `THandler` 일괄 rename. router/pipeline/types/codegen 전체 적용.
- 파급: 외부 사용자가 `Router<MyHandler>` 라 쓰던 코드는 영향 없음 (제네릭
  파라미터 이름은 호출자 시점에 비가시).
- 검증: tsc 통과, spec diff 는 type 시그니처 라인뿐.

#### F6. coverage 100% line + branch 도달 (F30)
- 누락 분기 식별: `bun run coverage --branches` 결과의 < 100% 파일 8 개
  대상.
- 분기마다 *최소 1 spec*. 인위적 분기 (예: `if (false)`) 가 발견되면
  데드 코드로 분류 후 단계 A1 으로 backport.
- PR 게이트 도입: `bun run coverage` branch < 100% 면 머지 차단.

#### F7. codegen property-based test (F31)
- 외부 의존: `fast-check` 는 이미 `devDependencies` 에 등록 (`package.json`
  ^3.0.0). 추가 의존 없음.
- `test/codegen.property.test.ts` 신규: route-spec generator (depth ≤ 5,
  param count ≤ 8, optional 혼합) → emit → eval → match round-trip 검증.
  1000 케이스 / 시드 고정.
- 추가 invariant: emit 산출 함수에 free variable 0 건, 미정의 식별자
  참조 0 건.

#### F8. public API contract test (F32)
- `test/public-api.contract.ts` 신규.
- `expectType<typeof router.add, (...) => void>()` 스타일로 9 type +
  2 class export 시그니처를 동결.
- RouterErrData discriminated union 의 narrowing 도 가드:
  ```ts
  declare const e: RouterErrData;
  if (e.kind === 'route-conflict') {
    expectType<string>(e.segment);  // narrow 실패 시 컴파일 에러
  }
  ```
- semver 가드: PR 단계에서 contract test 가 실패하면 명시적 *major bump
  결정* 을 강제.

#### F9. 에러 메시지 카탈로그 (F33)
- `src/error-messages.ts` 신규: kind 별 메시지 포맷터 함수.
- 모든 에러 생성 사이트가 카탈로그 호출로 통일. 인라인 문자열 0 건.
- i18n 가능성 확보 (현 단계에서 영문만 — i18n 자체는 비목표).

#### F10. ADR (Architecture Decision Records)
- `docs/adr/` 디렉토리 신설:
  - `0001-clock-sweep-lru.md` — RouterCache 알고리즘 선택 근거 (B-rejected-2,
    B-rejected-6 통합).
  - `0002-null-proto-obj.md` — NullProtoObj 채택 근거 (부록 D 항목 흡수).
  - `0003-max-params-32.md` — 한도값 결정 근거.
  - `0004-string-emit-vs-typed-ir.md` — F28 의사결정 (선택된 안 + 기각된 안).
  - `0005-result-duck-typing.md` — F3 결정 결과 (마이그레이션 or 유지).
  - `0006-bun-only.md` — Bun 전용 결정 (B-rejected-3 흡수).
  - `0007-router-factory-vs-class.md` — F1 결정 근거.
- 각 ADR 은 status (proposed/accepted/superseded) + context + decision +
  consequences.

#### F11. lint/format/PR 게이트 정책 강화
- `eslint.config.ts` 의 router 패키지 전용 룰: `no-magic-numbers`,
  `consistent-return`, `prefer-readonly`, `no-non-null-assertion` (단,
  핫패스 대상 파일은 ignore).
- prettier 설정 통일.
- PR 게이트: lint + format + coverage(branch 100%) + bench-no-regression.

#### F12. semver / CHANGELOG 영향 분류
- `CHANGELOG.md` 갱신 — 단계별 변경을 *런타임 호환* / *타입 호환* /
  *성능 영향* 3 축으로 분류 기록.
- 단계 A3 (RouterErrData discriminated union) 는 *타입 minor breaking*
  (narrowing 작성한 사용자만 영향) — minor bump.
- 단계 F1 (class → factory) 은 *런타임 breaking* — major bump.
- 단계 D2 가 핫패스 회귀 ±2 ns 이내면 *성능 호환*.

> 검증 (F1~F12): 각 단계 후 `bun test` + `bun run bench` + `bun run
> coverage` 통과. F1·F4·F8 은 별도 *post-merge 모니터링* 권장.

## 4. 머지 순서 / 의존성 그래프

```
A1 → A2 → A3 → A4 → A5 → A6
                              ↓
                              B1 → B2 → B3 → B4 → B5
                                                   ↓
                                                   C1 → C2
                                                         ↓
                                                         D1 → D2 → E1 → E2
                                                                         ↓
   F11 (lint/CI gate, 무관 병렬)                                          │
   F10 (ADR, 무관 병렬) ─────────────────────────────────────────────────┤
                                                                         ▼
                              F6 → F7 → F8 → F9 → F5 → F4 → F3 → F2 → F1 → F12
```

- A 단계는 **순차 수행** (논리적 의존은 무관하나 파일 충돌이 있음).
  - 파일 겹침 분석 (직접 검증):
    - `router.ts` : A3 (RouterErrData 적용) · A4 (sealed/freeze/`_`prefix)
      · A5 (wildcardNames 분리) · A6 (methodCodes 변환 제거) — **4 단계
      모두 수정**.
    - `pattern-utils.ts` : A1 (F5 dead code 제거) · A2 (F15 빈 입력 처리)
      — 2 단계 수정.
    - `path-parser.ts` : A1 (F21 charCode 상수화) · A2 (parse 분해 + F13
      registerParam) — 2 단계 수정.
  - 따라서 병렬 PR 은 머지 conflict 가 보장됨. **순차 rebase** 또는
    A3+A4+A5+A6 단일 PR 묶음으로 진행. 또한 A2 의 path-parser 에러 생성
    경로는 A3 의 `RouterErrData` discriminated union 화에 영향 — A3 와
    함께 묶거나 A2 → A3 직렬 강제.
- B 는 직렬 (snapshot 타입이 단계마다 진화).
- C 는 B3 이후. D 는 C 이후. E 는 D 이후.
- **단계 F (결벽증)** 는 E 완료 후. 내부 순서:
  - F10 (ADR) · F11 (lint/CI 게이트) 는 코드 의존 없음 — 병렬 가능.
  - F6 (coverage 100%) → F7 (property test) → F8 (contract test) 는
    *테스트 인프라* 직렬.
  - F9 (메시지 카탈로그) → F5 (T → THandler rename) → F4 (typed emit IR) →
    F3 (Result 마이그레이션 평가) → F2 (phantom state) → F1 (class →
    factory) 는 *타입 표면* 직렬 (각 단계가 다음 단계의 타입 영향).
  - F12 (semver/CHANGELOG) 는 F1 완료 후 최종 정리.
- 단계 F 는 단계 A~E 와 *호환성 분류* 가 다르므로 별도 release 에 묶는
  것을 권장. 현재 `package.json` 버전은 `0.2.3` (pre-1.0, npm publish
  상태). 0.x semver 관행상 breaking 은 minor bump — 단계 F1·F2 는
  `0.3.0` 또는 `1.0.0` release 에 일괄 적용.

---

## 5. 최종 디렉토리 구조 (단계 A~E + F 완료 후)

본 리팩토링이 완료되면 `src/` 는 *시점 (build-time vs runtime)* 으로
디렉토리 경계가 정렬된다. 핫패스 (런타임) 는 `matcher/` 만 의존,
build-time 작업은 `builder/` + `codegen/` + `pipeline/` 에 격리된다.

```
packages/router/src/
├── builder/                   ─── 경로 문법 (파싱·검증·확장)
│   ├── constants.ts                charCode + MAX_PARAMS/MAX_OPTIONAL/MAX_SEGMENTS
│   ├── path-parser.ts              parse = validate → tokenize → parseTokens
│   ├── pattern-utils.ts            (acquireCompiledPattern 제거 후)
│   ├── route-expand.ts             collectIndices/validate/enumerate/mergeStatic
│   ├── regex-safety.ts
│   ├── optional-param-defaults.ts
│   └── types.ts
│
├── codegen/                   ─── build-time 코드 생성 (★ 신규 디렉토리)
│   ├── emitter.ts                  MatchFunctionEmitter (F2 분해, B3)
│   ├── segment-compile.ts          ← matcher/ 에서 이동 (C1)
│   ├── walker-strategy.ts          ★ WalkerStrategy + selectWalker (F12, C2)
│   ├── escape.ts                   ★ escapeJsString + 정책 docstring (F14, C1)
│   └── ir.ts                       ★ EmitNode + serialize (F28, F4 단계)
│
├── matcher/                   ─── 순수 런타임 (핫패스, build 산출물)
│   ├── decoder.ts                  ← processor/ 에서 이동 (F20, A1)
│   ├── match-state.ts              MAX_PARAMS import from constants
│   ├── path-normalize.ts           fresh() 카운터 일관화 (F16, C1)
│   ├── pattern-tester.ts
│   ├── segment-tree.ts
│   └── segment-walk.ts             detection 함수 walker-strategy 로 이동
│
├── pipeline/                  ─── Router 파이프라인 3 단계 (★ 신규 디렉토리)
│   ├── registration.ts             ★ Registration<T> + assertNotSealed (B1, F8)
│   ├── build.ts                    ★ Build<T>.fromRegistration (B2)
│   └── match.ts                    ★ MatchLayer<T> + assertBuilt (B4, F8)
│
├── cache.ts
├── error.ts
├── error-messages.ts               ★ kind 별 메시지 카탈로그 (F33, F9 단계)
├── method-registry.ts              + getCodeMap (A6)
├── router.ts                       facade → createRouter 팩토리 (F25, F1 단계)
└── types.ts                        RouterErrData discriminated union (A3)
                                    + MatchPayload base + internal IR (PathPart, E1)
                                    + RouterApi<T, S> phantom state (F26, F2 단계)
                                    + THandler rename (F29, F5 단계)

(삭제) processor/                   ✗ F20 — decoder.ts 이동, 디렉토리 소멸

packages/router/docs/               ★ 신규 (F10 단계)
└── adr/
    ├── 0001-clock-sweep-lru.md
    ├── 0002-null-proto-obj.md
    ├── 0003-max-params-32.md
    ├── 0004-string-emit-vs-typed-ir.md
    ├── 0005-result-duck-typing.md
    ├── 0006-bun-only.md
    └── 0007-router-factory-vs-class.md

packages/router/test/               ★ 신규 파일 (F단계)
├── codegen.property.test.ts        ★ fast-check 기반 (F31, F7 단계)
└── public-api.contract.ts          ★ 시그니처 동결 (F32, F8 단계)
```

### 5.1 디렉토리 의존 방향 (E1 정리 후)

```
        index.ts (public API surface)
            │
            ▼
        router.ts (facade)
            │
   ┌────────┼────────┐
   ▼        ▼        ▼
 pipeline/registration   pipeline/build ──→ codegen/   (build-time)
   │            │           │                   │
   │            │           ▼                   │
   │            └────→ pipeline/match ──────────┘
   │                       │
   ▼                       ▼
 builder/             matcher/  (runtime; hot path)
            ↑              ↑
            └──────┬───────┘
                   │
            method-registry, types (internal IR)
```

규칙:
- `matcher/` 는 다른 어떤 모듈도 import 하지 않음 (런타임 격리).
- `codegen/` 은 build-time 전용 — runtime 디렉토리 (`matcher/`) 에서
  import 금지.
- `pipeline/` 은 build/match 양 시점을 다리 놓는 유일한 레이어.
- builder 내부 타입 (`PathPart` 등) 은 `types.ts` 의 internal IR 영역
  으로 흡수, router/pipeline 이 builder 내부를 직접 동적 import 하지
  않음 (F6, E1).

### 5.2 변경 카운트

단계 A~E 누계:

| 분류 | 카운트 | 항목 |
|---|---:|---|
| 신규 디렉토리 | 2 | `codegen/`, `pipeline/` |
| 신규 파일 | 7 | `codegen/emitter.ts`, `codegen/walker-strategy.ts`, `codegen/escape.ts`, `pipeline/registration.ts`, `pipeline/build.ts`, `pipeline/match.ts`, `matcher/decoder.ts` (이동) |
| 이동 파일 | 2 | `processor/decoder.ts` → `matcher/`, `matcher/segment-compile.ts` → `codegen/` |
| 삭제 디렉토리 | 1 | `processor/` |
| 수정 파일 | 11 | builder/* 5, matcher/* 3, router.ts, types.ts, method-registry.ts |
| 무변경 파일 | 6 | `regex-safety`, `pattern-tester`, `segment-tree`, `cache`, `error`, `index.ts` |

단계 F 추가:

| 분류 | 카운트 | 항목 |
|---|---:|---|
| 신규 디렉토리 | 2 | `docs/adr/`, (test 파일은 기존 디렉토리에 추가) |
| 신규 파일 | 11 | `codegen/ir.ts`, `error-messages.ts`, `test/codegen.property.test.ts`, `test/public-api.contract.ts`, ADR 7 종 |
| 수정 파일 | ~15 | router.ts (factory), types.ts (phantom + THandler), 모든 에러 생성 사이트, 모든 codegen 사이트 |
| 신규 외부 의존 | 0 | (fast-check 는 이미 devDeps 에 존재) |

---

## 6. 비목표 (Out of scope)

다음은 본 리팩토링에서 **하지 않는다**.

1. **새 라우팅 시멘틱 추가**: 새 옵션, 새 segment 종류, 새 정책.
2. **다른 런타임 지원**: Bun.nanoseconds, NullProtoObj 등은 Bun 전용 유지
   (ADR 0006 에 결정 근거 영구 기록).
3. **i18n (다국어 에러 메시지)**: 단계 F9 의 카탈로그는 i18n *가능성* 만
   확보, 실제 다국어 번역은 비목표.
4. **단계 A~E 한정의 외부 의존성 도입 금지**: 단계 F7 만 예외 (`fast-check`
   dev 의존, 런타임 영향 0).

### 6.1 호환성 분류 (단계 F12 와 연동)

| 단계 | 런타임 호환 | 타입 호환 | 성능 영향 | semver |
|---|---|---|---|---|
| A1~A6 | ✓ | A3 만 minor breaking (narrow 사용자 영향) | 0 | minor |
| B1~B5 | ✓ | ✓ | 0 (emit 바디 동일) | patch |
| C1~C2 | ✓ | ✓ | 0 (emit 바디 동일) | patch |
| D1~D2 | ✓ | ✓ | ±2 ns 임계 검증 | patch |
| E1~E2 | ✓ | ✓ (내부 누수 차단) | 0 | patch |
| F1 | **✗** (class → factory) | ✗ | 0 | **major** |
| F2 | ✓ | ✗ (phantom state 도입) | 0 | major (F1 과 동일 release) |
| F3 | 평가 후 결정 | 평가 후 결정 | 측정 후 결정 | 평가 결과에 따라 |
| F4 | ✓ (emit byte 동일) | ✓ | 0 | patch |
| F5 | ✓ | ✓ (제네릭 이름은 호출자 비가시) | 0 | patch |
| F6~F11 | ✓ | ✓ | 0 | patch |
| F12 | — | — | — | (메타) |

---

## 7. 진행 현황 (live status)

각 단계의 머지 commit SHA 와 적용된 finding 을 기록. 본 절은 PR 진행에
따라 추가 갱신된다.

### 7.1 완료된 PR

| PR | Commit | 단계 | Findings | 비고 |
|---|---|---|---|---|
| #1 | `712da8e` | infra | — | REFACTOR.md, scripts/check-test-policy, package.json pretest |
| — | `1c850bb` | infra | — | baseline ANSI strip + README + env 메타 |
| — | `b2dddc0` | infra | — | quieter-load 재캡처 + /tmp 잔여 ref 제거 |
| #2 | `2ec47f8` | A1 | F5, F19, F20, F21, F24 | 데드코드 / isEmpty 단축 / processor→matcher / charCode + MAX_PARAMS/OPTIONAL 통합 |
| #3 | `41a9d25` | A2 | F3, F13, F4, F23, F15 | parse 3-stage, registerParam, expandOptional 4-함수, 두 invariant docstring, 빈 패턴 caller-trim |
| — | `85f313e` | A2-fix | — | route-expand.spec (9 tests) + F15 lock-in (1 test) — A2 의 spec 누락 보완 |
| #4 | `5ffdb44` | A3 | F7, F10 | RouterErrData → discriminated union, MatchPayload 베이스 도입, error.spec/router-errors.test 정합 |
| — | `77bce9e` | A3-fix | — | RouterErrContext / MatchPayload public export 제거 (인라인) — 잘못 도입한 공개 표면 회수 |
| #5 | `8a97815` | A4 | F8(reg), F18, F22 | assertNotSealed/unwrapOrThrow 헬퍼, `_` 접두사 제거, build-only freeze (hot-path 제외 + JSC IC 보호), V8→JSC 정정 |

### 7.2 미완료 단계

| 단계 | Findings 잔여 | 의존 |
|---|---|---|
| A5 | F9 | — |
| A6 | F11 | — |
| B1~B5 | F1, F2 (codegen) | A 단계 전체 |
| C1~C2 | F12, F14, F16 | B3 |
| D1~D2 | F17 + 회귀 검증 | C |
| E1~E2 | F6 | D |
| F1~F12 | F25~F33 | E |

### 7.3 검증 baseline (현 시점)

- `bun test`: **567 pass / 0 fail** (PR#1 시점 561 → A1 후 556 → A2 후 566 → A3 유지 → A4 후 567 freeze lock-in spec 추가)
- `bun run build`: clean
- `tsc --noEmit -p tsconfig.json`: **0 errors** (A3 의 F7 discriminated
  union 화로 pre-existing 2건 자연 해소).
- coverage: line + branch 100% on builder/* 전체.
- check:test-policy: clean.
- bench (router.bench): 핫패스 모든 항목 baseline ±0.5 ns 이내.

---

## 부록 A — 추적 매트릭스

| Finding | 심각 | 단계 | 파일 |
|---|---|---|---|
| F1 Router SRP | 상 | B1-B5 | router.ts → pipeline/* + codegen/* |
| F2 emitGenericMatchImpl 159 lines | 상 | B3 | router.ts → codegen/emitter.ts |
| F3 path-parser SRP | 상 | A2 ✅ 41a9d25 | builder/path-parser.ts |
| F4 route-expand 가드+조합 결합 | 상 | A2 ✅ 41a9d25 | builder/route-expand.ts |
| F5 acquireCompiledPattern dead | 상 | A1 ✅ 2ec47f8 | builder/pattern-utils.ts |
| F6 export 경계 (PathPart 누수) | 상 | E1, E2 | index.ts, router.ts, types.ts |
| F7 RouterErrData (kind/message만 필수) | 중 | A3 ✅ 5ffdb44+77bce9e | types.ts |
| F8 sealed/isErr 중복 (registration) | 중 | A4 ✅ 8a97815 | router.ts → pipeline/registration.ts |
| F8 not-built 가드 (match) | 중 | B4 | router.ts → pipeline/match.ts |
| F9 wildcardNames cross-method | 중 | A5 | router.ts (→ B1 후 pipeline/registration) |
| F10 MatchOutput/CachedMatchEntry 중복 | 중 | A3 ✅ 5ffdb44+77bce9e | types.ts (MatchOutput), router.ts (file-local CacheEntry) |
| F11 getAllCodes 변환 | 중 | A6 | method-registry.ts |
| F12 워커 dispatch 분산 | 중 | C2 | matcher/segment-walk.ts, codegen/segment-compile.ts → codegen/walker-strategy.ts |
| F13 path-parser 파람 검증 4 회 | 중 | A2 ✅ 41a9d25 | builder/path-parser.ts |
| F14 codegen escape 미문서화 | 중 | C1 | codegen/segment-compile.ts, codegen/escape.ts (신규) |
| F15 normalizeParamPatternSource 암묵 반환 | 중 | A2 ✅ 41a9d25 | builder/pattern-utils.ts |
| F16 emit 변수명 하드코딩 (qi/len/mc) | 중 | C1 | matcher/path-normalize.ts, codegen/segment-compile.ts |
| F17 segment-walk fast path 중복 | 중 | D1 | matcher/segment-walk.ts |
| F18 `_` 접두사 일관성 | 하 | A4 ✅ 8a97815 | router.ts |
| F19 isEmpty 중복 | 하 | A1 ✅ 2ec47f8 | builder/optional-param-defaults.ts |
| F20 processor/ 단일 파일 | 하 | A1 ✅ 2ec47f8 | processor/decoder.ts → matcher/decoder.ts |
| F21 charCode 매직 넘버 | 하 | A1 ✅ 2ec47f8 | builder/path-parser.ts, builder/constants.ts |
| F22 segmentTrees freeze | 하 | A4 ✅ 8a97815 | router.ts (build-only tables — hot-path 제외) (→ B2 후 pipeline/build) |
| F23 mergeStaticParts `//` 정규화 | 하 | A2 ✅ 41a9d25 (docstring only) | builder/route-expand.ts |
| F24 MAX_PARAMS 상수 분산 | 중 | A1 ✅ 2ec47f8 | builder/constants.ts, builder/path-parser.ts, matcher/match-state.ts |
| F25 Router class 명분 부재 | 상 | F1 | router.ts (createRouter 팩토리) |
| F26 라이프사이클 boolean 산재 | 상 | F2 | types.ts (RouterApi<T,S> phantom) |
| F27 Result duck-typing | 중 | F3 (평가) | packages/result + consumer |
| F28 codegen string concat | 중 | F4 | codegen/ir.ts (신규) + emitter/segment-compile |
| F29 generic T 단일 문자 | 하 | F5 | router.ts, types.ts, pipeline/* |
| F30 branch coverage 81~86% | 중 | F6 | test/* (분기별 spec 추가) |
| F31 codegen property test 부재 | 중 | F7 | test/codegen.property.test.ts (신규) |
| F32 public API contract test 부재 | 중 | F8 | test/public-api.contract.ts (신규) |
| F33 에러 메시지 inline | 하 | F9 | error-messages.ts (신규) + 모든 에러 사이트 |

---

## 부록 B — 교차검증으로 기각·완화된 주장

서브에이전트 보고를 그대로 받아쓰지 않고, 의심스러운 주장은 직접 코드를
다시 읽어 사실 여부를 판단했다. 다음 항목은 본 계획에서 **제외**된다 —
근거와 함께 영구 기록한다.

### B-rejected-1. "MethodRegistry.getOrCreate 가 Result 타입을 위반한다"
- 주장: `return existing` (number) 가 `Result<number, RouterErrData>`
  타입 위반.
- 검증: `packages/result/src/types.ts` — `Result<T, E> = T | Err<E>` 로
  정의된 zero-overhead union. bare T 반환은 라이브러리 의도 준수.
  `method-registry.spec.ts:35` `expect(...).toBe(7)` 가 이를 가드.
- 결론: **사실 아님**. 변경하지 않는다.

### B-rejected-2. "RouterCache.evict() 가 무한 루프 위험"
- 주장: `while (true)` 가 모든 entry 가 used 일 때 무한 루프.
- 검증: 한 바퀴 sweep 시 모든 `entry.used` 가 false 로 리셋됨. 다음
  순회에서 즉시 evict. 최악 O(2·capacity), 무한 가능성 없음.
- 결론: **과장**. 코멘트로 알고리즘 의도 명시는 가능하나 (lower priority,
  단계 외) 동작 변경은 불필요.

### B-rejected-3. "pattern-tester 가 Bun.nanoseconds 에 의존하여 플랫폼 특화"
- 주장: 다른 런타임 미지원.
- 검증: `package.json:engines.bun >= 1.0.0` 로 Bun 전용 명시. 의도된
  설계.
- 결론: **비실효**. 변경 없음.

### B-rejected-4. "RegexSafetyOptions.maxExecutionMs 의 위치가 잘못됐다"
- 주장: maxExecutionMs 가 builder 가 아닌 matcher (pattern-tester) 에서만
  사용.
- 검증: build-time 컴파일 시 매칭 timeout 을 결정해야 하므로 옵션은
  사용자에게 노출, 실제 사용은 matcher 라는 것이 정상. `RegexSafetyOptions`
  네이밍이 다소 광범하나 잘못은 아님.
- 결론: **현 상태 유지**.

### B-rejected-5. "regex-safety.skipCharClass 의 경계 처리 버그"
- 주장: unclosed `[` 시 `pattern.length - 1` 반환이 caller index 관리
  오류 유발.
- 검증: caller 라인 21 의 후속 `i++` 로 `i === pattern.length` → loop
  종료. 마지막 문자 누락 가능성은 있으나 unclosed `[` 자체가 invalid
  regex → `new RegExp` 시 throw 되어 builder 가 거부함 (`pattern-utils.ts`
  / `segment-tree.ts:158-167`). 실제 영향 없음.
- 결론: **방어적 코멘트만 추가하면 충분** (단계 A 외, 별도 small fix).

### B-rejected-6. "RouterCache 의 used flag 동작이 불명확"
- 주장: 캐시 정책의 mental model 부재.
- 검증: 단순 clock-sweep LRU 의 표준 구현. 동작 정확성 문제 없음.
- 결론: **본 리팩토링 범위 외**. § 5 비목표 / 부록 D Touch-not 의 정신상
  동작이 정확한 컴포넌트는 손대지 않는다. docstring 보강이 필요하다면
  별도 trivial-fix PR 로 처리.

---

## 부록 C — 측정·검증 명령

```bash
cd packages/router

# 0) 베이스라인 캡처 (단계 A1 진입 전, 1 회만)
#    캡처 직전: 다른 CPU 부하 없는 상태에서 실행.
mkdir -p bench/baseline
bun run bench                                > bench/baseline/router.bench.txt 2>&1
bun run bench/comparison.bench.ts            > bench/baseline/comparison.bench.txt 2>&1
bun run bench/complex-shapes.bench.ts        > bench/baseline/complex-shapes.bench.txt 2>&1
bun run bench/percent-gate.bench.ts          > bench/baseline/percent-gate.bench.txt 2>&1
# ANSI 컬러 escape 제거 — diff 친화 (필수)
sed -i 's/\x1b\[[0-9;]*m//g' bench/baseline/*.bench.txt
# env 메타: OS / Bun / CPU 모델 / 실시간 MHz / scaling / load
{ echo "=== System ==="; uname -a;
  echo; echo "=== Bun ==="; bun --version;
  echo; echo "=== CPU (lscpu) ==="; lscpu | head -25;
  echo; echo "=== CPU MHz (per-core) ==="; /bin/grep MHz /proc/cpuinfo | head -8;
  echo; echo "=== Scaling driver/governor ==="
  cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_driver 2>/dev/null || echo "n/a"
  cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null || echo "n/a"
  echo; echo "=== Memory ==="; free -h;
  echo; echo "=== Load (post-bench) ==="; uptime;
} > bench/baseline/env.txt
git add bench/baseline && git commit -m "bench: capture baseline for refactor"

# 1) 테스트 (모든 PR)
bun test

# 2) 커버리지 (모든 PR; F6 후 branch 100% 게이트)
bun run coverage

# 3) 벤치 회귀 비교 (모든 PR; baseline 대비 diff)
bun run bench
bun run bench/comparison.bench.ts
bun run bench/complex-shapes.bench.ts
bun run bench/percent-gate.bench.ts

# 4) 빌드
bun run build

# 5) property tests (단계 F7 후 codegen.property 도 포함)
bun test test/router.property.test.ts
bun test test/codegen.property.test.ts

# 6) 테스트 우회 검증 (§ 1.1 정책)
grep -rE '\.skip\(|\.todo\(|\bxit\(|@ts-ignore|@ts-expect-error' test/ \
  && echo "FAIL: forbidden skip/ignore detected" || echo "OK"
grep -rE 'as any|as unknown as' test/ \
  && echo "FAIL: type-bypass detected" || echo "OK"
```

회귀 임계: 핫패스 항목 (§ 0.1) p75 기준 ±2 ns, 캐시 항목 (§ 0.2) p75
기준 ±1 ns. 경쟁사 비교 (§ 0.5) 는 *상대 순위* 보존 + 절대 ±5%.

---

## 부록 D — 변경 무관 (Touch-not)

다음 컴포넌트는 본 리팩토링 범위 외 — 의도된 설계로 검증 완료.

- `MatchStateWithParams` narrow 패턴 (`match-state.ts:31-33`).
- `paramNames`/`paramValues` MAX_PARAMS pre-fill 최적화
  (`match-state.ts:42-48`).
- `NullProtoObj` 사용 패턴 (`router.ts:40-42`).
- `staticChildren` `Object.create(null)` (`segment-tree.ts:128`).
- emit 헬퍼와 buildPathNormalizer 의 단일 소스 보장
  (`path-normalize.ts:25-81`) — 단, F16 처방으로 변수명만 fresh() 카운터
  화하며 emit 결과 바디는 동일.

---

**본 문서 끝.** 단계 A1 부터 즉시 진행 가능.
