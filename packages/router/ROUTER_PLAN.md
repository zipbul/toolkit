# Router Refactoring Plan

## 목표

`@zipbul/router`를 **순수 라우팅 엔진**으로 재설계한다.

- Router<T> 단일 클래스 — add() → build() → match() 라이프사이클
- build()에서 pre-built 함수 조립 — 런타임 config 분기 제거
- match()는 저장된 값 + params를 반환 — 핸들러 실행하지 않음
- throw / Result 적재적소 사용
- 에러는 친절하게

---

## 설계 원칙

### 1. 순수 라우팅 엔진

이 패키지는 라우팅만 한다. HTTP 스펙 편의 기능(HEAD→GET 폴백, 405 감지 등)은 상위 레이어의 책임이다.

**엔진의 책임:**
- 라우트 등록 (method + path + value)
- 경로 정규화 (trailing slash, collapse, dot-segments 등)
- 패턴 매칭 (static / param / wildcard / regex)
- 파라미터 추출
- 등록된 값 반환

**엔진의 책임이 아닌 것:**
- HEAD → GET 폴백
- 405 Method Not Allowed 감지
- 핸들러 실행
- HTTP 응답 생성
- 라우트 삭제
- Named routes

### 2. 단일 Router<T> 클래스 — seal 패턴

```
Router<T>
  .add(method, path, value)   → Result<void, RouterErrData>              (등록 + 즉시 검증)
  .addAll(entries)             → Result<void, RouterErrData>              (일괄 등록, fail-fast)
  .build()                     → this                                    (seal + 함수 조립, 항상 성공)
  .match(method, path)         → Result<MatchOutput<T> | null, RouterErrData>
```

> **타입 해설:** `Result<T, E> = T | Err<E>` (plain union, `@zipbul/result`).
> 따라서 `Result<void, RouterErrData>` = `void | Err<RouterErrData>`.

**라이프사이클:**

- `new Router<T>(options)` → 미빌드 상태
- `add()` → 라우트 등록 + 모든 validation 즉시 수행 → Result 반환
- `build()` → seal (불변 전환) + pre-built 함수 조립 → `this` 반환 (항상 성공)
- `match()` → pre-built 함수 호출 → Result 반환

**왜 build()는 항상 성공하는가:**

- 모든 validation(중복, 충돌, regex 안전성)은 `add()` 시점에 수행
- `build()`는 이미 검증된 트리를 직렬화(Flattener)하고 매칭 함수를 조립할 뿐
- 실패할 현실적 시나리오가 없으므로 Result 래핑은 불필요한 ceremony

**상태 전이 제어:**

- sealed 후 `add()` → `err({ kind: 'router-sealed' })`
- build 전 `match()` → `err({ kind: 'not-built' })`
- `build()` 2회 호출 → 멱등 (이미 sealed면 그대로 `this` 반환)
- 빈 라우터 `build()` → 합법 (모든 `match()`가 `null` 반환)

**`addAll()` fail-fast 정책:**

- 첫 에러에서 즉시 중단한다.
- 에러 발생 전까지 성공한 라우트는 **등록 상태를 유지**한다 (롤백 없음).
- 에러 데이터에 `registeredCount: number` 필드를 포함, 몇 개가 성공했는지 알려준다.
- all-or-nothing은 트리 기반 구조에서 스냅샷 비용이 비현실적이므로 채택하지 않는다.
- sealed 전이므로 사용자는 에러 후 수정하여 재시도할 수 있다.

### 3. Opaque Value 저장 — 실행은 호출자 책임

엔진은 `T`가 뭔지 모른다. 저장하고 반환만 한다.

```typescript
const router = new Router<MyHandler>();
router.add('GET', '/users/:id', getUserById);
router.build();

const result = router.match('GET', '/users/123');
// → { value: getUserById, params: { id: '123' } }
```

- `value: T` — add() 시 저장한 값 그대로 반환
- 라우트-값 일관성을 **엔진이 보장** (add 시 함께 등록)
- 제네릭은 `<T>` 하나 — 현재의 `Handler<R>`, `Router<R>` 복잡성 제거
- 실행은 호출자 영역 — 엔진은 관여하지 않음

### 4. 정규화 단일 경로

match()에서 정규화를 **1회만** 수행한다.
수동 전처리(trailing slash, case sensitivity)를 별도로 실행하지 않는다.
정규화된 경로로 static / dynamic 룩업 모두 수행한다.

### 5. Pre-built 함수 조립 — 런타임 분기 제거

config는 인스턴스 lifetime 동안 불변이다. 매 요청마다 config를 분기로 검사할 이유가 없다.

**원칙:** config에서 결정 가능한 모든 분기는 **빌드 타임에 함수로 확정**한다.

**조립 시점:**

| 함수 | 조립 시점 | 이유 |
|---|---|---|
| `normalizeForAdd` | constructor | `add()` 시 path 정규화에 사용 |
| `normalizeForMatch` | constructor | `match()` 시 path 정규화에 사용 (stripQuery 포함) |
| `decode` | constructor | config.encodedSlashBehavior로 결정 |
| `matchFn` | `build()` | static/cache/dynamic 조합이 build 시점에 확정 |

**buildNormalizer(config, opts):**

config 기반으로 필요한 정규화 단계만 포함한 클로저를 반환한다.

```typescript
function buildNormalizer(config: RouterOptions, opts: { stripQuery: boolean }) {
  const blockTraversal = config.blockTraversal;
  const collapseSlashes = config.collapseSlashes;
  const caseSensitive = config.caseSensitive;
  const maxSegLen = config.maxSegmentLength;

  return (path: string): Result<NormalizedPath, Err<RouterErrData>> => {
    // 각 단계는 captured config로 분기 — JIT가 constant로 취급 가능
    // this.options 포인터 추적 제거, pipeline loop + indirect call 제거
  };
}
```

**buildDecoder(behavior):**

```typescript
function buildDecoder(behavior: 'decode' | 'preserve' | 'reject') {
  if (behavior === 'preserve') return (v: string) => v;
  if (behavior === 'reject')  return rejectingDecoder;  // %2F 감지 시 err 반환
  return defaultDecoder;                                  // decodeURIComponent
}
```

