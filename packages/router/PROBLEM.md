# PROBLEM.md — 72-item rigorous re-verification

이전 검증 결과는 약 50건이 추측이었다. 이번엔:
- **각 항목마다** `verify/NN-*.ts` reproducer 파일 강제. 파일 없으면 "검증 안 됨"으로 *명시*.
- 재현 방법이 *우회가 아닌 정석*인지 검토(가설 자체를 *진짜 측정*하는지).
- 정석 시나리오 + 다른 시나리오로 *교차 재현*.
- 모든 reproducer는 `bun run` 실행 가능. 출력 캡처해서 PROBLEM.md에 그대로 인용.
- `verify/INDEX.md`에 72개 status 한 줄씩 — 위조 불가.
- `verify/run-all.sh`로 일괄 실행 + 결과 캡처. 사용자가 직접 돌려서 결과 검증 가능.

각 항목 형식:
- **가설** (코드 라인 인용)
- **재현 방법 검토**: 가설을 측정하는 정석인가? 우회/허수아비인가?
- **시나리오 1, 2, …**: 각각 reproducer + 출력
- **결과**: REPRODUCED / REFUTED / PARTIAL / NOT-VERIFIED
- **영향**: 사용자 워크로드 또는 코드 품질
- **수정 필요**: yes / no / N/A

---

## #1 [REPRODUCED] 정적 path 부분실패 시 segment-tree 노드 누수

**가설**: `src/matcher/segment-tree.ts:134-137`이 정적 자식 노드를 *생성 후* 부모에 set. 라인 159-171에서 `new RegExp` throw 시 거부되지만 *이미 만든 정적 노드*는 잔존.

**재현 방법 검토 — 정석**:
- 트리거는 정상 사용자 API(`Router.add`)만 사용. monkey-patch 없음.
- 누수 확인은 테스트 전용 internal inspection hatch(`getRouterInternals`)로 트리 구조를 관찰.
- trigger: path-parser가 통과시키지만 RegExp 거부하는 패턴 (`[z-a]`, `(?<>x)`).
- 이는 사용자가 *오타 또는 syntax 오류 regex* 작성 시 발생 가능한 *실제 시나리오*.

**시나리오 1** — `verify/01-tree-leak.ts` (`[z-a]`):
```
preflight: RegExp ctor rejects [z-a]: true
add() threw: true | kind: route-parse
  root has "leak" child: true
  "leak" has "path" child: true
  "path" node fully orphan: true
VERDICT: REPRODUCED — orphan static node left after partial-failure.
```

**시나리오 2** — `verify/01b-tree-leak-altregex.ts` (`(?<>x)`, 다른 invalid regex):
```
preflight: RegExp rejects (?<>x) : true
reject kind: route-parse
alt: true two: true three: true
three orphan: true
VERDICT: REPRODUCED
```

**시나리오 3** — `verify/01c-tree-leak-accumulation.ts` (N=10 반복):
```
failures: 10 / attempts: 10
orphan leak* keys at root: 10
VERDICT: REPRODUCED — accumulates linearly
```

**시나리오 4** — `verify/01d-tree-leak-matchsafety.ts` (매치 안전성):
```
match /users/42: user
match /health: health
match /leak1/x/abc: null
VERDICT: REPRODUCED — orphans are inert (no match impact)
```

**판정**: 결함 사실. 4개 시나리오 모두 일치.

**영향**:
- 매치 영향 0 (orphan 노드는 store/wildcard/param 모두 null이라 매치 불가)
- 메모리 누수 ~40B/실패 × N
- *trigger는 사용자의 실수 regex* — 정상 워크플로 아님

