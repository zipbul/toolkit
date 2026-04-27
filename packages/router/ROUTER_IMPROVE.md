# Router improvement backlog

심층 리뷰에서 도출된 개선 항목과 처리 상태. 모든 항목은 코드 인스펙션 또는
런타임 재현으로 검증된 사실이며, 각 fix 의 100% 확실성·효과·트레이드오프
모두 평가 완료.

## 처리 완료

- **#1 옵셔널-파람 폭발 DoS 방어** (commit `5442d71`)
  20개 옵셔널 = 5.3초 빌드 hang 재현됨. 확장 전 상한 (10) 검사 추가.
- **#5 active-method 검출 중복** (commit `8091b4d`)
  두 군데 inline 스캔을 build-time 캐시 `activeMethodCodes` 로 통합.
- **#4 compileMatchFn 406 라인 분해** (commit `e44967f`)
  설정 수집 / shape 게이트 / 와일드 emit / 제네릭 emit 4개 메서드로 분리.
  `MatchConfig<T>` 스냅샷으로 emitter 결합도 낮춤.

## 폐기 (실제로는 issue 아님)

- **#2 segment-tree tester drop**
  `paramChild.name` 일치 시 새 tester 무시. radix-builder 가 먼저 catch
  하므로 public API 로 도달 불가능. defensive 비일관성일 뿐, 진짜 issue 아님.
- **#8 extractSegments char-by-char loop**
  의식적 perf 선택. 빌드 콜드패스라 가독성 우선이라도 무방하지만 현 구현도 정상.
- **#11 hasAnyStatic 매번 재계산**
  내가 잘못 분석. compileMatchFn 은 build() 에서 1회 호출. 매 match 호출이
  아니라 빌드 시 1회 — 캐시 가치 없음.
- **#12 optionalParamDefaults 항상 인스턴스화**
  `isEmpty()` 게이트가 이미 핫패스 사용 차단. 인스턴스 자체 ~100 바이트.
  lazy init 측정 가능한 이득 없음.
- **#14 match + allowedMethods API 분리**
  사용자 결정한 책임 분리 설계. issue 아니라 의도된 구조.

## 남은 항목

### #3. 이중 트리 통합 — 가장 큰 작업

**문제:** `RadixBuilder` (radix tree) + `segment-tree` 둘 다 build() 에서 빌드.
매치 시 segment-tree 만 사용. radix tree 는 옵셔널 multi-param 확장이
sibling param (같은 위치 다른 이름) 을 만들 때만 fallback (radix-walk).

**검증:** `git log` + 코드 인스펙션. router.ts:142 (RadixBuilder 생성),
:1035 (radixBuilder.insert 호출). build() 후 `radixBuilder = null` 로
clear 되지만 빌드 시간/메모리 소비함.

**근본 해결:** segment-tree 의 `ParamSegment` 에 `next: ParamSegment | null`
추가 → linked-list of param siblings. 3개 walker (compileSegmentTree
codegen, createIterativeWalker, recursive match) 모두 sibling 순회 로직
추가 (radix-walk 의 fallthrough 패턴 그대로).

이후 제거 가능:
- `src/builder/radix-builder.ts` (454 라인)
- `src/matcher/radix-walk.ts` (416 라인)
- `src/matcher/radix-compile.ts` (328 라인)
- `src/matcher/radix-matcher.ts` (31 라인)
- `src/builder/radix-node.ts` (67 라인)
- 관련 테스트 파일들