3가지 함수 중 1개 선택 → 런타임 분기 **완전 제거**.

**buildMatchFunction(staticMap, cache, walker, values):**

build() 시점에 static/cache 유무에 따라 4가지 특화 함수 중 1개를 반환:

| staticMap | cache | 특화 |
|---|---|---|
| ✅ | ✅ | static 먼저 → cache → dynamic |
| ✅ | ❌ | static 먼저 → dynamic |
| ❌ | ✅ | cache → dynamic |
| ❌ | ❌ | dynamic only |

```typescript
match(method: string, path: string) {
  if (!this.sealed) return err({ kind: 'not-built', ... });
  return this.matchFn!(method, path);  // pre-built 함수 직접 호출
}
```

`matchFn` 내부에는 config 분기가 없다 — build() 시 이미 확정.

**제거되는 런타임 분기 (11개):**

| 분기 | 위치 | 제거 방법 |
|---|---|---|
| `if (collapseSlashes)` | normalize | buildNormalizer closure |
| `if (blockTraversal)` | normalize | buildNormalizer closure |
| `if (!caseSensitive)` | normalize | buildNormalizer closure |
| `if (ignoreTrailingSlash)` | normalize | buildNormalizer closure |
| `if (encodedSlashBehavior === 'reject')` | decode | buildDecoder |
| `if (enableCache)` | match() cache read | buildMatchFunction |
| `if (enableCache)` | match() cache write | buildMatchFunction |
| `if (staticMap.size > 0)` | match() static lookup | buildMatchFunction |
| `if (failFastOnBadEncoding)` | decode | buildDecoder 내 분기 |
| `if (maxSegmentLength)` | validate | buildNormalizer closure |
| `if (stripQuery)` | normalize | 별도 함수 (normalizeForAdd vs normalizeForMatch) |

---

## HttpMethod 타입 통일

### 현재 문제

- `@zipbul/shared`에 `const enum HttpMethod` 정의 — `verbatimModuleSyntax: true` 환경에서 외부 패키지 const enum import 제한
- `@zipbul/cors`에 별도 `CorsMethod` 타입 존재 — toolkit 내 method 타입 파편화
- 사용자에게 `HttpMethod.Get` import를 강제하면 DX 저하

### 변경 방향

**`@zipbul/shared`에 공용 타입 정의:**

```typescript
/**
 * HTTP method token.
 * 표준 7개 메서드에 대해 autocomplete을 제공하면서 커스텀 메서드(WebDAV 등)도 허용.
 */
export type HttpMethod =
  | 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS'
  | (string & {});
```

**변경 범위:**

| 패키지 | 변경 |
|---|---|
| `@zipbul/shared` | `const enum HttpMethod` → `type HttpMethod` (string literal union + 확장) |
| `@zipbul/shared` | `http-method.spec.ts` 테스트 수정/제거 |
| `@zipbul/cors` | `CorsMethod` → `HttpMethod` (shared에서 import) |
| `@zipbul/cors` | `constants.ts`, `cors.ts` — `HttpMethod.Get` → `'GET'` 리터럴 전환 |
| `@zipbul/cors` | `cors.spec.ts` — import 변경 |
| `@zipbul/router` | `HttpMethod` type → `@zipbul/shared`에서 import |

**사용자 인터페이스:**
```typescript
// import 없이 문자열 리터럴 (표준)
router.add('GET', '/users/:id', handler);

// OR shared에서 import해서 사용 (선택)
import type { HttpMethod } from '@zipbul/shared';
const method: HttpMethod = 'GET';
```

**커스텀 메서드 지원:**
```typescript
// WebDAV 등 — 타입 시스템이 허용
router.add('PROPFIND', '/webdav/:path', handler);
```

Router 내부의 `METHOD_OFFSET`는 build-time에 동적 확장:
- 기본 7개 (GET=0 ~ HEAD=6) 하드코딩
- `add()` 시 미지의 메서드 → 다음 offset 할당 (7, 8, ...)
- `build()` 시점에 고정 → binary layout은 기존 그대로 작동
- Uint32 bitmask → 최대 32개 메서드 (충분)

---

## 라우팅 옵션 전수 목록

### 현재 RouterOptions (types.ts)

| 옵션 | 타입 | 기본값 | 설명 | 상태 |
|---|---|---|---|---|
| `ignoreTrailingSlash` | `boolean` | `true` | `/foo/` → `/foo` 동일 취급 | ✅ 유지 |
| `collapseSlashes` | `boolean` | `true` | `//foo///bar` → `/foo/bar` | ✅ 유지 |
| `caseSensitive` | `boolean` | `true` | `/Foo` ≠ `/foo` 구분 여부 | ✅ 유지 |
| `decodeParams` | `boolean` | `true` | 파라미터 값 percent-decoding 여부 | ✅ 유지 |
| `preserveEncodedSlashes` | `boolean` | - | 사용처 없음. `encodedSlashBehavior`와 중복 | ❌ 제거 |
| `encodedSlashBehavior` | `'decode' \| 'preserve' \| 'reject'` | `'decode'` | `%2F` 처리 방식 | ✅ 유지 |
| `blockTraversal` | `boolean` | `true` | `/../` dot-segment 해소 | ✅ 유지 |
| `enableCache` | `boolean` | `false` | 동적 매칭 결과 LRU 캐시 | ✅ 유지 |
| `cacheSize` | `number` | `1000` | LRU 캐시 최대 엔트리 수 | ✅ 유지 |
| `maxSegmentLength` | `number` | `256` | 세그먼트 최대 길이 (DoS 방어) | ✅ 유지 |
| `strictParamNames` | `boolean` | `false` | 전역 파라미터 이름 유일성 강제 | ✅ 유지 |
| `optionalParamBehavior` | `'omit' \| 'setUndefined' \| 'setEmptyString'` | `'omit'` | 선택적 파라미터 미매칭 시 처리 | ✅ 유지 |
| `failFastOnBadEncoding` | `boolean` | `false` | 잘못된 percent-encoding 즉시 에러 | ✅ 유지 |
| `regexSafety` | `RegexSafetyOptions` | 아래 참조 | 파라미터 regex 안전성 검사 | ✅ 유지 |
| `regexAnchorPolicy` | `'warn' \| 'error' \| 'silent'` | `'error'` | regex에 `^`/`$` 포함 시 처리 | ✅ 유지 |
| `paramOrderTuning` | `ParamOrderingOptions` | - | 미사용 dead code | ❌ 제거 |
| `pipelineStages` | `PipelineStageConfig` | - | 미사용 dead code | ❌ 제거 |