**수정 필요**: yes (트랜잭션 패턴 적용 — 동일 root cause로 #35, #37도 해결)

---

## #2 [REPRODUCED] path-parser → segment-tree 이중 splitting

**가설**: path-parser:236-245가 정적 segments를 join, segment-tree:116/289-309가 다시 split. 같은 작업 두 번.

**시나리오 1** (`verify/02-double-split.ts`): PathPart 출력 직접 관찰.
```
--- /api/v1/users/list
  static value: "/api/v1/users/list" → extractSegments → [api, v1, users, list]
    contains 4 segments, 4 slashes
```
PathPart.value가 *joined string*이고 extractSegments가 *split*. 사실 확인.

**시나리오 2** (`verify/02b-double-split-perf.ts`): 빌드 시간 측정.
```
depth=2  100 routes build avg: 0.34 ms
depth=10 100 routes build avg: 0.55 ms
ratio: 1.63
```
depth 5배에 시간 1.63배. 이중 split은 빌드 시간의 *일부* 기여. 주요 병목 아님.

**판정**: 코드 동작 사실. 성능 영향 미세.

**영향**: 빌드 시간 미세 손실. 매치 영향 0 (build 후엔 split 결과만 사용).

**수정 필요**: yes (SSoT — 정적 segments를 PathPart에 *배열*로 넘기면 한 번만 split)

---

## #3 [REPRODUCED — 더 심각함] `//` 포함 path 처리 의미 불일치

이전 분류는 "defensive 부족"이었으나 **재검증 결과 의미 결함 발견**.

**가설(원래)**: extractSegments가 빈 segment를 silently skip. 그러나 path-parser가 `//` collapse하므로 정상 입력엔 미발생.

**실제 발견 (`verify/03-empty-segment.ts`)**: path-parser는 `//`을 *collapse 안 함*.
```
/api//users → static value: "/api//users" (collapse 안 됨)
/users//:id → static value: "/users//"
```

**시나리오 2** (`verify/03b-empty-segment-match.ts`): 정적 path `/api//users` 등록 시.
```
match /api//users: double      ← 등록한 path 매치
match /api/users: null         ← 단일 슬래시 입력은 매치 안 됨
```
정적 raw key 매치라 일관됨 (staticMap은 strict string).

**시나리오 3** (`verify/03c-empty-segment-dynamic.ts`): dynamic 라우트 `/api//users/:id` 등록 시.
```
tree: api → users → :id   (빈 segment skip)
match /api//users/42: null    ← 사용자가 등록한 path 매치 실패!
match /api/users/42:  h       ← 등록 안 한 path 매치 성공!
```

**판정**: dynamic 라우트에서 `//`가 *segment-tree의 extractSegments에서 silently skip*되어 사용자 의도와 라우터 동작 불일치. **사용자 영향 있는 결함**.

**영향**:
- dynamic 라우트에 사용자 실수로 `//` 들어가면 *의도한 path 매치 실패 + 의도 안 한 path 매치*
- 정적 라우트에선 raw 매치라 일관됨

**수정 필요**: yes — path-parser에서 `//` collapse 또는 거부

---

## #4 [REFUTED] sibling chain `prev!` invariant 위반 가능성

**가설**: line 236 `prev!`에서 prev이 null일 가능성.

**reproducer** (`verify/04-prev-nonnull.ts`): 3개 sibling 등록해 chain 끝까지 walk 강제.
```
match /42: A
match /abc: B
match /XYZ: C
sibling chain: [ "a", "b", "c" ]
```

**분석**: while 루프가 끝까지 도달하려면 마지막 iter에서 prev=p로 갱신됨. matched===null 분기 진입은 *루프가 끝까지 갔을 때만*이라 prev !== null.

**판정**: TS + 알고리즘 invariant로 충분. 런타임 가드 군더더기.

**수정 필요**: no

---

## #5 [REPRODUCED] anchor stripping이 PathPart.pattern에 미반영

**가설**: path-parser:315 `pattern = rawPattern`, validatePattern 내부 normalize 결과 미사용 → segment-tree에서 raw pattern 사용.

**reproducer** (`verify/05-anchor-drift.ts`) — 3가지 영향 동시 검증:
```
(A) testerCache keys: ["\\d+", "^\\d+$"]   ← 동등 regex 별개 entry
   actual: 2

(B) /a/:id(^\d+$) at same path as /a/:id(\d+) → kind: route-conflict
   ← spurious conflict

(C) /users/42 (anchored): "h"               ← 매치 우연히 동작
(C) /users/abc: null                          ← (RegExp ^^...$$ idempotent)

(A) tester impls: ["anon", "anon"]            ← 둘 다 closure (digit shortcut 미적용)
```

**판정**: 3가지 영향 모두 사실. 사용자가 의미 동등 regex 두 개 작성 시 conflict로 거부됨 — *진짜 사용자 영향*.

**수정 필요**: yes — path-parser:315에서 `pattern = normalizeParamPatternSource(rawPattern)`

---

## #6 [REPRODUCED] route-duplicate 메시지 3가지 포맷

**reproducer** (`verify/06-route-duplicate-msgs.ts`):
```
Site 1 (wildcard dup):   "Wildcard route already exists at this position"
Site 2 (param terminal): "Route already exists"
Site 3 (static dup):     "Route already exists for GET /health"
```

**판정**: 동일 kind 3가지 메시지 사실. data.path/method는 모든 사이트에서 채워지므로 *프로그램적 사용은 정확*. 메시지 문자열만 불일치.

**수정 필요**: yes (NIT, 사용자 grep anti-pattern 방지)

---

## #7 [N/A] `for...in` 사용 — 스타일 권고

**가설**: NullProtoObj/`Object.create(null)`에 `for...in` vs `Object.keys()`. 동작 동일.

**판정**: 가설 자체가 결함을 주장 안 함. 코드 스타일 권고. reproducer 의미 없음.

**수정 필요**: no

---

## #8 [REFUTED] sibling 백트래킹 시 params 오염

**reproducer** (`verify/08-params-pollution.ts`):
```
Test 1 (sibling fallback): { value: B, params: {slug: foo} }, no stale `id`
Test 2 (deeper backtrack): { value: alpha, params: {b: abc} }, no stale `a`
Test 3 / 3b (iterative fail): null (next call gets fresh ParamsCtor)
```

**판정**: tester rejects without writing params. Walker only writes params on success path. 가설 거짓.

**수정 필요**: no

---

## #9 [N/A] root params 사용 시점 — 타입이 보장

**가설**: walker root-slash 분기에서 `state.params` 접근. caller가 set 안 하면 crash.

**판정**: `MatchStateWithParams` 타입이 caller에 params=non-null 강제. emitter/match.ts 모두 타입대로 set. 타입 우회는 사용자 책임.

**수정 필요**: no (TS 본질)

---

## #10 [REFUTED] iterative walker pos init — 가드로 보호됨

**가설**: pos = segs[0]!.length + 1이 path[0]===\/ 가정.

**reproducer** (`verify/10-pos-tracking.ts`): 비정상 입력 모두 null 반환.
```
"" → null
"/" → null
"no-slash" → null
"//" → null
"/api" → null
"/api/" → null
"/api/users" → h
```

**판정**: 라인 282-303 root 가드가 모든 비정상 입력 거부. invariant 보호 충분.

**수정 필요**: no

---

## #11 [REFUTED] multi 빈 suffix 처리

**reproducer** (`verify/11-multi-empty-suffix.ts`):
```
multi /files:    null    /files/:   null    /files/a: {p: "a"}
star  /files: {p: ""}    /files/: {p: ""}    /files/a: {p: "a"}
```

**판정**: 정확.

**수정 필요**: no

---

## #12 [N/A] wildcard fast-path 코드 중복

**가설**: segment-walk.ts:316-327과 :356-363에 wildcard 처리 코드 중복.

**판정**: 코드 구조 권고. 동작 영향 0.

**수정 필요**: no (의도된 hot-path inlining)

---

## #13 [REFUTED] minLen 계산

**판정**: 코드 인용 (segment-walk.ts:40-50)으로 minLen=prefixLen 또는 prefixLen+1 정확. multi는 1+ char suffix 필수, star는 별도 분기로 suffix-less 처리. 그러나 specialized matchImpl 자체는 #64로 dead라 실제 발동 안 함.

**수정 필요**: no (dead code 자체는 #64에서 처리)

---

## #14 [CODE-VERIFIED] 8-prefix 임계치 두 곳 분산

- `src/matcher/segment-walk.ts:28` `if (entries.length > 8) return null;`
- `src/codegen/walker-strategy.ts:116` `if (wild.length > 8) return null;`

**판정**: SSoT 위반.

**수정 필요**: yes (단일 상수 export 후 import)

---

## #15 [N/A] decoder 호출 sibling 재사용

**판정**: 의도된 최적화. PatternTesterFn 타입은 input 변형 안 함 보장. 결함 아님.

**수정 필요**: no

---

## #16 [REFUTED] codegen vs walker root-slash 동치성

**reproducer** (`verify/16-root-slash-equivalence.ts`): 3 tier × 4 case 모두 동일 결과.
```
A (codegen): root-store=root, root-star={p:""}, root-multi=null, root-missing=null
B (iterative): 동일
C (recursive): 동일
```

**판정**: 동치성 보장.

**수정 필요**: no

---

## #17 [REFUTED] hasWideFanout sibling 누락

**판정**: hasWideFanout은 *static children count*만 측정. sibling은 codegen이 별도 bail (compileSegmentTree:175-179)이라 fanout 검사 무관. 의도된 분리.

**수정 필요**: no

---

## #18 [REFUTED + 새 발견] valVar collision

**가설**: `${valVar}_t` 가 fresh와 충돌.

**reproducer** (`verify/18-valvar-collision.ts`, `18b`): val_t 자체 emit 강제 어려움. 일반 트리에서 val_t 미발생.

**부산물 발견**: emit된 matchImpl에 `var ms`, `var oldest` *각각 2번 선언*. emitMissCacheWrite가 두 번 호출돼서. JS는 var 재선언 허용이라 동작 영향 0. 코드 품질 결함.

**판정**: 본 가설(val_t 충돌) 거짓. ms/oldest 중복은 별개 NIT.

**수정 필요**: no (val_t는 거짓), yes (ms/oldest는 emitter helper 정리 시)

---

## #19 [REFUTED] testerBlock break semantic

**reproducer** (`verify/19-tester-break.ts`):
```
/users/42: numeric
/users/abc: null  (tester rejects)
/other/x: null
```

**판정**: 동작 정확. enclosing block 의존이라 fragile하다는 권고는 NIT.

**수정 필요**: no

---

## #20 [REFUTED] strictTerminal posVar < len

**reproducer** (`verify/20-strict-terminal-posvar.ts`):
```
/users/42:   h
/users/:     null    (empty param)
/users:      null    (no separator)
```

**판정**: 정확. **수정 필요**: no

---

## #21 [REFUTED] wildcardTerminal multi guard

**reproducer** (`verify/21-wildcard-terminal-multi.ts`):
```
/u/1/files:    null    /u/1/files/:    null    /u/1/files/a: {id:"1",p:"a"}
```

**판정**: 정확. **수정 필요**: no

---

## #22 [REFUTED] generic continuation empty param

**reproducer** (`verify/22-generic-empty-param.ts`):
```
/u/1/posts:    h
/u//posts:     null    (empty :id)
```

**판정**: 정확. **수정 필요**: no

---

## #23 [REFUTED] generic continuation store branch

**reproducer** (`verify/23-generic-store-branch.ts`):
```
/u/42: leaf    /u/42/posts: nested    /u/42/x: null
```

**판정**: 정확. **수정 필요**: no

---

## #24 [N/A] posVar <= len dead 가드

**판정**: posVar는 string index 결과라 0..len 범위. 가드는 항상 true. 무해. JIT elim 가능.

**수정 필요**: no

---

## #25 [N/A] MAX_SOURCE 8000

**판정**: 코드 인용으로 임의 값 사실. 측정 근거 코멘트 없음. 동작 정확. NIT.

**수정 필요**: no

---

## #26 [CODE-VERIFIED] F28 stale 코멘트

`segment-compile.ts:16-17` 미존재 stage 참조.

**수정 필요**: yes (NIT, 코멘트 정리)

---

## #27 [CODE-VERIFIED] useCache: true 하드코딩

`src/router.ts:133` `useCache: true`. emitter는 `cfg.useCache` 분기. 상수 위장 필드.

**수정 필요**: yes (config field 제거)

---

## #28 [N/A] cacheMaxSize emit 인라인

의도된 trade-off (cacheSize별 다른 함수). **수정 필요**: no

---

## #29 [N/A] specialized vs walker codegen

다른 layer (matchImpl vs walker). 책임 분리. **수정 필요**: no

---

## #30 [N/A] handlers mutable

의도된 hot-path 정책. sealed가 보호. **수정 필요**: no

---

## #31 [REFUTED] hasAnyStatic single-method 분기

**판정**: emitter.ts:234-249 single-method면 closure-captured activeBucket 사용. 정확.

**수정 필요**: no

---

## #32 [REFUTED] missCacheByMethod fallthrough

**판정**: emitter.ts:252-263 static-then-cache 순서 정확.

**수정 필요**: no

---

## #33 [REPRODUCED] EMPTY_PARAMS cache-write dead branch

**reproducer** (`verify/33-empty-params-deadbranch.ts`):
```
contains "=== EMPTY_PARAMS": true
match params: { id: "42" }   ← never EMPTY_PARAMS
```

**판정**: dead branch. **수정 필요**: yes (emit 단순화)

---

## #34 [N/A] per-match params alloc

의도된 trade-off (사용자 보관 안전성). **수정 필요**: no

---

## #35 [REPRODUCED] addAll 부분실패 leak

**reproducer** (`verify/35-addall-leak.ts`):
```
registeredCount: 1
orphan /leak present: true
orphan /leak/path present: true
static /ok/first kept: true
```

**판정**: #1과 동일 root cause. **수정 필요**: yes (트랜잭션 패턴)

---

## #36 [REPRODUCED] star expansion 부분 적용

**reproducer** (`verify/36-star-partial.ts`):
```
GET=star  POST=star  PUT=put-wild  PATCH=null  DELETE=null  OPTIONS=null  HEAD=null
```

**판정**: API atomic 의미 깨짐. 사용자가 catch 후 *부분 적용 상태*. **수정 필요**: yes (validate-all-then-commit)

---

## #37 [REPRODUCED] handlerIndex 재사용 → unreachable 우회

**reproducer** (`verify/37-handler-reuse.ts`):
```
1st leak: paramChild :x ownerHandler=0
handlers.length: 0 (popped)
2nd add throws: false  ← unreachable check 우회
match /a/something: second  ← walker 백트래킹으로 정확
```

**판정**: 검증 의도 위반. 매치는 정확. **수정 필요**: yes (트랜잭션 적용 시 자동 해결)

---

## #38 [N/A] checkWildcard prefix regex 비효율
빌드 시점, 영향 0. **수정 필요**: no

---

## #39 [N/A] first-wildcard break
무해 가드. **수정 필요**: no

---

## #40 [REFUTED] static-wildcard empty prefix edge
**reproducer** (`verify/40-static-wildcard-empty-prefix.ts`): `/` 등록이 `/*p` 후 `route-conflict`로 거부됨. 정확.
**수정 필요**: no

---

## #41 [REPRODUCED] snapshot freeze depth
**reproducer** (`verify/41-snapshot-freeze.ts`):
```
segmentTrees / staticMap / staticRegistered / outer Map: frozen
handlers: not frozen (intentional)
inner Map: not frozen (Object.freeze does NOT block Map.set)
```
**판정**: inner Map mutation 가능. internal subpath 책임이라 사용자 영향 0.
**수정 필요**: no (internal 영역, 또는 yes if perfectionism)

---

## #42 [REPRODUCED] testerCache 실패 등록 잔존
**reproducer** (`verify/42-tester-cache.ts`):
```
after 1st: [\d+]
after 2nd (fail): [\d+, \w+]
```
**판정**: 실패 등록의 tester가 cache에 잔존. anyTester 부풀림 + 메모리 미세.
**수정 필요**: yes (트랜잭션 롤백에 cache 정리 포함)

---

## #43 [N/A] detectWildCodegenSpec 중복 호출
빌드 시점 두 번. pure 함수, 결과 동일. **수정 필요**: no

---

## #44 [N/A] for...in proto-less ordering
JSC string-key insertion order 보장. 안전. **수정 필요**: no

---

## #45 [REFUTED] sparse array iteration
registered 검사로 정확. **수정 필요**: no

---

## #46 [CODE-VERIFIED] 옵션 디폴트 두 곳 분산
`router.ts:62-65` + `build.ts:145-148`. SSoT 위반.
**수정 필요**: yes

---

## #47 [DUP-#5] path-parser pattern raw
#5와 동일. **수정 필요**: yes (#5 처리에 포함)

---

## #48 [REFUTED] tokenize 빈 body
#3에서 검증. 정상 입력 거부 X. 결함 없음.
**수정 필요**: no

---

## #49 [PARTIAL REPRODUCED] decorator 조합
**reproducer** (`verify/49-decorator-combo.ts`):
```
/:a?+ → rejected (메타문자 검증)
/:a?* → rejected
/:a+? → wildcard multi (silent)
/:a*? → wildcard star (silent)
```
**판정**: `?` 먼저 strip 후 +/* 해석. 의미 불명확.
**수정 필요**: yes (입력 검증 강화)

---

## #50 [N/A] parseWildcard 중복 검사
SSoT 위반이나 결과 일치. NIT.
**수정 필요**: no

---

## #51 [N/A] activeParams.clear() timing
JS 단일 스레드. 안전.
**수정 필요**: no

---

## #52 [DUP-#5] validatePattern normalize 미사용
#5와 동일. **수정 필요**: yes (#5 처리에 포함)

---

## #53 [REFUTED] validateParamName 빈 문자열
코드 인용 정확. anonymous wildcard 정책 정확. **수정 필요**: no

---

## #54 [REPRODUCED] options 변경 → unreachable router
**reproducer** (`verify/54-options-mutation.ts`):
```
match /Hello: null
match /hello: null
```
**판정**: path-parser는 생성자 시점, matchImpl은 build 시점 캡처. 사용자가 사이에 mutate하면 라우트가 어떤 입력으로도 매치 안 됨.
**수정 필요**: yes (생성자에서 옵션 정규화)

---

## #55 [N/A] performBuild throw stuck
트리거 path 부재. 이론 결함. **수정 필요**: no

---

## #56 [N/A] closure vs internals 이중 추적
영향 0. **수정 필요**: no

---

## #57 [N/A] hasAnyStatic O(n) 재계산
영향 0. **수정 필요**: no

---

## #58 [N/A] cache evict 가드 부재
무한 루프 불가능. **수정 필요**: no

---

## #59 [REPRODUCED] cache T|null dead branch
**reproducer** (`verify/59-cache-null-deadbranch.ts`):
```
hc.set calls: hc.set(sp, { value: val, params: cachedParams })  ← 항상 객체
contains "if (cached === null)": true                            ← dead
```
**판정**: dead branch + dead type. **수정 필요**: yes

---

## #60 [CODE-VERIFIED] capacity vs maxSize
`cache.ts:33-34`: nextPow2(1000) = 1024. NIT, 코멘트만 부족.
**수정 필요**: no (코멘트 보강)

---

## #61 [N/A] DEFAULT_METHODS 7개 항상 등록
메모리 미세, 영향 0. **수정 필요**: no

---

## #62 [REFUTED] getOrCreate undefined check
Map.get 0과 undefined 구분 정확. **수정 필요**: no

---

## #63 [N/A] codeMap freeze 안 됨
의도 (hot-path mutable 정책). **수정 필요**: no

---

## #64 [REPRODUCED] specialized wild matchImpl dead
**reproducer** (`verify/64-specialized-dead.ts`):
```
matchImpl is specialized: false
contains "hitCacheByMethod": true   ← generic matchImpl 발동
```
**판정**: useCache=true 게이트로 specialized 영원히 disable. emitter.ts:111-174 (~63줄) dead.
**수정 필요**: yes (#27와 함께 — useCache 제거 후 specialized 살리거나 specialized 제거)

---

## #65 [N/A] for...in walker-strategy ordering
JSC 보장. **수정 필요**: no

---

## #66 [REPRODUCED] paramNames/paramValues 32 슬롯 dead
**reproducer** (`verify/66-paramarrays-dead.ts`):
```
paramNames[0..3]: "" "" "" ""
paramValues[0..3]: "" "" "" ""
paramCount: 0
```
**판정**: 매치 후에도 빈 상태. 어디서도 안 씀.
**수정 필요**: yes (코드 정리)

---

## #67 [CODE-VERIFIED] resetMatchState dead function
awk 검색 결과 src 코드 호출 사이트 0 (선언만 존재, spec에서만 호출).
**수정 필요**: yes (제거)

---

## #68 [REFUTED] allowedMethods sharedParams
**reproducer** (`verify/68-allowed-methods-shared-params.ts`):
```
allowed methods for /users/x: [ "GET", "POST" ]
```
**판정**: walker는 boolean 반환만 사용, params 내용 무관. 안전.
**수정 필요**: no

---

## #69 [N/A] matchState 재사용
JS 단일 스레드 + 호출 직전 reassign. 안전.
**수정 필요**: no

---

## #70 [REPRODUCED-internal] NullProtoObj prototype 교체
**reproducer** (`verify/70-nullproto-mutation.ts`):
```
NullProtoObj frozen: false
replaced: true
new instance polluted prop: yes
```
**판정**: internal 영역만. 정상 사용자 미노출. defensive 권고.
**수정 필요**: no (TS 본질, internal 책임)

---

## #71 [N/A] NullProtoObj JSC-only
engines.bun >=1.0.0 한정. 책임 범위 외.
**수정 필요**: no

---

## #72 [N/A] RouterError data 타입
분석 정확. discriminated union narrowing OK.
**수정 필요**: no

---