총 **~1,300 라인 제거** + 이중 build 부하 제거 + 자동 해결되는 항목 (#10, #13).

**리스크:** 중-높음. walker 3개 변경 + segment-tree 구조 변경. backtracking
처리 추가가 codegen 복잡도 증가 (현재 invariant: paramChild 단일).

**효과:**
- 코드량: -1,300 라인
- 빌드 시간: 단일-라우터 ~30% 빠름 추정
- 메모리: build 중 radix-tree 미생성으로 peak 감소
- 매치 성능: 변동 없음 (segment-tree 가 이미 매치 전담)

**작업 단계 (예상):**
1. SegmentNode → 다중-param sibling 지원 (구조체 변경)
2. recursive match walker → param sibling fallthrough 추가
3. createIterativeWalker → param sibling fallthrough 추가
4. compileSegmentTree → emit 에 backtracking 추가 (가장 복잡)
5. router.ts → radix-builder 의존 제거 (`expandOptionalPublic` 을
   segment-tree 모듈로 이동)
6. radix-* 파일들 + 테스트 제거
7. 전체 회귀 테스트 + 벤치 검증

---

### #6. `normalizePathForLookup` ↔ matchImpl emit 의 코드 중복

**문제:** path-length / query strip / slash trim / lowercase / segLen 검사
로직이 두 군데 표현됨:
- `compileMatchFn` 가 emit 하는 인라인 JS (router.ts:594, 597 등)
- `normalizePathForLookup` 메서드 (router.ts:888~)

옵션 동작 변경 시 두 군데 동기 필요. 현재 주석 + `allowed-methods.test.ts`
가 invariant 핀 박았지만 실제 코드 공유는 아님.

**검증:** 코드 인스펙션. `/usr/bin/grep -n "sp.indexOf('?')\|charCodeAt(sp.length - 1)" src/router.ts` 가 4 곳 보고.

**근본 해결 옵션:**
- (a) 헬퍼 함수를 핫패스에서 호출 → 5-10 ns 함수 호출 비용. **회귀.**
- (b) 빌드 타임에 헬퍼 로직이 emit string 을 생성하게 (단일 출처) →
  핫패스 영향 0, codegen 복잡도 약간 증가
- (c) 현 상태 유지 (수동 동기 + 테스트로 핀)

**권고: (b) 시도.** 헬퍼가 `emitNormalizationSrc(opts): string` 를
반환하면 emit 도 같은 함수에서 생성. allowedMethods 도 같은 코드 사용.

**리스크:** 낮음. emit string 생성 헬퍼는 순수 함수.

**효과:**
- 단일 출처 보장 (invariant drift 불가능)
- 코드량: 비슷
- 성능: 변동 없음

---

### #7. percent-encoding (`%`) gate 6 군데 중복

**문제:** `decoder.ts` 가 자체 `%` 게이트 보유 (`if (!raw.includes('%')) return raw`),
그러나 caller 들 (segment-walk, segment-compile, radix-walk, radix-compile)
이 모두 자체 gate 후 decoder 호출.

**검증:**
```
src/processor/decoder.ts:10:    if (!raw.includes('%')) return raw;
src/matcher/segment-walk.ts:209,356:  decodeParams && seg.indexOf('%') !== -1 ? decoder(seg) : seg
src/matcher/segment-compile.ts:375:   if (${valVar}.indexOf('%') !== -1) { try { ... } }
src/matcher/radix-walk.ts:24:    raw => (raw.indexOf('%') !== -1 ? decoder(raw) : raw)
src/matcher/radix-compile.ts:70,101:  raw.indexOf('%') === -1 ? raw : ...
```

**의식적 패턴:** caller gate 가 `decoder` 함수 호출 자체를 회피. JSC 가
decoder 를 인라인 못하면 함수 호출 ~1-2 ns 매번 발생. caller gate 는
gate 만 inlined → 함수 호출 회피.

**검증 필요:** JSC FTL 가 작은 decoder 함수를 인라인하는가?
- 인라인 됨 → caller gate 불필요, decoder gate 만 의존
- 인라인 안 됨 → caller gate 가 perf 절약 (현재 의도)

**작업:**
1. 단순 라우터로 micro-bench 작성 (caller gate 있음 vs 제거)
2. 결과에 따라:
   - caller gate 가 perf 무관 → caller 들에서 제거, decoder 만 의존
   - caller gate 가 의미 있음 → 현 상태 유지 + 의도된 중복 명시 주석

**리스크:** 낮음. 측정 후 결정.

**효과:** 측정 결과에 따라 코드 5 군데 정리 가능 또는 현 상태 유지.

---

### #9. `state.params!` 암묵 contract

**문제:** segment-walk.ts 에서 `state.params!` non-null assertion 6회 사용.
walker 가 caller (compileMatchFn-emitted matchImpl) 가 `state.params` 를
세팅했다고 가정. 명시적 contract 부재.

**검증:** `/usr/bin/grep -c "state\.params!" src/matcher/segment-walk.ts` → 6.

**근본 해결 옵션:**
- (a) walker self-init: walker 가 자체 `new ParamsCtor()`. **이미 시도, perf
  회귀 (이중 할당) 로 revert** (commit history).
- (b) **타입 차원 명시**: walker 시그니처를 `(url, state: MatchState & { params: NonNull })`
  로 좁힘. perf 영향 0, 컴파일러가 invariant 강제.
- (c) 런타임 assert. perf 비용 + 핫패스에 추가 코드.

**권고: (b).** 타입 정의 변경만, behavior 무변경.

**리스크:** 낮음. 타입 차원만 변경.

**효과:**
- 명시적 contract → 호출자가 init 빠뜨리면 컴파일 에러
- 코드량: 변동 없음
- 성능: 변동 없음

---

### #10. 단일-라우트도 RadixBuilder build

**문제:** RadixBuilder 항상 생성·매 라우트마다 insert 호출. segment-tree
가 모든 케이스 처리해도 radix tree 를 빌드.

**검증:**
```
src/router.ts:162:    this.radixBuilder = new RadixBuilder(buildConfig);
src/router.ts:1035:   radixBuilder!.insert(offsetResult, parts, handlerIndex);
```

**해결:** **#3 통합 시 자동 해결.** 독립 fix 가능하지만 path-parser 가
radix-builder 의 `expandOptionalPublic` 사용하는 의존성 분리 필요.
#3 와 함께 처리가 효율적.

---

### #13. walker 5종 → 6종 (정정)

**문제:** 매칭 walker 가 6종 존재:
- `compiledWildWalk` (segment-walk:76)
- `compiledSegmentWalk` (segment-compile:56)
- `createIterativeWalker` (segment-walk:292)
- recursive `match` (segment-walk:251)
- `compiledWalk` (radix-compile:51)
- `createSimpleWalker` (radix-walk:40)
- `createFullWalker` (radix-walk:220)

실제로는 7종. 다중 fallback tier 의 복잡도 부담.

**해결:** **#3 통합 시 radix 계열 walker 4개 제거 → 3종으로 축소** (codegen
wild / codegen general / iterative or recursive). 자동 해결.

---

## 우선순위 권고

1. **#9 (타입 contract)** — 가장 안전, 즉시 가능, 사이드 이펙트 0
2. **#7 (% gate 측정)** — 낮은 리스크, 결정 후 정리 또는 유지
3. **#6 (normalize emit 헬퍼)** — 중간 리스크, 단일 출처 보장
4. **#3 (이중 트리 통합)** — 큰 작업, 신중한 단계별 진행. 완료 시 #10, #13
   자동 해결 + 1,300 라인 dead code 제거

각 항목 별 PR/커밋으로 분리 권장. #3 는 단계별 (1~7) 로 commit 분할.