### RegexSafetyOptions 상세

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `mode` | `'error' \| 'warn'` | `'error'` | 위반 시 에러/경고 전환 |
| `maxLength` | `number` | `256` | regex 소스 최대 길이 |
| `forbidBacktrackingTokens` | `boolean` | `true` | `.*`, `.+` 등 재귀적 역추적 토큰 금지 |
| `forbidBackreferences` | `boolean` | `true` | `\1` 등 역참조 금지 |
| `maxExecutionMs` | `number` | `undefined` | 패턴 실행 시간 제한 (ms) |
| `validator` | `(pattern: string) => void` | `undefined` | 사용자 커스텀 검증 함수 |

### 정리 후 RouterOptions

```typescript
interface RouterOptions {
  // 경로 정규화
  ignoreTrailingSlash?: boolean;      // default: true
  collapseSlashes?: boolean;          // default: true
  caseSensitive?: boolean;            // default: true
  blockTraversal?: boolean;           // default: true

  // 파라미터
  decodeParams?: boolean;             // default: true
  encodedSlashBehavior?: 'decode' | 'preserve' | 'reject';  // default: 'decode'
  optionalParamBehavior?: 'omit' | 'setUndefined' | 'setEmptyString';  // default: 'omit'
  strictParamNames?: boolean;         // default: false

  // 보안
  maxSegmentLength?: number;          // default: 256
  failFastOnBadEncoding?: boolean;    // default: false
  regexSafety?: RegexSafetyOptions;
  regexAnchorPolicy?: 'warn' | 'error' | 'silent';  // default: 'error'

  // 캐시
  enableCache?: boolean;              // default: false
  cacheSize?: number;                 // default: 1000
}
```

---

## throw vs Result 정책

### 판별 기준

| 기준 | throw (panic) | Result (expected failure) |
|---|---|---|
| **원인** | 프로그래밍 버그 | 사용자 입력 / 외부 요청 |
| **도달 가능성** | 정상 사용 시 불가능 | 정상 사용 중 발생 가능 |
| **복구** | 불가능 — 내부 상태 손상 | 가능 — 호출자가 대응 |
| **예시** | 배열 인덱스 불변성 위반 | 잘못된 라우트 패턴, 인코딩 오류 |

### throw — 내부 불변성 위반 (panic) — 4곳

프로그래밍 버그. 도달해서는 안 되는 상태. 호출자가 복구할 수 없다.

| 파일 | 현재 라인 | 에러 | 이유 |
|---|---|---|---|
| `builder.ts` | L58 | `Missing segment at index` (addSegments) | Processor가 정상이면 segments[index]는 항상 존재 |
| `builder.ts` | L110 | `Missing segment at index` (handleWildcard) | 동일 |
| `builder.ts` | L161 | `Missing segment at index` (handleParam) | 동일 |
| `builder.ts` | L334 | `Missing segment at index` (handleStatic) | 동일 |

> 4곳 모두 동일 패턴: `segments[index]`가 undefined인 경우. Processor가 올바른
> segments 배열을 생성했다면 절대 발생하지 않는다. throw를 유지한다.

### Result — 예상 가능한 실패 (expected failure) — 22곳

호출자가 처리해야 하는 상황. 복구 가능하다.

**빌드타임 (add 시점) — 18곳:**

| 에러 | kind | 파일:라인 | 설명 |
|---|---|---|---|
| sealed 후 add 호출 | `router-sealed` | router.ts (Phase 2 신규) | build() 이후에는 라우트 등록 불가 |
| 알 수 없는 HTTP 메서드 | `method-limit` | builder.ts:L82 | 32개 메서드 초과 (MethodRegistry) |
| 라우트 중복 등록 | `route-duplicate` | builder.ts:L88 | 동일 method + path에 이미 값 존재 |
| 와일드카드가 기존 children shadow | `route-conflict` | builder.ts:L114 | wildcard가 static/param children을 shadow |
| 와일드카드 위치 오류 | `route-parse` | builder.ts:L118 | `*`가 마지막 세그먼트가 아님 |
| 기존 와일드카드와 충돌 | `route-conflict` | builder.ts:L127 | 다른 이름/origin의 wildcard 이미 존재 |
| regex `}` 닫힘 오류 | `route-parse` | builder.ts:L201 | 파라미터 regex가 `}`로 닫히지 않음 |
| 파라미터 이름 없음 | `route-parse` | builder.ts:L208 | `:` 뒤에 이름이 없음 |
| `*`+`?` 접미사 동시 사용 | `route-parse` | builder.ts:L213 | zero-or-more는 이미 empty match 허용 |
| zero/multi param 위치 오류 | `route-parse` | builder.ts:L296 | `*`/`+` param이 마지막이 아님 |
| complex param이 wildcard 재사용 불가 | `route-conflict` | builder.ts:L308 | 기존 wildcard와 origin/이름 불일치 |
| static이 wildcard 하위 추가 불가 | `route-conflict` | builder.ts:L340 | 기존 wildcard 아래 static 추가 |
| 같은 이름 다른 regex param | `route-conflict` | builder.ts:L409 | 동일 이름에 다른 regex 패턴 |
| param이 wildcard 하위 추가 불가 | `route-conflict` | builder.ts:L415 | 기존 wildcard 아래 param 추가 |
| 같은 경로 내 중복 파라미터 이름 | `param-duplicate` | builder.ts:L439 | `:id/:id` 같은 중복 |
| 전역 파라미터 이름 중복 | `param-strict` | builder.ts:L449 | strictParamNames 활성 시 |
| regex safety 위반 | `regex-unsafe` | builder.ts:L474 | 위험한 정규식 패턴 감지 |
| regex anchor 위반 | `regex-anchor` | pattern-utils.ts:L60 | anchor policy=error 시 ^/$ 포함 |

**매치타임 (match 시점) — 4곳:**

| 에러 | kind | 파일:라인 | 설명 |
|---|---|---|---|
| 미빌드 상태 match | `not-built` | router.ts (Phase 2 신규) | build() 호출 없이 match() 시도 |
| 세그먼트 길이 초과 | `segment-limit` | validation.ts:L18 | maxSegmentLength 초과 |
| 인코딩 오류 | `encoding` | decoder.ts:L22, validation.ts:L30 | percent-encoding 디코딩 실패 |
| encoded slash 거부 | `encoded-slash` | decoder.ts:L12 | encodedSlashBehavior=reject 시 %2F |
| regex timeout | `regex-timeout` | pattern-tester.ts:L48 | 패턴 매칭 시간 초과 |

### RouterErrKind 최종 목록

```typescript
type RouterErrKind =
  // 상태 전이
  | 'router-sealed'      // build() 후 add() 시도
  | 'not-built'          // build() 전 match() 시도
  // 빌드타임 — 등록
  | 'route-duplicate'    // 동일 method+path 이미 존재
  | 'route-conflict'     // wildcard/param/static 구조적 충돌
  | 'route-parse'        // 패턴 문법 오류
  | 'param-duplicate'    // 같은 경로 내 동일 이름 파라미터
  | 'param-strict'       // strictParamNames 시 전역 이름 중복
  | 'regex-unsafe'       // regex safety 검사 실패
  | 'regex-anchor'       // anchor policy=error 시 ^/$ 포함
  | 'method-limit'       // 32개 메서드 초과 (MethodRegistry)
  // 매치타임
  | 'segment-limit'      // maxSegmentLength 초과
  | 'encoding'           // percent-encoding 디코딩 실패
  | 'encoded-slash'      // encodedSlashBehavior=reject 시 %2F
  | 'regex-timeout';     // 패턴 매칭 시간 초과
```

총 14개 kind. PLAN 초안 대비 추가: `param-strict`, `method-limit`.

---

## 에러 친절성 정책

모든 Result 에러는 다음 필드를 포함한다:

```typescript
interface RouterErrData {
  /** 에러 종류 (discriminant) */
  kind: RouterErrKind;
  /** 사람이 읽을 수 있는 상세 설명 */
  message: string;
  /** 문제가 된 전체 경로 (등록 시점 또는 매치 시점) */
  path?: string;
  /** 문제가 된 HTTP 메서드 */
  method?: string;
  /** 문제가 된 개별 세그먼트 */
  segment?: string;
  /** 충돌 대상 (기존에 등록된 라우트 등) */
  conflictsWith?: string;
  /** 수정 제안 (가능한 경우) */
  suggestion?: string;
  /** addAll() fail-fast 시 에러 전까지 성공한 등록 수 */
  registeredCount?: number;
}

interface MatchOutput<T> {
  /** add() 시 등록한 값 그대로 */
  value: T;
  /** 추출된 경로 파라미터 */
  params: Record<string, string | undefined>;
  /** 매칭 메타 정보 */
  meta: MatchMeta;
}

interface MatchMeta {
  /** 매칭 소스 (디버깅/모니터링용) */
  source: 'static' | 'cache' | 'dynamic';
}
```

**에러 메시지 작성 규칙:**
1. **무엇이 잘못되었는지** 명확히 기술
2. **어디서** 발생했는지 (경로, 세그먼트) 포함
3. **왜** 거부되었는지 이유 기술
4. **어떻게 고칠 수 있는지** suggestion 제공 (가능한 경우)

예시:
```typescript
err<RouterErrData>({
  kind: 'route-conflict',
  message: "Wildcard '*' at '/api/*' conflicts with existing static child '/api/users'. "
         + "Wildcard routes shadow all child routes at the same level.",
  path: '/api/*',
  segment: '*',
  conflictsWith: '/api/users',
  suggestion: "Move the wildcard to a deeper path, e.g. '/api/files/*', "
            + "or remove the conflicting static route.",
})

// addAll fail-fast 예시
err<RouterErrData>({
  kind: 'route-duplicate',
  message: "Route 'GET /users/:id' already exists.",
  path: '/users/:id',
  method: 'GET',
  registeredCount: 3,       // 4번째 엔트리에서 실패, 앞의 3개는 등록 완료
  suggestion: "Remove the duplicate route or use a different method.",
})
```

---

## Phase 구분

### Phase 0: 준비 (정리) — 🟢 전체 Sonnet

**목표:** 리팩토링 전 노이즈 제거.

**모델:** Sonnet (기계적 삭제/치환, 판단 불필요)

- [ ] Dead code 제거 — `🤖 Sonnet`
  - `handler-registry.ts` (파일 삭제)
  - `types.ts`: `PipelineStageConfig`, `BuildStageName`, `MatchStageName` 제거
  - `types.ts`: `ParamOrderingOptions`, `ParamOrderSnapshot`, `ParamNodeOrderSnapshot` 제거
  - `types.ts`: `RouterInstance`, `RouterBuilder` 인터페이스 제거
  - `types.ts`: `SuffixPlan` 제거
  - `types.ts`: `preserveEncodedSlashes` (RouterOptions에서) 제거
  - `types.ts`: `paramOrderTuning`, `pipelineStages` (RouterOptions에서) 제거
- [ ] `@bunner/logger` → `console` 전환 — `🤖 Sonnet`
  - `builder/builder.ts`: `Logger` → `console.warn`
  - `builder/pattern-utils.ts`: `Logger` → `console.warn`
- [ ] `match()` 내 설계 고민 주석 제거 (12줄) — `🤖 Sonnet`
- [ ] Flattener comparator 수정 — `🤖 Sonnet`
  - `(a[0] < b[0] ? -1 : 1)` → `(a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)`

**커밋:** `chore(router): remove dead code and clean up`

---

### Phase 1: HttpMethod 타입 통일 + types 정비 — 🟡 Sonnet 중심, 타입 설계만 Opus

**목표:** toolkit 전체에서 method 타입 통일, 새 아키텍처의 타입 토대 구축.

#### 1-1. `@zipbul/shared` HttpMethod 전환 — `🤖 Sonnet`

- [ ] `const enum HttpMethod` 삭제 → `type HttpMethod` (string literal union + `(string & {})`) 정의
- [ ] `http-method.spec.ts` 수정 (const enum 테스트 → 타입 테스트 또는 삭제)
- [ ] shared `index.ts` export 확인

#### 1-2. `@zipbul/cors` 마이그레이션 — `🤖 Sonnet`

- [ ] `CorsMethod` → `HttpMethod` (from `@zipbul/shared`)로 교체
- [ ] `constants.ts`: `HttpMethod.Get` → `'GET'` 리터럴 전환
- [ ] `cors.ts`: `HttpMethod.Options` → `'OPTIONS'` 리터럴 전환
- [ ] `cors.spec.ts`: `HttpMethod` import/사용 업데이트
- [ ] `interfaces.ts`: `CorsMethod` import 경로 변경
- [ ] CORS 테스트 전체 통과 확인

#### 1-3. `@zipbul/router` 타입 정비 — `🧠 Opus` (인터페이스 설계 판단)

- [ ] `@zipbul/shared` 의존성 추가 (`package.json`) — `🤖 Sonnet`
- [ ] `@zipbul/result` 의존성 추가 (`package.json`) — `🤖 Sonnet`
- [ ] `../types` import → `@zipbul/shared` 직접 import로 전환 — `🤖 Sonnet`
- [ ] `RouterErrKind` 타입 정의 (14개 kind, discriminated union) — `🧠 Opus`
- [ ] `RouterErrData` 인터페이스 정의 (`registeredCount` 포함) — `🧠 Opus`
- [ ] `MatchOutput<T>` 인터페이스 정의 (`value: T` + `params` + `MatchMeta`) — `🧠 Opus`
- [ ] `MatchMeta` 인터페이스 정의 (`source: 'static' | 'cache' | 'dynamic'`) — `🧠 Opus`
- [ ] `RouterOptions` 정리 (dead options 제거, `decodeParams` 유지 확인) — `🤖 Sonnet`
- [ ] `METHOD_OFFSET`를 동적 확장 가능한 구조로 변경 (→ MethodRegistry) — `🧠 Opus`
- [ ] `Handler<R>` 타입 제거 → `T` (opaque value) — `🤖 Sonnet`

**커밋:** `refactor: unify HttpMethod type across toolkit`

---

### Phase 2: 설계 변경 (핵심) — 🔴 전체 Opus

**목표:** god object → 단일 Router<T> 클래스 + pre-built 함수 조립.

**모델:** Opus (핵심 아키텍처 변경, 상태 머신 설계, 제어 흐름)

#### 2-1. Router<T> 클래스 재작성 — `🧠 Opus`

- [ ] `router.ts` 재작성 — 단일 `Router<T>` 클래스
  - constructor: options → config 확정, normalizer/decoder/methodRegistry 조립
  - `add(method, path, value): Result<void, RouterErrData>` — 등록 + 즉시 검증
  - `addAll(entries): Result<void, RouterErrData>` — 일괄 등록 (fail-fast, registeredCount 포함)
  - `build(): this` — seal + matchFn 조립 (항상 성공)
  - `match(method, path): Result<MatchOutput<T> | null, RouterErrData>` — pre-built 함수 호출
- [ ] `values: T[]` 배열 보유 → `matchOutput.value = this.values[handlerIndex]`
- [ ] `sealed: boolean` 필드 — 상태 전이 제어

#### 2-2. Constructor에서 조립하는 함수 — `🧠 Opus`

- [ ] `normalizeForAdd = buildNormalizer(config, { stripQuery: false })`
- [ ] `normalizeForMatch = buildNormalizer(config, { stripQuery: true })`
- [ ] `decode = buildDecoder(config.encodedSlashBehavior)`
- [ ] `methodRegistry = new MethodRegistry()` — 기본 7개 메서드 등록

#### 2-3. build()에서 조립하는 함수 — `🧠 Opus`

- [ ] `matchFn = buildMatchFunction({ staticMap, cache, walker, values, ... })`
  - staticMap.size > 0 / enableCache 조합에 따라 4가지 특화 중 선택
- [ ] Flattener.flatten() → TypedArray 생성
- [ ] String table pre-decode → `string[]`
- [ ] Matcher 인스턴스 생성 (직렬화된 binary data 수신)
- [ ] TreeBuilder + NodePool 참조 해제 → GC 수거

#### 2-4. MethodRegistry — `🧠 Opus`

- [ ] 새 클래스 `MethodRegistry`
  - 기본 7개 메서드 (GET=0 ~ HEAD=6) 하드코딩
  - `getOrCreate(method: string): number` — 미지의 메서드 → 다음 offset 할당
  - `get(method: string): number | undefined` — 조회만
  - Uint32 bitmask → 최대 32개 제한, 초과 시 `err({ kind: 'method-limit' })`

#### 2-5. Public API

```typescript
import { Router } from '@zipbul/router';
import { isErr } from '@zipbul/result';

// 생성 — <T>는 저장할 값의 타입
const router = new Router<MyHandler>();

// 등록 — value를 함께 전달, Result 반환
const addResult = router.add('GET', '/users/:id', getUserById);
if (isErr(addResult)) { /* 에러 처리 */ }

// 커스텀 메서드도 가능
router.add('PROPFIND', '/webdav/:path', handlePropfind);

// 빌드 — seal + 함수 조립, 항상 성공
router.build();

// 매칭 — Result 반환, 저장된 값 + params 반환
const matchResult = router.match('GET', '/users/123');
if (isErr(matchResult)) {
  // matchResult: Err<RouterErrData>
  console.error(matchResult.data.message);
  return;
}
// 타입 가드에 의해 Err 제외됨 → matchResult: MatchOutput<MyHandler> | null
if (matchResult === null) {
  // 404 — 매칭되는 라우트 없음
  return;
}

// 엔진은 여기까지 — 실행은 호출자의 영역
const { value: handler, params } = matchResult;
handler(params);  // 호출자가 원하는 방식으로 실행
```

**커밋:** `refactor(router): rewrite Router with seal pattern and pre-built functions`

---

### Phase 3: 에러 모델 전환 — 🔴 Opus 중심

**목표:** 26개 throw 사이트 중 22개를 Result로 전환, 4개는 throw 유지.

#### 3-1. Builder 에러 전환 — `🧠 Opus`

제어 흐름 재설계가 필요하다. Builder의 재귀 호출 (`addSegments` → `handleParam` → `addSegments` ...)
구조에서 Result를 전파해야 하므로 반환 타입이 연쇄적으로 변경된다.

- [ ] `builder.ts` — 모든 public/private 메서드 반환 타입: `Result<void, RouterErrData>` 또는 `Result<Node, RouterErrData>`
  - `route-duplicate` (1곳): L88 — 동일 method+path
  - `route-conflict` (6곳): L114, L127, L308, L340, L409, L415
  - `route-parse` (5곳): L118, L201, L208, L213, L296
  - `param-duplicate` (1곳): L439
  - `param-strict` (1곳): L449 — strictParamNames 전역 이름 중복
  - `regex-unsafe` (1곳): L474
  - `method-limit` (1곳): L82 — MethodRegistry 전환 후
- [ ] `pattern-utils.ts` — `regex-anchor` (1곳): L60
- [ ] throw 유지 (4곳): `Missing segment at index` (L58, L110, L161, L334) — 내부 불변성

#### 3-2. 매치 에러 전환 — `🧠 Opus`

Matcher의 `walk()` hot loop 내부에서 Result를 전파해야 한다.
TypedArray 기반 스택 머신에서의 에러 탈출 경로 설계가 핵심.

- [ ] `processor/steps/validation.ts` — `segment-limit` (1곳): L18
- [ ] `processor/decoder.ts` — `encoding` (1곳): L22 + `encoded-slash` (1곳): L12
- [ ] `processor/steps/validation.ts` — `encoding` (1곳): L30 (failFast)
- [ ] `matcher/pattern-tester.ts` — `regex-timeout` (1곳): L48

#### 3-3. 에러 메시지 친절화 — `🤖 Sonnet`

Opus가 3-1/3-2에서 Result 구조를 확정한 후, Sonnet이 메시지 텍스트를 채운다.

- [ ] 모든 에러에 path, segment, suggestion 포함 (템플릿 기반)
- [ ] 충돌 에러에 conflictsWith 포함
- [ ] addAll 에러에 registeredCount 포함

**커밋:** `refactor(router): adopt Result pattern for error handling`

---

### Phase 4: 극한 성능 최적화 — 🟡 혼합 (Opus 중심, 일부 Sonnet)

**목표:** TS 내 최적화로 성능 상한선 끌어올리기.

아래는 코드 전체 분석에서 발견한 모든 최적화 포인트. 영향도 순서.

#### 4-1. Processor single-pass scanner — `🧠 Opus` (영향: ~50-60% normalize 시간 절약)

현재: 매 요청마다 7개 파이프라인 함수 → 최소 3-4 배열 + 1 객체 + 1 Uint8Array 할당.

```
현재 흐름: stripQuery → removeLeadingSlash → split('/') → dotSegments → collapseSlashes → caseSensitivity → validate
     할당: ────────────────────────────── segments[] ─── stack[] ────── result[] ──────────────────── Uint8Array ──
```

**변경:**
- [ ] `isCleanPath(path)` fast-path 추가
  - charCodeAt 1회 스캔: `?`, `//`, `..`, `%`, 대문자(caseSensitive=false 시) 없으면 clean
  - clean path → split만 수행, 나머지 파이프라인 **완전 스킵**
  - static fast-path에서 normalize 불필요 → 이중 staticMap 룩업 문제도 해결
- [ ] dirty path 시에도 split + validate + collapse를 **단일 charCodeAt 루프**로 통합
  - `splitPath` 호출 대신 직접 `/` 기준 분리하면서 동시에 `%` 체크, empty segment 제거
  - 배열 할당 1회로 감소

#### 4-2. String table pre-decode — `🧠 Opus` (영향: ~30% getString 시간 절약)

현재: `Matcher.getString(id)` — 첫 호출 시 `TextDecoder.decode()`, 이후 `decodedStrings[]` 캐시.

**변경:**
- [ ] `Flattener.flatten()` 반환값에 `decodedStrings: string[]` 추가
- [ ] build() 시점에 string table 전체를 미리 디코딩
- [ ] Matcher constructor에서 `string[]` 직접 수신 → 내부 `TextDecoder` + lazy 캐시 제거
- [ ] `getString(id)` → `this.strings[id]` 직접 인덱싱

#### 4-3. TypedArray nullish coalescing 제거 — `🤖 Sonnet` (영향: ~5-15% walk 시간 절약)

현재 `walk()` 내부:
```typescript
const stage = this.stack[framePtr + FRAME_OFFSET_STAGE] ?? STAGE_ENTER;
const nodeIdx = this.stack[framePtr + FRAME_OFFSET_NODE] ?? 0;
```

`Int32Array`는 범위 내 접근 시 항상 number를 반환 — `undefined` 불가능.
`??` 연산자는 매 프레임마다 불필요한 undefined 체크를 발생시킨다.

**변경:**
- [ ] walk() 내부 모든 `this.stack[...] ?? default` → `this.stack[...]!` 또는 직접 접근
- [ ] 동일하게 `this.nodeBuffer[...] ?? 0`, `this.methodsBuffer[...] ?? 0` 등 모든 TypedArray 접근에서 `??` 제거
- [ ] `this.staticChildrenBuffer[ptr] ?? 0` 등도 동일 적용

#### 4-4. Cache key 2단 Map — `🧠 Opus` (영향: ~10-20ns/요청)

현재: `${method}:${searchPath}` — 매 요청마다 template literal로 새 문자열 할당.

**변경:**
- [ ] `Map<number, Map<string, T>>` 2단 구조 (methodCode → path → result)
- [ ] method를 number(METHOD_OFFSET 값)로 변환 후 첫 번째 Map lookup
- [ ] path 문자열만 두 번째 Map key — string concat 제거

#### 4-5. paramCache generation counter — `🧠 Opus` (영향: ~5-10ns/요청)

현재: 매 match() 호출마다 `for (i=0; i<segments.length; i++) paramCache[i] = undefined;`

**변경:**
- [ ] `paramCacheGeneration: number` 필드 추가
- [ ] `paramCacheGenerations: Uint32Array` (인덱스별 generation 기록)
- [ ] match() 시 `paramCacheGeneration++`
- [ ] `decodeAndCache()` — generation 불일치 시 miss로 처리

#### 4-6. Processor Context 풀링 — `🧠 Opus` (영향: GC 부담 감소)

현재: 매 normalize() 호출마다 `new ProcessorContext()` + `segments: string[] = []`.

**변경:**
- [ ] Processor 인스턴스에 `segmentBuffer: string[]` 사전 할당 (크기 32)
- [ ] `segmentDecodeHints: Uint8Array(256)` 사전 할당
- [ ] normalize() 시 buffer length 리셋으로 재사용
- [ ] ProcessorContext를 단일 재사용 인스턴스로 전환

#### 4-7. findStaticChild 1-child fast-path — `🤖 Sonnet` + `🧠 Opus 리뷰` (영향: 대부분 노드에서 분기 감소)

현재: `staticCount < 8` → 리니어 스캔, `>= 8` → binary search.
대부분의 트리 노드는 static child가 **1-2개**.

**변경:**
- [ ] `staticCount === 1` → 직접 비교 (loop 없음)
- [ ] `staticCount === 2` → 2회 비교로 분산
- [ ] `staticCount < 6` → 리니어 스캔 (threshold 벤치마크 후 확정)
- [ ] `>= 6` → binary search

#### 4-8. Cache → Clock-Sweep — `🧠 Opus` (영향: cache hit 시 delete+set 비용 제거)

현재: `Map.delete(key) + Map.set(key, value)` — V8/JSC 내부 해시 테이블 재조정 유발 가능.

**결정: Clock-Sweep 채택.** Doubly-linked list는 버린다.

| 비교 | Clock-Sweep | Doubly-Linked List + Map |
|---|---|---|
| get 비용 | boolean flag 1개 set | 포인터 6개 조작 (prev/next 분리+재연결) |
| eviction | hand 순회 (평균 빠름, 최악 O(n)) | O(1) tail 삭제 |
| 메모리 | 고정 크기 배열, GC 없음 | 노드 객체 생성/삭제, GC 부담 |
| 정확도 | 근사 LRU (자주 접근 = 생존) | 정확한 LRU |
| 라우터 적합성 | **최적** — hot path에서 최소 비용 | 부적합 — 노드 할당이 "할당 최소화" 철학에 반함 |

**Clock-Sweep 동작 원리:**
```
고정 배열: entries[maxSize] = { key, value, used: boolean }
hand: number (순회 포인터)
Map<key, index> (빠른 조회)

get(key):
  idx = map.get(key)
  entries[idx].used = true   ← 이게 전부. delete+set 없음.

set(key, value):
  if (배열 꽉 참):
    while entries[hand].used:
      entries[hand].used = false   // 한번 더 기회
      hand = (hand + 1) % maxSize
    // entries[hand].used === false → 이 자리 evict
    map.delete(entries[hand].key)
  entries[hand] = { key, value, used: true }
  map.set(key, hand)
```

**변경:**
- [ ] `ClockSweepCache<T>` 구현 — 고정 배열 + Map + hand
- [ ] 기존 `RouterCache` 교체
- [ ] 2단 Map (Phase 4-4)과 결합: `Map<number, ClockSweepCache<T>>`

#### 4-9. method bitmask 단순화 — `🤖 Sonnet` (영향: micro)

현재: `if (this.methodCode < 31 && mask & (1 << this.methodCode))`

표준 7개 메서드(0-6)는 항상 31 미만. 커스텀 확장해도 32개 이하.

**변경:**
- [ ] `methodCode < 31` 체크 제거 (Uint32 bitmask이므로 0-31은 항상 안전)
- [ ] `mask & (1 << this.methodCode)` 만으로 충분

#### 4-10. normalized 문자열 lazy 생성 — `🤖 Sonnet` + `🧠 Opus 리뷰` (영향: static hit 시 join 비용 제거)

현재: `normalized: '/' + ctx.segments.join('/')` — static fast-path에서 이미 매칭되면 불필요한 문자열 생성.

**변경:**
- [ ] normalize()가 segments만 반환, normalized 문자열은 lazy getter 또는 요청 시 생성
- [ ] static fast-path에서는 원본 path로 직접 룩업 → normalized 불필요

#### 4-11. suffixOffsets 사전 할당 — `🤖 Sonnet` (영향: wildcard 매칭 시 할당 제거)

현재: `getSuffixValue()` — `new Uint32Array(segments.length + 1)` lazy 할당.

**변경:**
- [ ] Matcher 인스턴스에 `suffixOffsets: Uint32Array(MAX_STACK_DEPTH)` 사전 할당
- [ ] 매 match() 시 길이만 리셋

#### 4-12. Flattener 빌드 최적화 — `🤖 Sonnet` + `🧠 Opus 리뷰` (영향: build-time only)

현재: `number[]`에 push → `Uint32Array.from()` 복사.

**변경:**
- [ ] 사전 크기 추정 → 직접 TypedArray에 write
- [ ] flattener comparator `=0` 케이스 추가 (Phase 0에서 수행)
- [ ] StaticChildMap이 정렬 유지 시 `Array.from + sort` 제거

#### 최적화 요약 (영향도 순)

| # | 포인트 | 영역 | 예상 효과 |
|---|---|---|---|
| 4-1 | Processor single-pass | normalize | **~50-60% 절약** |
| 4-2 | String table pre-decode | matcher | **~30% getString 절약** |
| 4-3 | TypedArray ?? 제거 | walk() hot loop | **~5-15% walk 절약** |
| 4-4 | Cache 2단 Map | cache lookup | ~10-20ns/req |
| 4-5 | paramCache generation | match init | ~5-10ns/req |
| 4-6 | Context 풀링 | normalize | GC 부담 감소 |
| 4-7 | 1-child static fast-path | walk() static | 분기 감소 |
| 4-8 | Cache → Clock-Sweep | cache hit | delete+set 제거 |
| 4-9 | bitmask 단순화 | walk() method check | micro |
| 4-10 | normalized lazy | normalize | static hit 시 join 제거 |
| 4-11 | suffixOffsets 사전 할당 | wildcard | 할당 제거 |
| 4-12 | Flattener 빌드 최적화 | build-time | 빌드 시간 감소 |

**커밋:** `perf(router): optimize processor and matcher hot paths`

---

### Phase 5: 코드 품질 — 🟢 전체 Sonnet

**모델:** Sonnet (기계적 정리)

- [ ] NodePool → TreeBuilder 인스턴스 소유 (전역 상태 제거) — `🤖 Sonnet`
- [ ] build() 후 TreeBuilder + NodePool 참조 해제 (`null` 설정) → GC 수거 가능 — `🤖 Sonnet`
- [ ] `index.ts` export 정리 (새 public API에 맞춤) — `🤖 Sonnet`
- [ ] package.json 정비 (`@zipbul/shared`, `@zipbul/result` 의존성) — `🤖 Sonnet`

**커밋:** `chore(router): finalize cleanup and exports`

---

## 의존성 변경

| 패키지 | 변경 |
|---|---|
| `@zipbul/shared` | 기존 의존성 — `HttpMethod` 타입 변경 (const enum → type) |
| `@bunner/logger` | 제거 |
| `@zipbul/result` | 신규 의존성 추가 (err, isErr, Result) |

---

## 공개 API 변경 (Breaking Changes)

| Before | After |
|---|---|
| `new Router(options)` | `new Router<T>(options)` |
| `router.add(method, path, handler)` | `router.add(method, path, value): Result<void, RouterErrData>` |
| `router.build(): this` | `router.build(): this` (seal + 함수 조립, 항상 성공) |
| `router.match(method, path): R \| null` | `router.match(method, path): Result<MatchOutput<T> \| null, RouterErrData>` |
| `Handler<R>` — 함수 타입, 엔진이 실행 | `T` — opaque value, 엔진이 저장+반환만 |
| `const enum HttpMethod` (shared) | `type HttpMethod` (string literal union + 확장) |
| `CorsMethod` (cors) | `HttpMethod` (shared에서 import) |
| method에 표준 7개만 | 커스텀 메서드 허용 (`(string & {})`) |

---

## 크로스 패키지 변경 범위

| 패키지 | 변경 요약 |
|---|---|
| `@zipbul/shared` | `const enum HttpMethod` → `type HttpMethod`, spec 수정 |
| `@zipbul/cors` | `CorsMethod` → `HttpMethod`, const enum 리터럴 전환, import 변경 |
| `@zipbul/router` | 전체 리팩토링 (Phase 0-5) |

---

## 검증 기준

각 Phase 완료 후:
1. 기존 테스트 통과 (Phase 0) 또는 새 테스트 작성 후 통과 (Phase 1+)
2. 타입 에러 없음 (`bun run typecheck` 또는 `tsc --noEmit`)
3. 성능 회귀 없음 (Phase 4 이후 벤치마크)
4. **Phase 1 검증**: shared/cors/router 모든 테스트 통과 (크로스 패키지 변경)

---

## 모델 배정 요약

| Phase | 작업 | 모델 |
|---|---|---|
| 0 | Dead code 삭제, logger 전환, 주석 제거, comparator | `🤖 Sonnet` |
| 1-1 | HttpMethod const enum → type | `🤖 Sonnet` |
| 1-2 | CORS CorsMethod 마이그레이션 | `🤖 Sonnet` |
| 1-3 | RouterErrKind, RouterErrData, MatchOutput 타입 설계 | `🧠 Opus` |
| 1-3 | import 경로 변경, 의존성 추가, dead options 삭제 | `🤖 Sonnet` |
| 2 전체 | Router<T> 재작성, buildNormalizer, buildDecoder, buildMatchFunction, MethodRegistry | `🧠 Opus` |
| 3-1 | Builder throw → Result 전환 (16곳) | `🧠 Opus` |
| 3-2 | Matcher/Processor throw → Result 전환 (4곳) | `🧠 Opus` |
| 3-3 | 에러 메시지 친절화 (텍스트 채우기) | `🤖 Sonnet` |
| 4-1 | Processor single-pass scanner | `🧠 Opus` |
| 4-2 | String table pre-decode | `🧠 Opus` |
| 4-3 | TypedArray ?? 제거 | `🤖 Sonnet` |
| 4-4 | Cache 2단 Map | `🧠 Opus` |
| 4-5 | paramCache generation counter | `🧠 Opus` |
| 4-6 | Context 풀링 | `🧠 Opus` |
| 4-7 | findStaticChild 1-child fast-path | `🤖 Sonnet` + `🧠 Opus 리뷰` |
| 4-8 | Clock-Sweep cache | `🧠 Opus` |
| 4-9 | bitmask 단순화 | `🤖 Sonnet` |
| 4-10 | normalized lazy 생성 | `🤖 Sonnet` + `🧠 Opus 리뷰` |
| 4-11 | suffixOffsets 사전 할당 | `🤖 Sonnet` |
| 4-12 | Flattener 빌드 최적화 | `🤖 Sonnet` + `🧠 Opus 리뷰` |
| 5 | NodePool 소유권, GC, export, package.json | `🤖 Sonnet` |

> **안내:** 작업 시작 시 해당 Phase의 모델 태그를 확인하고,
> `🤖 Sonnet` → "Sonnet으로 변경하세요",
> `🧠 Opus` → "Opus로 변경하세요" 안내를 따르세요.
> `🤖 Sonnet` + `🧠 Opus 리뷰` → Sonnet이 구현 후 Opus가 리뷰.
