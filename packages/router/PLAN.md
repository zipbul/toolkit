# @zipbul/router — 개선 계획

> 마지막 업데이트: 2026-02-26
> 현재 완성도 추정: ~65-70%
> PLAN 완료 후 추정: ~95-99% (4-1 클로저 트리 채택 여부에 따라 변동)

### 모델 배정 기준

각 항목 헤더에 `〔Opus〕` 또는 `〔Sonnet〕` 태그로 최적 모델을 명시한다.

| 태그 | 기준 | 해당 작업 유형 |
|------|------|----------------|
| **〔Opus〕** | 다중 파일 연쇄 리팩터링, 상태 머신 분해, 새 알고리즘 설계, 복잡한 영향 분석, 섬세한 판단이 필요한 테스트 | 3-1, 3-3, 3-7, 4-1, 4-2, router.spec, matcher.spec, builder.spec |
| **〔Sonnet〕** | 명세 확정된 기계적 변경, 단순 삭제/이동, 1-2파일 수정, 잘 정의된 인터페이스 구현, 보일러플레이트 테스트 | Phase 0-2 전체, 3-2, 3-4, 3-5, 4-3~4-9, Phase 5/7 전체, steps/*.spec, 나머지 spec |
| **〔Sonnet〕** | 프로퍼티 기반 테스트(구조는 단순하나 시나리오 생성이 기계적) | 6-5 (property-based) |

---

## ~~Phase 0: 버그 및 크래시 수정~~ ✅

운영 시 crash 또는 잘못된 동작을 유발하는 문제. 최우선 수정 대상.

### ~~0-1. `collapseSlashes` 기본값 버그~~ ✅ 〔Sonnet〕

- **파일**: `router.ts` L40
- **현상**: `options.collapseSlashes ?? options.ignoreTrailingSlash ?? true` — collapseSlashes가 미설정 시 ignoreTrailingSlash 값에 fallback됨. 이 두 옵션은 독립적 기능인데, `{ ignoreTrailingSlash: false }`만 설정하면 collapseSlashes도 의도치 않게 `false`가 됨.
- **조치**: `options.collapseSlashes ?? true`로 변경. ignoreTrailingSlash fallback 제거.

### ~~0-2. `MAX_STACK_DEPTH(64)` / `MAX_PARAMS(32)` 초과 시 미방어~~ ✅ 〔Sonnet〕

- **파일**: `matcher/constants.ts`, `builder/builder.ts`, `router.ts`
- **현상**: matcher의 TypedArray(stack, paramNames, paramValues)가 하드코딩된 64/32 크기. 세그먼트 depth > 64 또는 파라미터 > 32이면 배열 범위 초과 → crash 또는 silent data corruption.
- **조치**:
  1. `builder/builder.ts`의 `addSegments()` 재귀 진입 시 `index` (= depth)가 `MAX_STACK_DEPTH`를 초과하면 `Err({ kind: 'segment-limit', ... })` 반환.
  2. `addSegments()`에서 파라미터 등록 시 `activeParams.size`가 `MAX_PARAMS`를 초과하면 `Err({ kind: 'param-duplicate', ... })` 반환.
  3. 두 상수를 `matcher/constants.ts`에서 export하여 builder에서 import.
  4. `RouterErrKind`에 신규 kind 추가 불필요 — 기존 `'segment-limit'` 재사용 가능. 메시지로 구분.

### ~~0-3. `builder.ts` 내부 `throw` 4곳 — Result 패턴 불일치~~ ✅ 〔Sonnet〕

- **파일**: `builder/builder.ts` L58, L102, L183, L399
- **현상**: `throw new Error('Missing segment at index ...')`. 라이브러리 전체가 `@zipbul/result` 패턴을 사용하는데 이 4곳만 throw. 호출자가 catch하지 않으면 process crash.
- **결정**: 이 4곳은 모두 `segments[index]`가 undefined인 경우 — TypeScript의 배열 접근에서 발생하는 방어 코드. 정상 호출에서는 도달 불가능.
- **조치**: `never` 반환 타입의 assert 헬퍼를 생성하여 대체.
  ```typescript
  // builder/assert.ts
  export function assertDefined<T>(value: T | undefined, msg: string): asserts value is T {
    if (value === undefined) throw new Error(msg); // 내부 invariant 위반 — 복구 불가
  }
  ```
  throw가 아닌 Err()로는 변경하지 않음 — 이 경우는 프로그래밍 에러(invariant violation)이지 사용자 입력 에러가 아니므로 crash가 맞음. `assertDefined`로 의도를 명확화하는 것이 목적.

---

## Phase 1: Dead Code 제거

소스에 남아있는 사용되지 않는 코드를 정리한다.

### 1-1. `decodeURIComponentSafe` 제거 〔Sonnet〕

- **파일**: `processor/decoder.ts` L69-73
- **현상**: `@deprecated` 표시된 함수. 정의만 존재하고 호출하는 곳이 0곳.
- **조치**: 함수 삭제. `processor/index.ts`에서 re-export도 삭제.

### 1-2. `Node.patternTester` 필드 제거 〔Sonnet〕

- **파일**: `builder/node.ts`
- **현상**: 필드가 선언되어 있으나 builder에서 한 번도 set하지 않음. matcher에서도 미참조.
- **조치**: `Node` 타입과 구현에서 필드 삭제.

### 1-3. `Node.paramSortScore` 필드 제거 〔Sonnet〕

- **파일**: `builder/node.ts`
- **현상**: 필드 선언만 존재, 사용처 0곳.
- **조치**: 필드 삭제.

### 1-4. `NormalizedPathSegments` dead 필드 제거 〔Sonnet〕

- **파일**: `types.ts`
- **현상**: `segmentOffsets`, `suffixSource`, `hadTrailingSlash` 필드가 타입에 정의되어 있으나 어디서도 값을 설정하지 않음.
- **조치**: 해당 세 필드 삭제.

### 1-5. `snapshot` 관련 코드 제거 〔Sonnet〕

- **파일**: `matcher/matcher.ts`, `types.ts`
- **현상**: `captureSnapshot` 파라미터가 항상 `false`로 호출됨. `getSnapshot()` public 메서드 존재하나 외부 호출 없음. `DynamicMatchResult.snapshot` 필드도 dead.
- **조치**: `captureSnapshot` 파라미터 삭제, `getSnapshot()` 메서드 삭제, `DynamicMatchResult.snapshot` 필드 삭제, `walk()` 내부 snapshot 분기 코드 삭제.

### 1-6. `strictParamNames` 옵션 삭제 〔Sonnet〕

- **파일**: `types.ts`, `builder/builder.ts`, `builder/types.ts`, `router.ts`
- **현상**: 동일 경로의 파라미터 이름 불일치를 금지하는 옵션. 실용적 가치가 낮음 (예: `/users/:id`와 `/users/:userId` 공존은 흔한 패턴).
- **결정**: 삭제.
- **조치**:
  1. `RouterOptions`에서 `strictParamNames` 필드 삭제.
  2. `BuilderConfig`에서 `strictParamNames` 필드 삭제.
  3. `router.ts` constructor에서 `strictParamNames` 전달 코드 삭제 (L83-L85).
  4. `builder.ts`의 `registerGlobalParamName()`에서 `strictParamNames` 조건 분기 삭제 — 항상 Set에 등록만 수행.
  5. `RouterErrKind`에서 `'param-strict'` 제거.
  6. 관련 테스트 `it` 삭제: `router-errors.test.ts`에서 strictParamNames 관련 케이스 확인 후 제거.

### 1-7. `NodePool.release()` dead method 삭제 + 클래스 리네이밍 〔Sonnet〕

- **파일**: `builder/node-pool.ts`, `builder/builder.ts`
- **현상**: `release()` 메서드가 정의되어 있으나 전체 소스에서 호출하는 곳이 **0건**. pool 반환 경로가 없으므로 사실상 Object pool이 아닌 단순 factory.
- **결정**: 삭제. build() 이후 trie 전체가 GC 수거되므로 pool 반환 로직은 불필요.
- **조치**:
  1. `release()` 메서드 삭제.
  2. 클래스명 `NodePool` → `NodeFactory`로 변경 (factory 패턴 명확화).
  3. 내부 `pool` 배열과 관련 재활용 로직이 있다면 함께 제거.
  4. `builder.ts`에서 import/사용처 변경: `new NodePool()` → `new NodeFactory()`.

---

## Phase 2: 코드 정리 (Cleanup)

버그는 아니지만 코드 품질·가독성·유지보수성을 떨어뜨리는 항목.

### 2-1. `allMethods` 배열 상수화 〔Sonnet〕

- **파일**: `router.ts` L111 부근
- **현상**: `match()` 호출마다 `Object.values(HttpMethod)` 등으로 배열을 재생성함.
- **조치**: 모듈 레벨 `const ALL_METHODS`로 한번만 생성.

### 2-2. `METHOD_OFFSET[method]` fallback 제거 + 계층 위반 해소 〔Sonnet〕

- **파일**: `router.ts` L220/L229/L316/L343, `matcher/matcher.ts`, `builder/flattener.ts`
- **현상**: `this.methodCodes.get(method) ?? METHOD_OFFSET[method]` 패턴이 router.ts에만 4곳. `METHOD_OFFSET`은 `schema.ts`의 binary layout 내부 상수인데 Router가 직접 import하여 사용 — **계층 위반**. build() 후 `methodCodes`는 완전하므로 fallback은 dead code.
- **조치**: Router에서 `METHOD_OFFSET` import 제거. `methodCodes.get()` 결과가 undefined이면 Err 반환. `METHOD_OFFSET`은 binary layout 상수이므로 `schema.ts`에 유지 — `matcher/matcher.ts`·`builder/flattener.ts`에서의 사용은 계층 위반이 아님.

### 2-3. 캐시 write 로직 중복 제거 〔Sonnet〕

- **파일**: `router.ts` L326-344, L347-360
- **현상**: 캐시에 결과를 기록하는 코드가 두 블록에 거의 동일하게 반복됨.
- **조치**: `writeCacheEntry()` 같은 private 헬퍼로 추출.

### 2-4. `collapseSlashes` 기본값 `true`로 확정 〔Sonnet〕

- **파일**: `router.ts` L40
- **현상**: Phase 0-1에서 fallback 체인 제거 후, 기본값이 `true`임을 확인하는 항목. RFC 3986 상 연속 슬래시는 빈 세그먼트를 의미하지만 실무에서 보존이 필요한 경우는 극히 드묾.
- **결정**: `true` 확정. v0.x이므로 BREAKING 아님.
- **조치**:
  1. Phase 0-1 완료 후 `router.ts` L40이 `options.collapseSlashes ?? true`인지 확인.
  2. 이미 0-1에서 `ignoreTrailingSlash` fallback이 제거되면 자동 해결. 코드 리뷰만 필요.

### 2-5. 내부 export 정리 〔Sonnet〕

- **파일**: `processor/index.ts`, `builder/index.ts`
- **현상**: `ProcessorContext`, `DecoderFn`, `decodeURIComponentSafe`, `OptionalParamDefaults`, `BuilderConfig` 등 내부 구현 타입이 외부로 노출됨.
- **조치**: 외부에 필요한 것만 export. 나머지는 패키지 내부로 제한.

#### 목표 export 목록 (`index.ts` 최종 상태)

```typescript
// index.ts
export { Router } from './src/router';
export type {
  RouterOptions,
  EncodedSlashBehavior,
  OptionalParamBehavior,
  RegexSafetyOptions,
  RouteParams,
  RouterErrKind,
  RouterErrData,
  MatchMeta,
  MatchOutput,
  RouterWarning,       // 2-7에서 추가
} from './src/types';
```

#### 제거 대상 (하위 index.ts)

| 파일 | 제거 심볼 | 사유 |
|------|----------|------|
| `builder/index.ts` | `BuilderConfig`, `OptionalParamDefaults` | 내부 전용 |
| `processor/index.ts` | `ProcessorContext`, `DecoderFn`, `ProcessorConfig` | 내부 전용 |

하위 `index.ts`에서 내부 심볼을 제거해도 같은 패키지 내부의 직접 import (`from './builder/types'`)에는 영향 없음.

### 2-6. RegExp 리터럴 추출 〔Sonnet〕

- **파일**: `builder/pattern-utils.ts`, `processor/steps/` 등
- **현상**: 함수 내부에서 RegExp 리터럴을 반복 생성하는 곳이 있음.
- **조치**: 모듈 레벨 `const`로 추출하여 재생성 비용 제거.

### 2-7. `console.warn` → `onWarn` 콜백 패턴 〔Sonnet〕

- **파일**: `types.ts`, `router.ts`, `builder/builder.ts` L563, `builder/pattern-utils.ts` L69, `builder/types.ts`
- **현상**: `console.warn` 직접 호출 2곳. 라이브러리에서 stdout 오염은 비권장.
- **조치**:
  1. `types.ts`에 경고 타입 추가:
     ```typescript
     export interface RouterWarning {
       kind: 'regex-unsafe' | 'regex-anchor';
       message: string;
       path?: string;
       segment?: string;
     }
     ```
  2. `RouterOptions`에 `onWarn` 콜백 추가:
     ```typescript
     onWarn?: (warning: RouterWarning) => void;
     ```
  3. `BuilderConfig`에 `onWarn?` 필드 추가.
  4. `router.ts` constructor에서 `options.onWarn`을 `BuilderConfig`에 전달.
  5. `builder.ts` L563 (`ensureRegexSafe()` 내부 `mode === 'warn'` 분기):
     - `console.warn(msg)` → `this.config.onWarn?.({ kind: 'regex-unsafe', message: msg, segment: patternSrc })`
  6. `pattern-utils.ts` L69:
     - `console.warn(...)` → `this.config.onWarn?.({ kind: 'regex-anchor', ... })`. PatternUtils constructor에 onWarn 전달 필요.
  7. `onWarn` 미설정 시 경고를 **조용히 무시**. 사용자가 원하면 `onWarn: w => console.warn(w.message)` 명시.

### 2-8. `Flattener` stateless class → 순수 함수 〔Sonnet〕

- **파일**: `builder/flattener.ts`
- **현상**: `Flattener.flatten()` 하나의 static method만 존재. 인스턴스 생성 없이 static 호출만 함. class 래핑 불필요.
- **조치**: `export function flatten()` 순수 함수로 변경.

---

## Phase 3: 아키텍처 개선

파일 분할, 책임 재배치, 구조 변경. 전체 리팩터링의 핵심 Phase.

### 3-1. `match()` 분해 — 180줄 god method → 5개 private 메서드 〔Opus〕

- **파일**: `router.ts` L191-L372
- **현상**: `match()`가 ~180줄의 god method. static 매칭, 캐시 조회/기록, 정규화, dynamic 매칭, 404 처리가 모두 한 메서드에 혼재.
- **목표**: `match()`는 오케스트레이션만 수행 (40줄 이하). 각 단계를 private 메서드로 분리.

#### 추출할 메서드 시그니처

```typescript
/**
 * HTTP 메서드를 내부 코드로 변환. match() 진입 시 1회만 호출.
 * Phase 2-2에서 METHOD_OFFSET fallback 제거 후 단순화됨.
 */
private resolveMethodCode(method: HttpMethod): number | undefined {
  return this.methodCodes.get(method);
}

/**
 * trailing slash 제거 + case 변환. match() 입력 경로 전처리.
 * @returns 정규화된 검색 경로
 */
private preNormalize(path: string): string {
  let p = path;
  if (this.options.ignoreTrailingSlash === true && p.length > 1 && p.endsWith('/')) {
    p = p.slice(0, -1);
  }
  if (this.options.caseSensitive === false) {
    p = p.toLowerCase();
  }
  return p;
}

/**
 * 정적 라우트 O(1) 조회.
 * @returns T (hit) 또는 undefined (miss)
 */
private matchStatic(searchPath: string, methodCode: number): T | undefined {
  const values = this.staticMap.get(searchPath);
  return values?.[methodCode];
}

/**
 * 캐시에서 이전 매칭 결과 조회.
 * @returns undefined = 캐시 miss
 *          null = cached 404 (이전에 매칭 실패한 경로)
 *          DynamicMatchResult = 캐시 hit
 */
private lookupCache(
  searchPath: string,
  methodCode: number,
): DynamicMatchResult | null | undefined {
  if (!this.cacheByMethod) return undefined;
  return this.cacheByMethod.get(methodCode)?.get(searchPath);
}

/**
 * 매칭 결과를 캐시에 기록.
 * result=null이면 부정 캐시 (404 캐싱).
 * params는 Object.freeze()로 immutable 보장 → 3-6 해결.
 */
private writeCacheEntry(
  searchPath: string,
  methodCode: number,
  result: DynamicMatchResult | null,
): void {
  if (!this.cacheByMethod) return;
  let mc = this.cacheByMethod.get(methodCode);
  if (!mc) {
    mc = new RouterCache(this.cacheMaxSize);
    this.cacheByMethod.set(methodCode, mc);
  }
  if (result) {
    mc.set(searchPath, {
      handlerIndex: result.handlerIndex,
      params: Object.freeze({ ...result.params }),
    });
  } else {
    mc.set(searchPath, null);
  }
}
```

#### 리팩터링된 `match()` 구조 (의사코드)

```typescript
match(method: HttpMethod, path: string): Result<MatchOutput<T> | null, RouterErrData> {
  // 1. 상태 검증
  if (!this.sealed) return err({ kind: 'not-built', ... });

  // 2. 메서드 코드 해석 (1회)
  const methodCode = this.resolveMethodCode(method);
  if (methodCode === undefined) return null;

  // 3. 경로 전처리
  const searchPath = this.preNormalize(path);

  // 4. 정적 매칭
  const sv = this.matchStatic(searchPath, methodCode);
  if (sv !== undefined) return { value: sv, params: {}, meta: { source: 'static' } };

  // 5. 캐시 조회
  const cached = this.lookupCache(searchPath, methodCode);
  if (cached !== undefined) {
    if (cached === null) return null;
    const v = this.handlers[cached.handlerIndex];
    // frozen params — spread 불필요 (3-6)
    return v !== undefined ? { value: v, params: cached.params, meta: { source: 'cache' } } : null;
  }

  // 6. 정규화
  const norm = this.processor.normalize(searchPath);
  if (isErr(norm)) return err({ ...norm.data, path, method });

  // 7. 정규화 후 정적 재시도 (경로가 변경된 경우만)
  if (norm.normalized !== searchPath) {
    const sv2 = this.matchStatic(norm.normalized, methodCode);
    if (sv2 !== undefined) return { value: sv2, params: {}, meta: { source: 'static' } };
  }

  // 8. 동적 매칭
  const mr = this.matcher!.match(method, norm.segments, norm.normalized,
    norm.segmentDecodeHints, this.options.decodeParams ?? true, false);
  if (isErr(mr)) return err({ ...mr.data, path, method });

  if (mr) {
    const hi = this.matcher!.getHandlerIndex();
    const params = this.matcher!.getParams();
    this.optionalParamDefaults?.apply(hi, params);
    const value = this.handlers[hi];
    if (value === undefined) return null;
    this.writeCacheEntry(searchPath, methodCode, { handlerIndex: hi, params });
    return { value, params, meta: { source: 'dynamic' } };
  }

  // 9. 404 캐싱
  this.writeCacheEntry(searchPath, methodCode, null);
  return null;
}
```

#### 의존 관계 및 작업 순서

- **선행**: Phase 2-2 (`METHOD_OFFSET` fallback 제거) → `resolveMethodCode()`가 단순해짐.
- **선행**: Phase 2-3 (캐시 write 중복 제거) → 이 항목의 `writeCacheEntry()`에서 자연 통합됨.
- **흡수**: Phase 3-6 (`{...cached.params}` spread) → `writeCacheEntry()`에서 `Object.freeze()` 적용으로 해결.
- **후행**: Phase 4-7 (isCleanPath 이중스캔) → `preNormalize()`와 Processor를 통합할 때 함께 고려.

### 3-2. `builder.ts` 분할 (581줄 → ~320줄 + ~230줄) 〔Sonnet〕

- **파일**: `builder/builder.ts` → `builder/builder.ts` + `builder/validator.ts` (신규)
- **현상**: trie 구축 + 파라미터 검증 + regex 안전성 검사 + 스코프 관리가 한 파일.
- **목표**: 각 파일 300줄 이하 (헬퍼 유틸 제외).

#### 분리 기준

| 잔류 (builder.ts ~320줄) | 이동 (validator.ts ~230줄) |
|---|---|
| `add()`, `build()` | `registerParamScope()` |
| `addSegments()` | `registerGlobalParamName()` |
| `handleStatic()`, `handleExistingStatic()` | `ensureNoParamConflict()` |
| `handleParam()`, `handleComplexParam()` | `ensureRegexSafe()` |
| `handleWildcard()` | `applyParamRegex()` |
| `registerRoute()`, `getPathString()` | `findMatchingParamChild()` |

#### 신규 `validator.ts` 인터페이스

```typescript
// builder/validator.ts
import type { Result } from '@zipbul/result';
import type { Node } from './node';
import type { BuilderConfig } from './types';
import type { PatternUtils } from './pattern-utils';
import type { RouterErrData } from '../types';

export class RouteValidator {
  private readonly globalParamNames = new Set<string>();

  constructor(
    private readonly config: BuilderConfig,
    private readonly patternUtils: PatternUtils,
  ) {}

  /** 경로 분기 내 파라미터 이름 중복 검사. 성공 시 cleanup 함수 반환. */
  registerParamScope(
    name: string, activeParams: Set<string>, segments: string[],
  ): Result<() => void, RouterErrData>;

  /** 전역 파라미터 이름 등록 (strictParamNames 삭제 후 단순 Set.add). */
  registerGlobalParamName(name: string): void;

  /** 동일 position에서 동일 이름 + 다른 regex 파라미터 충돌 검사. */
  ensureNoParamConflict(
    node: Node, name: string, patternSrc: string | undefined,
    segments: string[], index: number,
  ): Result<void, RouterErrData>;

  /** regex 안전성 검사. mode='warn'이면 onWarn 콜백 호출. */
  ensureRegexSafe(patternSrc: string): Result<void, RouterErrData>;

  /** 파라미터 노드에 regex 패턴 적용 (정규화 + 안전성 검사 포함). */
  applyParamRegex(node: Node, patternSrc: string): Result<void, RouterErrData>;

  /** 기존 파라미터 자식 중 동일 이름+regex 조합 검색. */
  findMatchingParamChild(
    node: Node, name: string, patternSrc?: string,
  ): Node | undefined;
}
```

#### Builder의 사용 방식

```typescript
// builder/builder.ts
export class Builder<T> {
  private readonly validator: RouteValidator;

  constructor(config: BuilderConfig) {
    this.config = config;
    this.patternUtils = new PatternUtils(config);
    this.validator = new RouteValidator(config, this.patternUtils);
    // ...
  }

  // handleParam() 내부:
  //   this.registerParamScope(...)   → this.validator.registerParamScope(...)
  //   this.ensureNoParamConflict(...) → this.validator.ensureNoParamConflict(...)
  //   this.applyParamRegex(...)       → this.validator.applyParamRegex(...)
  //   this.findMatchingParamChild(...) → this.validator.findMatchingParamChild(...)
}
```

#### 의존 관계

- **선행**: Phase 1-6 (`strictParamNames` 삭제) → validator에서 strict 분기 불필요.
- **선행**: Phase 2-7 (`onWarn` 콜백) → `ensureRegexSafe()`에서 onWarn 사용.

### 3-3. `matcher.ts` walk() 분해 (284줄 → ~100줄 + 3개 헬퍼) 〔Opus〕

- **파일**: `matcher/matcher.ts` L236-L520 (`walk()` 메서드)
- **현상**: 4단계 상태 머신(`ENTER`, `STATIC`, `PARAM`, `WILDCARD`)이 단일 while 루프 안에 모두 포함.
- **기존 분리 메서드**: `findStaticChild()` (L522-L547, ~25줄)이 이미 private 메서드로 분리되어 있음. 이를 유지하고 추가 분리 대상은 아래 3개.
- **목표**: `walk()`는 루프 + 디스패치만. 각 stage 처리를 private 메서드로 분리.

#### 분리 전략

`walk()` 내부는 공유 상태(`stack`, `paramCount`, `paramNames`, `paramValues`)에 의존하므로 순수 함수 추출은 불가. 대신 **stage 처리 메서드**로 분리.

```typescript
/**
 * 터미널 노드(세그먼트 끝) 도달 시 핸들러 검색.
 * @returns handlerIndex (성공), null (핸들러 없음)
 */
private checkTerminal(nodeIdx: number): number | null {
  // nodeBuffer에서 methodsPtr, methodMask 확인
  // this.methodCode에 해당하는 핸들러 인덱스 반환
}

/**
 * 파라미터 자식 노드 하나를 시도.
 * 디코딩 + 패턴 테스트를 수행하고, 매칭 시 paramNames/Values에 기록.
 * @returns true = 스택에 새 프레임 push됨, false = 이 파라미터 skip
 */
private tryParamChild(
  childIdx: number, segIdx: number, sp: number, decodeParams: boolean,
): Result<boolean, RouterErrData>;

/**
 * 와일드카드 자식 노드를 시도.
 * suffixValue 계산 + wildcardOrigin 검증 + 핸들러 검색.
 * @returns handlerIndex (성공), null (미매칭)
 */
private tryWildcard(
  nodeIdx: number, segIdx: number,
): number | null;
```

#### 리팩터링된 `walk()` 구조 (의사코드)

```typescript
private walk(decodeParams: boolean): Result<number | null, RouterErrData> {
  let sp = FRAME_SIZE; // 루트 프레임 초기화 생략
  this.initRootFrame();

  while (sp > 0) {
    const f = sp - FRAME_SIZE;
    const stage = this.stack[f + FRAME_OFFSET_STAGE]!;
    const nodeIdx = this.stack[f + FRAME_OFFSET_NODE]!;
    const segIdx = this.stack[f + FRAME_OFFSET_SEGMENT]!;

    switch (stage) {
      case STAGE_ENTER:
        if (segIdx === this.segments.length) {
          const result = this.checkTerminal(nodeIdx);
          if (result !== null) return result;
          this.stack[f + FRAME_OFFSET_STAGE] = STAGE_WILDCARD;
        } else {
          this.stack[f + FRAME_OFFSET_STAGE] = STAGE_STATIC;
        }
        continue;

      case STAGE_STATIC:
        // findStaticChild → push child frame or fall through to PARAM
        // (기존 로직 유지, 20줄)
        continue;

      case STAGE_PARAM:
        // 이터레이터 기반 paramChildren 순회
        // 각 자식에 tryParamChild() 호출
        continue;

      case STAGE_WILDCARD: {
        const result = this.tryWildcard(nodeIdx, segIdx);
        if (result !== null) return result;
        sp -= FRAME_SIZE;
        if (sp > 0) this.paramCount = this.stack[sp - FRAME_SIZE + FRAME_OFFSET_PARAM_BASE]!;
        continue;
      }
    }
  }
  return null;
}
```

#### 주의사항

- `checkTerminal()`, `tryParamChild()`, `tryWildcard()`는 `this.stack`, `this.paramCount` 등 인스턴스 필드를 직접 변경함 → 부수효과 있는 메서드.
- `tryParamChild()`는 `Result` 반환 (디코딩 에러 가능) → `walk()`에서 `isErr()` 체크 필요.
- 목표: `walk()` 본문 80줄 이하, 각 헬퍼 40줄 이하.

### 3-4. `flattener.ts` → 순수 함수 + 서브 함수 분해 〔Sonnet〕

- **파일**: `builder/flattener.ts` (258줄)
- **현상**: `Flattener.flatten()` 단일 ~250줄 static 메서드. Phase 2-8에서 class → 순수 함수 전환 결정됨.

#### 분해 구조

```typescript
// builder/flattener.ts — 모든 export는 순수 함수

/** 메인 진입점. Node trie → BinaryRouterLayout 변환. */
export function flatten(
  root: Node,
  methodCodes?: ReadonlyMap<string, number>,
): BinaryRouterLayout;

// ── 내부 헬퍼 (export 안 함) ──

interface FlattenContext {
  nodes: Node[];
  nodeToIndex: Map<Node, number>;
  nodeBuffer: number[];           // Phase 4-3에서 pre-allocated TypedArray로 교체
  staticChildrenList: number[];
  paramChildrenList: number[];
  paramsList: number[];
  methodsList: number[];
  stringMap: Map<string, number>;
  stringList: string[];
  patternMap: Map<string, number>;
  patterns: SerializedPattern[];
}

/** BFS로 노드 순서 결정 + nodeToIndex 맵 생성. */
function collectNodes(root: Node): { nodes: Node[]; nodeToIndex: Map<Node, number> };

/** 단일 노드를 바이너리 레이아웃으로 변환. */
function flattenNode(
  node: Node, index: number, ctx: FlattenContext,
  methodCodes?: ReadonlyMap<string, number>,
): void;

/** 정적 자식 노드들을 staticChildrenList에 기록. */
function flattenStaticChildren(node: Node, base: number, ctx: FlattenContext): void;

/** 파라미터 자식 노드들을 paramChildrenList에 기록. */
function flattenParamChildren(node: Node, base: number, ctx: FlattenContext): void;

/** 메서드 엔트리들을 methodsList에 기록. */
function flattenMethods(
  node: Node, base: number, ctx: FlattenContext,
  methodCodes?: ReadonlyMap<string, number>,
): void;

/** 문자열 테이블 직렬화 (stringList → Uint8Array + offsets). */
function buildStringTable(stringList: string[]): {
  stringTable: Uint8Array;
  stringOffsets: Uint32Array;
};
```

#### 작업 순서

1. Phase 2-8 (class → 함수) 먼저 수행 — `Flattener.flatten()` → `export function flatten()`
2. 서브 함수 추출: `collectNodes()`, `flattenNode()`, `flattenStaticChildren()` 등
3. Phase 4-3 (TypedArray 사전 할당)과 연계 — `FlattenContext`의 `number[]`를 `Uint32Array`로 교체
4. Phase 4-6 (BFS `queue.shift()` 제거) → `collectNodes()`에서 index 기반 순회

### 3-5. `static-child-map.ts` 정리 (356줄) 〔Sonnet〕

- **파일**: `builder/static-child-map.ts`
- **현상**: 이터레이터/프로모션 로직이 파일의 절반 이상. inline (Map<string, Node> 2개) → sorted array 프로모션 전략.

#### 분석 결과

StaticChildMap은 small map 최적화 구현으로, flattener가 `entries()` 이터레이터를 사용함. 이터레이터 자체는 필요하지만, 파일 길이가 목표(300줄) 초과.

#### 조치

1. **프로모션 임계값 상수** (`PROMOTE_THRESHOLD`)를 `builder/constants.ts`로 이동.
2. **이터레이터 로직** 분리 불필요 — `[Symbol.iterator]`는 Map 위임이므로 코드 자체는 짧음. 실제 길이 원인은 `inline → entries migration` 로직.
3. **목표**: 주석/빈 줄 정리로 300줄 이하 달성. 구조 변경은 불필요.
4. 정리 후에도 300줄 초과 시: `StaticChildMapBuilder` (생성용)와 `StaticChildMap` (읽기용)으로 **분리 수행**.
   - `src/builder/static-child-map.ts` — 읽기 전용 (`get`, `size`, `[Symbol.iterator]`)
   - `src/builder/static-child-map-builder.ts` — 생성/변환 (`set`, promotion 로직)

### 3-6. `{ ...cached.params }` spread 제거 (3-1에 통합)

> **이 항목은 3-1의 `writeCacheEntry()` 구현에서 해결됨.**

- **방법**: 캐시 write 시 `Object.freeze({ ...params })`로 저장. 캐시 read 시 frozen 객체를 그대로 반환.
- **효과**: 캐시 hit 경로에서 매 요청마다 발생하던 O(n) 객체 spread 제거.
- **사용자 영향**: 반환된 `params`는 immutable. `params.foo = 'bar'` 시도 시 strict mode에서 TypeError. 이는 의도된 동작이며 문서화 필요.

### 3-7. 정적 라우트 이중 저장 제거 〔Opus〕

- **파일**: `router.ts` L381-L408 (`addOne()` 메서드)
- **현상**: `addOne()`에서 정적 라우트를 `staticMap`과 `builder.add()` (→ trie) **양쪽에 등록**. build() 후 정적 라우트는 staticMap으로만 매칭하므로 trie 내 정적 라우트 데이터는 dead.

#### 영향 분석

정적 라우트도 `builder.add()`를 호출하는 이유:
1. **충돌 검사**: `builder.addSegments()` 내부에서 static-param-wildcard 간의 구조적 충돌을 감지함.
2. 이 경로를 제거하면 충돌 검사가 사라짐 → 버그 가능성.

#### 조치 (2단계 접근)

1. **1단계 (안전)**: `builder.add()` 호출은 유지하되, builder의 `registerRoute()` (handler 등록)에서 정적 라우트 handler를 **등록하지 않음**. 이렇게 하면 trie에 노드 구조만 존재하고 handler 데이터는 없음 → 메모리 절약은 제한적이지만 충돌 검사 유지.
   ```typescript
   // addOne() 수정:
   if (!isDynamic) {
     values[offsetResult] = value;
     // builder에는 충돌 검사용으로만 추가 (handler 없이)
     this.builder!.addForValidation(method, segments);
   } else {
     this.builder!.add(method, segments, value);
   }
   ```
2. **2단계 (최적화, optional)**: build() 시점에 flattener가 handler 없는 정적 노드를 TypedArray에 포함하지 않도록 최적화. 이 단계는 측정 가능한 메모리 이득이 확인된 후에만 수행.

#### Builder 변경

```typescript
// builder/builder.ts — 신규 메서드
addForValidation(method: HttpMethod, segments: string[]): Result<void, RouterErrData> {
  // add()와 동일하지만 handlers.push(handler) 없이 handlerIndex = -1 전달
  return this.addSegments(this.root, 0, new Set(), [], method, -1, segments);
}
```

`registerRoute()`에서 `key === -1`인 경우 `node.methods.byMethod.set(method, key)` 수행하되, handler 배열에는 아무것도 추가하지 않음.

#### 의존 관계

- **선행**: Phase 3-1 (match() 분해 완료 후 matchStatic() 동작 확인)
- builder.add() + addForValidation()의 공존을 테스트로 검증 필요

---

## Phase 4: 성능 최적화

벤치마크 기반으로 측정 가능한 개선. 모든 최적화는 적용 전후 벤치마크 비교 필수.

### 4-1. `buildMatchFunction()` — 사전 컴파일 매칭 함수 〔Opus〕

- **파일**: 신규 `matcher/compiled-matcher.ts`, 수정 `router.ts`
- **현상**: `walk()`이 매번 TypedArray 오프셋 계산 + 조건 분기(정적? 파라미터? 와일드카드?) 수행.
- **기대 효과**: param 매칭 ~700ns → ~300-400ns 목표.

#### 접근 방식: 클로저 트리 (new Function 사용 안 함)

`new Function()`/`eval()`은 CSP 환경에서 차단되므로, **클로저 트리** 방식 채택.

```typescript
// matcher/compiled-matcher.ts

/** 컴파일된 매칭 함수 타입 */
type CompiledMatchFn = (
  segments: string[],
  methodCode: number,
  decode: DecoderFn,
  segmentHints: Uint8Array | undefined,
  decodeParams: boolean,
) => Result<{ handlerIndex: number; params: RouteParams } | null, RouterErrData>;

/**
 * build() 시점에 호출. BinaryRouterLayout을 분석하여 클로저 트리 생성.
 *
 * 각 trie 노드가 하나의 클로저가 됨:
 * - 정적 자식 → if/else 체인 (segment 문자열 비교)
 * - 파라미터 자식 → 패턴 테스터 호출 + 재귀
 * - 와일드카드 → suffix 계산 + 반환
 *
 * TypedArray 오프셋 계산이 build 시점에 resolve되므로 런타임에는 불필요.
 */
export function buildMatchFunction(
  layout: BinaryRouterLayout,
  patternTesters: ReadonlyArray<PatternTesterFn | undefined>,
  decode: DecoderFn,
): CompiledMatchFn;
```

#### 클로저 구조 예시

라우트 등록: `GET /users`, `GET /users/:id`, `GET /posts`

```typescript
// buildMatchFunction() 내부에서 생성되는 클로저 (개념):
function compiledMatch(segments, methodCode, decode, hints, decodeP) {
  if (segments.length === 0) return null;
  const s0 = segments[0];

  if (s0 === 'users') {
    if (segments.length === 1) {
      // 터미널: method 0 → handler 0
      if (methodCode === 0) return { handlerIndex: 0, params: {} };
      return null;
    }
    if (segments.length === 2) {
      // param :id — 디코딩 + 반환
      let v = segments[1];
      if (decodeP && hints?.[1]) { /* decode */ }
      if (methodCode === 0) return { handlerIndex: 1, params: { id: v } };
      return null;
    }
    return null;
  }

  if (s0 === 'posts') {
    if (segments.length === 1) {
      if (methodCode === 2) return { handlerIndex: 2, params: {} };
      return null;
    }
    return null;
  }

  return null;
}
```

#### 통합 방식

```typescript
// router.ts — build() 내부:
build(): this {
  // ... 기존 로직 ...
  this.matcher = new Matcher(layout, matcherConfig);

  // 컴파일된 매처 생성 (Matcher와 공존)
  this.compiledMatch = buildMatchFunction(layout, testers, decoder);

  this.builder = null;
  return this;
}

// match() 내부 — 동적 매칭 단계:
// this.compiledMatch()을 우선 사용. fallback으로 this.matcher.match() 유지.
```

#### 제약 및 결정 사항

- **적용 범위**: 라우트 수 ≤ 500일 때만 컴파일 함수 생성 (초기 추정치). build() 시점에 **클로저 생성 시간 + heap 증가분**을 벤치마크로 측정하여 임계값 조정. 측정 기준: 클로저 트리의 heap 증가분이 기존 Matcher 대비 2배 이하일 것.
- **임계값**: `RouterOptions.compiledMatchThreshold?: number` (기본 500).
- **벤치마크 게이트**: 컴파일 매칭이 기존 Matcher 대비 **20% 이상** 빠르지 않으면 머지하지 않음.
- **기존 Matcher 유지**: 항상 fallback으로 존재. 컴파일 매처가 없는 환경에서도 동작 보장.

### 4-2. `buildNormalizer()` — 사전 컴파일 정규화 함수 〔Opus〕

- **파일**: `processor/processor.ts`
- **현상**: `PipelineStep[]` 배열을 순회하며 간접 호출. `fastNormalize`에서 매번 `new Uint8Array` 할당.
- **기대 효과**: 정규화 비용 ~40-50% 감소.

#### 구현 전략

```typescript
// processor/processor.ts

/**
 * build() 시점에 호출. 활성화된 step만 인라인한 단일 정규화 함수 생성.
 * PipelineStep[] 순회 + 간접 호출 오버헤드 제거.
 */
buildNormalizer(): (path: string) => Result<NormalizedPathSegments, RouterErrData> {
  const collapseSlashes = this.config.collapseSlashes;
  const ignoreTrailingSlash = this.config.ignoreTrailingSlash;
  const blockTraversal = this.config.blockTraversal;
  const caseSensitive = this.config.caseSensitive;
  const maxSegLen = this.config.maxSegmentLength ?? 256;
  const bufferPool = new Uint8ArrayPool(4096); // 4-4 pooling

  return (path: string) => {
    // 1. isCleanPath() 인라인 (4-7 이중 스캔 제거)
    // 2. clean path → fastNormalize (pooled buffer)
    // 3. dirty path → 각 step 직접 호출 (배열 순회 없이 if/else)
    if (collapseSlashes) { /* collapse 로직 */ }
    if (blockTraversal) { /* dot segment 로직 */ }
    if (!caseSensitive) { /* toLowerCase */ }
    // ...
  };
}
```

#### Uint8Array 풀링 설계 (4-4 통합)

```typescript
// processor/buffer-pool.ts (신규)
export class Uint8ArrayPool {
  private readonly pool: Uint8Array[] = [];
  private readonly maxSize: number;

  constructor(maxSize: number = 8) {
    this.maxSize = maxSize;
  }

  /** len 이상 크기의 버퍼 반환. 없으면 새로 할당. */
  acquire(len: number): Uint8Array {
    for (let i = this.pool.length - 1; i >= 0; i--) {
      if (this.pool[i]!.length >= len) {
        return this.pool.splice(i, 1)[0]!;
      }
    }
    return new Uint8Array(len);
  }

  /** 사용 완료된 버퍼를 풀에 반환. */
  release(buf: Uint8Array): void {
    if (this.pool.length < this.maxSize) {
      this.pool.push(buf);
    }
  }
}
```

#### 의존 관계

- **선행**: Phase 3-1 (match() 분해) — `preNormalize()`와의 통합 경계 확정.
- **흡수**: Phase 4-4 (Uint8Array 재사용) — `buildNormalizer()` 내부에서 pooling 구현.
- **흡수**: Phase 4-7 (이중 스캔 제거) — `buildNormalizer()` 내부에서 isCleanPath + preNormalize 통합.

#### Router 통합 — Processor 인스턴스 해제

`buildNormalizer()` 구현 후 Router에서 Processor 인스턴스를 null로 해제한다. `builder → null` 패턴과 동일.

```typescript
// router.ts — build() 내부:
build(): this {
  // ... 기존 로직 ...

  // 정규화 함수 사전 컴파일 — Processor 파이프라인을 단일 클로저로 변환
  this.normalizer = this.processor.buildNormalizer();
  this.processor = null; // Processor 인스턴스 해제 — builder→null과 동일 패턴

  this.builder = null;
  return this;
}

// match() 내부:
// this.processor.normalize(searchPath) → this.normalizer(searchPath)
```

Router 필드 변경:
```typescript
private readonly processor: Processor;     // 삭제
private processor: Processor | null;        // 변경 (build 후 null)
private normalizer: ((path: string) => Result<NormalizedPathSegments, RouterErrData>) | null = null;
```

**주의**: `addOne()`에서도 `this.processor.normalize(path, false)`를 호출하므로, `addOne()`은 build() 전에만 호출됨. `addOne()` 진입 시 `!this.sealed` 가드가 이미 존재하므로 `this.processor`가 null인 경로는 도달 불가 (**런타임 sealed 검사로 방어**). non-null assertion(`!`) 사용 시 주석으로 sealed 가드 의존을 기록.

### 4-3. Flattener TypedArray 사전 할당 〔Sonnet〕

- **파일**: `builder/flattener.ts`
- **현상**: `number[]` → push → `Uint32Array.from()`. 중간 JS 배열이 불필요.
- **기대 효과**: build 시간 감소 (large route set에서 유의미).

#### 구현 전략: 2-pass 접근

```typescript
// Pass 1: 크기 계산 (BFS로 노드 방문, 노드 수/정적자식 수/파라미터 수/메서드 수 카운트)
const sizes = calculateBufferSizes(root); // { nodes, staticChildren, paramChildren, params, methods }

// Pass 2: 사전 할당된 TypedArray에 직접 write
const nodeBuffer = new Uint32Array(sizes.nodes * NODE_STRIDE);
const staticChildrenBuffer = new Uint32Array(sizes.staticChildren * 2);
// ... 각 버퍼에 offset 기반 직접 write

// Uint32Array.from() 제거
```

#### `calculateBufferSizes()` 시그니처

```typescript
interface BufferSizes {
  nodeCount: number;
  staticChildEntries: number; // segment+nodeIdx 쌍의 수
  paramChildEntries: number;
  paramEntries: number;       // PARAM_ENTRY_STRIDE 단위
  methodEntries: number;      // code+key 쌍의 수 + 1 (sentinel)
  stringCount: number;
}

function calculateBufferSizes(root: Node): BufferSizes;
```

#### 의존 관계

- **선행**: Phase 3-4 (flattener 서브 함수 분해) — 분해된 구조에서 2-pass 적용.
- **선행**: Phase 4-6 (BFS shift 제거) — calculateBufferSizes()도 동일 BFS 사용.

### 4-4. `fastNormalize` Uint8Array 재사용 (4-2에 통합)

> **이 항목은 4-2의 `buildNormalizer()` 내부 `Uint8ArrayPool`에서 해결됨.**
> `buildNormalizer()`가 구현되면 자연 해결. 독립 작업으로도 가능하지만 4-2와 함께 수행이 효율적.
> 단독 수행 시: `Processor` constructor에서 `this.buffer = new Uint8Array(8192)` 할당 → `fastNormalize()`에서 재사용.

### 4-5. `match()` 내 methodCode 중복 계산 제거

- **파일**: `router.ts`
- **현상**: `this.methodCodes.get(method) ?? METHOD_OFFSET[method]` 패턴이 match() 내에서 **4회** 반복.

#### 조치

이 항목은 Phase 3-1의 `match()` 분해에서 **자동 해결됨**.
- `resolveMethodCode()`가 match() 진입 시 1회만 호출.
- 이후 모든 내부 메서드(`matchStatic`, `lookupCache`, `writeCacheEntry`)는 `methodCode` 파라미터를 받음.
- Phase 2-2 (`METHOD_OFFSET` fallback 제거) 적용 후 `resolveMethodCode()`는 `this.methodCodes.get(method)` 1줄.

### 4-6. Flattener BFS `queue.shift()` → O(n) index 순회 〔Sonnet〕

- **파일**: `builder/flattener.ts` L37
- **현상**: `queue.shift()`는 Array 전체를 한 칸씩 이동 → O(n). n개 노드 BFS 시 O(n²).

#### 조치

```typescript
// Before:
while (queue.length) {
  const node = queue.shift(); // O(n) per call
  // ...
}

// After:
let head = 0;
while (head < queue.length) {
  const node = queue[head++]; // O(1) per call
  // ...
}
```

- Phase 3-4의 `collectNodes()`에서 적용.
- 라우트 수 1000개 이상에서 빌드 시간에 유의미한 차이 발생.

### 4-7. `isCleanPath()` + match() 진입 전처리 이중 스캔 (4-2에 통합)

> **이 항목은 4-2의 `buildNormalizer()` 내부에서 해결됨.**
> 현재: match() 진입부에서 trailing slash/toLowerCase 1회 스캔 → Processor.isCleanPath()에서 전체 경로 1회 재스캔.
> `buildNormalizer()` 내부에서 preNormalize 로직과 clean path 검사를 **단일 pass**로 통합.
> 독립 수행 시: `isCleanPath()`에 `alreadyPreNormalized: boolean` 파라미터 추가하여 trailing slash/case 검사 skip.

### 4-8. `staticMap`의 `T[]` sparse array 위험 〔Sonnet〕

- **파일**: `router.ts` L394
- **현상**: `values[offsetResult] = value`. 커스텀 메서드의 offset이 7+이면 배열이 sparse.

#### 조치

```typescript
// Before:
private staticMap: Map<string, T[]> = new Map();
// values[offsetResult] = value;  // sparse array 가능

// After (Option A: Map 사용):
private staticMap: Map<string, Map<number, T>> = new Map();
// values.set(offsetResult, value);  // 항상 dense

// After (Option B: 배열 크기 고정, 권장):
// addOne() 시점에 values 배열을 methodRegistry.size 크기로 초기화.
// build() 후 methodRegistry가 확정되면 문제 없음.
// 단, addOne()은 build() 전에 호출되므로, 메서드 등록 시점에 배열 확장 필요.
```

- **권장**: Option A (`Map<number, T>`). 코드가 명확하고, 메서드 수가 7-10개 수준이므로 Map 오버헤드 무시 가능.
- `matchStatic()` 수정: `values.get(methodCode)` 사용.

### 4-9. match() 내 `this.options.*` 접근 — build() 시점 resolve 〔Sonnet〕

- **파일**: `router.ts`
- **현상**: match() 호출마다 `this.options.ignoreTrailingSlash` (L210), `this.options.caseSensitive` (L214), `this.options.decodeParams` (L327)를 프로퍼티 체인으로 접근. `this.options`는 사용자 전달 객체이므로 V8 hidden class가 불안정할 수 있으며, 매 호출마다 indirection 발생.
- **기대 효과**: match() hot path에서 프로퍼티 접근 3회 → readonly 필드 직접 접근. IC 안정화 + 미세 성능 개선.

#### 조치

build() 시점에 match()가 사용하는 options 값들을 readonly 필드로 추출.

```typescript
// router.ts — 필드 추가:
private _ignoreTrailingSlash = true;   // build()에서 설정
private _caseSensitive = true;          // build()에서 설정
private _decodeParams = true;           // build()에서 설정

// build() 내부:
build(): this {
  // ... 기존 로직 ...

  // match() hot path용 options resolve (IC 안정화)
  this._ignoreTrailingSlash = this.options.ignoreTrailingSlash ?? true;
  this._caseSensitive = this.options.caseSensitive ?? true;
  this._decodeParams = this.options.decodeParams ?? true;

  // ...
}

// match() 내부 — 변경 전:
if (this.options.ignoreTrailingSlash === true && searchPath.length > 1 && searchPath.endsWith('/')) {
// 변경 후:
if (this._ignoreTrailingSlash && searchPath.length > 1 && searchPath.endsWith('/')) {

// 변경 전:
if (this.options.caseSensitive === false) {
// 변경 후:
if (!this._caseSensitive) {

// 변경 전:
this.options.decodeParams ?? true,
// 변경 후:
this._decodeParams,
```

#### 의존 관계

- **선행**: Phase 3-1 (match() 분해) — `preNormalize()` 내부에서 `this._ignoreTrailingSlash`/`this._caseSensitive` 사용.
- **병행 가능**: Phase 4-2 (buildNormalizer) — normalizer 클로저 내에서도 동일 값 사용.

---

## Phase 5: 보안

### 5-1. `maxPathLength` 옵션 추가 〔Sonnet〕

- **파일**: `types.ts`, `router.ts`
- **현상**: 경로 길이 제한 없음. 악의적으로 긴 URL이 normalize + match 파이프라인 전체를 통과.
- **조치**: `RouterOptions.maxPathLength` (기본값 2048) 추가. `match()` 진입 시 즉시 체크, 초과 시 `Err(PATH_TOO_LONG)`.

---

## Phase 6: 단위 테스트

현재 spec 파일 1개(`method-registry.spec.ts`), 통합 테스트 5개(`test/*.test.ts`). 소스 파일 ~20개에 대한 단위 테스트가 전면 부족.

> **참고**: 각 spec 작성 시 `test-standards.md`의 TST-OVERFLOW → TST-PRUNE 게이트를 반드시 수행.
> 아래는 각 파일별 **핵심 테스트 영역과 대표 시나리오**를 사전 정의한 것으로,
> OVERFLOW의 입력 자료로 사용. OVERFLOW 결과가 아래와 다를 수 있으며, 그 경우 OVERFLOW를 따름.

### 6-1. 기존 spec 파일 품질 확인 〔Sonnet〕

| 파일 | 상태 | 조치 |
|------|------|------|
| `method-registry.spec.ts` (424줄, 33 it) | ✅ 존재 | 커버리지 측정 후 부족분 보강 |
| `assert.spec.ts` | ✅ 존재 | 커버리지 측정 후 부족분 보강 |

### 6-2. 신규 spec 파일 상세 계획

#### 🔴 높음 우선순위

##### `cache.spec.ts` — RouterCache 〔Sonnet〕

| describe | 대표 시나리오 |
|----------|---------------|
| `get()` | miss → undefined, hit → value, null 값 저장/반환, evict 후 miss |
| `set()` | 신규 삽입, 동일 key 덮어쓰기 (값 변경 확인), maxSize 도달 전 삽입 |
| `evict()` | clock-sweep hand 이동 확인, used=true → false 전환 후 다음 sweep에 제거, 전원 used=true일 때 한 바퀴 돌고 제거 |
| `clear()` | clear 후 이전 key get → undefined, count=0, 재삽입 정상 작동 |
| Edge | maxSize=1 (삽입→즉시 evict), maxSize=2 (교대 evict 패턴), 빈 문자열 key |
| Idempotency | 동일 key/value 반복 set → 상태 불변, get n회 연속 → 동일 결과 |

##### `router.spec.ts` — Router\<T\> 〔Opus〕

| describe | 대표 시나리오 |
|----------|---------------|
| `add()` | sealed 후 add → Err('router-sealed'), 배열 메서드 등록, '*' 메서드 확장 |
| `addAll()` | 빈 배열, 중간 실패 시 registeredCount, sealed 후 호출 |
| `build()` | 이중 build → 동일 인스턴스 반환, build 후 builder null 확인 |
| `match()` — static | 정확 매칭, 대소문자 옵션, trailing slash 옵션 |
| `match()` — cache | 캐시 hit 반환, 404 부정 캐시, 캐시 비활성화 시 미사용 |
| `match()` — dynamic | param 1개, param 3개, wildcard, regex param |
| `match()` — error | build 전 match → Err('not-built'), normalize 실패 전파 |
| State transition | add→build→match→add 시도→Err |

##### `matcher/matcher.spec.ts` — Matcher 〔Opus〕

> Matcher는 BinaryRouterLayout을 직접 생성하여 테스트. Builder/Flattener를 통하지 않고 layout를 수동 구성하거나, Builder+Flattener를 fixture로 사용.

| describe | 대표 시나리오 |
|----------|---------------|
| `match()` | 정적 세그먼트 매칭, 등록되지 않은 method → false, unknown method → false |
| `walk()` — static | 1개 자식, 2개 자식 (linear), 6개+ 자식 (binary search), 미존재 자식 |
| `walk()` — param | regex 패턴 매칭, 패턴 불일치 → 다음 param으로 fallback |
| `walk()` — wildcard | suffix 계산 정확성, wildcardOrigin='star' + empty suffix → 미매칭, 'zero' + empty → 매칭 |
| `walk()` — backtrack | static 실패 → param 시도, param 실패 → wildcard 시도, 전체 실패 → null |
| `walk()` — error | regex-timeout: 의도적으로 느린 regex + 타임아웃 설정 → Err('regex-timeout') |
| `decodeAndCache()` | hints=0 → raw 반환, hints=1 → decode, 캐시 재사용 (paramCacheGen) |
| `getParams()` / `getHandlerIndex()` | match 후 올바른 값 반환, match 실패 후 이전 결과 잔류 없음 |

##### `builder/builder.spec.ts` — Builder\<T\> 〔Opus〕

| describe | 대표 시나리오 |
|----------|---------------|
| `add()` | static segment, param segment, wildcard segment, regex param |
| `addSegments()` — depth | depth=MAX_STACK_DEPTH → Err('segment-limit') (Phase 0-2 이후) |
| `addSegments()` — params | param 수=MAX_PARAMS → Err (Phase 0-2 이후) |
| `registerRoute()` | 동일 method+path 중복 → Err('route-duplicate') |
| `handleParam()` | optional '?', multi '+', zero-or-more '*', optional+zero → Err |
| `handleParam()` — regex | 닫히지 않은 중괄호 → Err('route-parse'), 빈 이름 → Err |
| `handleWildcard()` | 마지막 세그먼트 아님 → Err, 기존 static/param과 충돌 → Err |
| `handleStatic()` | wildcard 아래 static 추가 → Err('route-conflict') |
| `build()` | BinaryRouterLayout 반환 검증 (nodeBuffer 크기, rootIndex 등) |

#### 🟡 중간 우선순위

##### `builder/flattener.spec.ts` — flatten() 〔Sonnet〕

| describe | 대표 시나리오 |
|----------|---------------|
| `flatten()` | 빈 root (자식 없음), static 1개, param 1개, nested 구조 |
| nodeBuffer | 노드 수 × NODE_STRIDE 크기, meta 인코딩 정확성 (kind, paramCount, methodCount) |
| staticChildrenBuffer | 정렬 순서 확인, stringId 매핑 정확성 |
| methodsBuffer | method mask 비트 정확성, sorted entries |
| string table | 인코딩/디코딩 왕복 테스트, 중복 문자열 단일 ID |
| patterns | regex 직렬화 (source + flags), 중복 패턴 단일 ID |

##### `builder/node-operations.spec.ts` 〔Sonnet〕

| describe | 대표 시나리오 |
|----------|---------------|
| `matchStaticParts()` | 완전 일치, 부분 일치, 불일치, 빈 parts |
| `splitStaticChain()` | 중간 분할, 시작 분할 (splitIndex=0→no-op), 끝 분할 (splitIndex≥length→no-op) |
| `sortParamChildren()` | regex 있는 것 우선, regex 길이 내림차순, 동일 조건 → 알파벳 순 |

##### `builder/node-pool.spec.ts` — NodeFactory (1-7 이후) 〔Sonnet〕

| describe | 대표 시나리오 |
|----------|---------------|
| `acquire()` | Static/Param/Wildcard 각 kind 생성, segment 설정 확인 |
| 반환된 Node 상태 | 초기 상태 (빈 staticChildren, 빈 paramChildren 등) |

##### `builder/pattern-utils.spec.ts` — PatternUtils 〔Sonnet〕

| describe | 대표 시나리오 |
|----------|---------------|
| `normalizeParamPatternSource()` | 정상 패턴, anchor (^/$) 포함 시 정책별 동작 |
| `acquireCompiledPattern()` | 동일 source+flags → 캐시 hit, 다른 source → 새 RegExp |

##### `builder/regex-safety.spec.ts` — assessRegexSafety() 〔Sonnet〕

| describe | 대표 시나리오 |
|----------|---------------|
| 안전한 패턴 | `\\d+`, `[a-z]+`, `[^/]+` |
| 위험한 패턴 | `(a+)+`, `(a|a)*`, nested quantifier |
| maxLength 초과 | 256자 초과 패턴 → unsafe |
| backreference | `\\1` 포함 → unsafe (forbidBackreferences=true) |
| backtracking tokens | `{0,}` 중첩 → unsafe |

##### `builder/static-child-map.spec.ts` — StaticChildMap 〔Sonnet〕

| describe | 대표 시나리오 |
|----------|---------------|
| `get()` / `set()` | inline mode (1-2 entries), promoted mode (3+ entries) |
| `size` | 삽입/삭제 후 정확한 카운트 |
| promotion | 임계값 초과 시 Map 전환, 기존 항목 보존 |
| iterator | entries() 순서, delete 후 이터레이션 |
| `fromEntries()` | 빈 배열, 1개, 다수 |

##### `processor/processor.spec.ts` — Processor 〔Sonnet〕

| describe | 대표 시나리오 |
|----------|---------------|
| `normalize()` — clean path | `/users/123` → fast path, 올바른 segments/normalized |
| `normalize()` — dirty path | `//users/../admin` → pipeline 통과, 정규화된 결과 |
| `isCleanPath()` | double slash → false, dot segment → false, percent → false, uppercase (case-insensitive) → false, clean → true |
| `fastNormalize()` | trailing slash 처리, segment length 초과 → Err, 빈 경로 |
| pipeline steps | collapseSlashes on/off, blockTraversal on/off, caseSensitive on/off 조합 |
| config 조합 | 모든 옵션 off, 모든 옵션 on, 혼합 |

##### `processor/decoder.spec.ts` — buildDecoder() 〔Sonnet〕

| describe | 대표 시나리오 |
|----------|---------------|
| `decode` | 정상 %20 → ' ', 잘못된 %ZZ, %2F 처리 (decode/preserve/reject) |
| `encodedSlashBehavior` | 'decode' → /, 'preserve' → %2F 유지, 'reject' → Err |
| `failFastOnBadEncoding` | true + 잘못된 인코딩 → Err, false → raw 유지 |

##### `matcher/pattern-tester.spec.ts` — buildPatternTester() 〔Sonnet〕

| describe | 대표 시나리오 |
|----------|---------------|
| 매칭 성공 | regex에 맞는 값 → true |
| 매칭 실패 | regex에 안 맞는 값 → false |
| 빈 문자열 | '' 매칭 시 패턴에 따라 true/false |

##### `processor/steps/case-sensitivity.spec.ts` 〔Sonnet〕

| describe | 대표 시나리오 |
|----------|---------------|
| `toLowerCase()` | 대문자 포함 segments → 소문자 변환, 이미 소문자 → 무변경 |

##### `processor/steps/dot-segments.spec.ts` 〔Sonnet〕

| describe | 대표 시나리오 |
|----------|---------------|
| `resolveDotSegments()` | `.` 제거, `..` parent 이동, root 넘어서 `..` → 무시, 혼합 |

##### `processor/steps/slashes.spec.ts` 〔Sonnet〕

| describe | 대표 시나리오 |
|----------|---------------|
| `collapseSlashes()` | `//a///b` → `/a/b`, 선행/후행 슬래시 처리, 이미 clean 경로 → 무변경 |

##### `processor/steps/split.spec.ts` 〔Sonnet〕

| describe | 대표 시나리오 |
|----------|---------------|
| `splitPath()` | 빈 경로, 루트 `/`, 정상 분할, 빈 세그먼트 필터링 |

##### `processor/steps/strip-query.spec.ts` 〔Sonnet〕

| describe | 대표 시나리오 |
|----------|---------------|
| `stripQuery()` | `?` 위치별 동작, `#` fragment 처리, `?` 없는 경로 → 무변경 |

##### `processor/steps/validation.spec.ts` 〔Sonnet〕

| describe | 대표 시나리오 |
|----------|---------------|
| `validateSegments()` | maxSegmentLength 초과 → Err, 유효 세그먼트 → 통과, 빈 세그먼트 |

##### `processor/steps/remove-leading-slash.spec.ts` 〔Sonnet〕

| describe | 대표 시나리오 |
|----------|---------------|
| `removeLeadingSlash()` | 선행 슬래시 있는/없는 경우, 다중 선행 슬래시 |

#### 🟢 낮음 우선순위

##### `builder/optional-param-defaults.spec.ts` 〔Sonnet〕

| describe | 대표 시나리오 |
|----------|---------------|
| `record()` / `apply()` | omit → 키 없음, setUndefined → undefined, setEmptyString → '' |

##### `builder/constants.spec.ts` 〔Sonnet〕

> 상수 파일 — 값이 변경되면 다른 테스트에서 잡힘. spec 생략 가능.

##### `processor/context.spec.ts` 〔Sonnet〕

| describe | 대표 시나리오 |
|----------|---------------|
| `reset()` | segments 초기화, 경로 설정 확인 |

##### `matcher/constants.spec.ts` 〔Sonnet〕

> 상수 파일 — spec 생략 가능.

##### `schema.spec.ts` 〔Sonnet〕

> 상수/타입 파일 — spec 생략 가능. 단, `METHOD_OFFSET` 값이 MethodRegistry와 일치하는지 확인하는 1개 `it`은 유용.

### 6-3. 테스트 원칙

- **TST-OVERFLOW**: 테스트는 대상 모듈의 public API만 검증. 내부 구현 의존 금지.
- **TST-PRUNE**: 리팩터링 시 깨지는 internal-coupling 테스트는 삭제 후 재작성.
- **커버리지 목표**: 라인 80% 이상, 브랜치 70% 이상.
- **테스트 구조**: `describe` → `it` 계층. 각 `it`은 single assertion 원칙 지향.
- **Matcher 테스트 전략**: Matcher는 BinaryRouterLayout에 의존. Builder+Flattener를 통해 layout을 생성하는 **fixture factory** 패턴 사용.
  ```typescript
  // 테스트 헬퍼 예시
  function buildLayoutFor(routes: Array<[HttpMethod, string]>): {
    layout: BinaryRouterLayout;
    testers: PatternTesterFn[];
  } {
    const builder = new Builder(defaultConfig);
    for (const [m, p] of routes) builder.add(m, p.split('/').filter(Boolean), noop);
    return { layout: builder.build(), testers: [] };
  }
  ```
- **Builder 테스트 전략**: Builder는 Node trie를 직접 검사하지 않고, `build()` 결과인 BinaryRouterLayout의 구조를 검증하거나, `add()` 반환값(Err/Ok)을 검증.

### 6-4. 테스트 작업 순서

```
1. cache.spec.ts              — 외부 의존 없음, 즉시 작성 가능
2. builder/builder.spec.ts    — Phase 0-2, 0-3 완료 후 (depth/param 방어, assertDefined)
3. matcher/matcher.spec.ts    — builder.spec 이후 (fixture factory 재사용)
4. router.spec.ts             — builder + matcher spec 이후 (통합에 가까운 단위 테스트)
5. 나머지 🟡 우선순위         — 병행 가능
6. 🟢 낮음 우선순위           — 필요 시
7. property-based (6-5)     — 선택적, router.spec 이후
```

### 6-5. Property-Based 테스트 (선택) 〔Sonnet〕

라우터처럼 입력 공간이 넓은 모듈에서는 예시 기반 테스트만으로는 edge case를 놓칠 수 있음.

| 불변 속성 (invariant) | 검증 내용 |
|------|------|
| round-trip | 임의 경로 `add()` → `build()` → `match()` → 등록된 값 반환 |
| params 정확성 | `match()` 결과의 `params`가 경로에서 추출 가능한 값과 일치 |
| idempotency | 동일 경로 n회 연속 `match()` → 동일 결과 |
| no-crash | 임의 문자열 `match()` → throw 없이 Result 반환 |

- **도구**: `fast-check` 라이브러리 또는 수동 fuzzer
- **우선순위**: `router.spec` 이후, 보조적 테스트로 위치

---

## Phase 7: 벤치마크 확장

현재 벤치마크 시나리오에 누락된 케이스 추가.

### 7-1. Regex 파라미터 벤치마크 〔Sonnet〕

- **현상**: `/:id(\\d+)` 같은 regex constrained param 매칭 벤치마크 없음.
- **조치**: 기존 param 벤치마크 옆에 regex param 추가.

### 7-2. Optional 파라미터 벤치마크 〔Sonnet〕

- **현상**: `/:lang?/docs` 같은 optional param 매칭 벤치마크 없음.
- **조치**: optional param 있는/없는 경로 모두 측정.

### 7-3. Multi-method 벤치마크 〔Sonnet〕

- **현상**: 동일 경로에 GET/POST/PUT/DELETE 4개 method 등록 시 매칭 속도 미측정.
- **조치**: method별 분기 비용 측정.

### 7-4. `addAll` 대량 등록 벤치마크 〔Sonnet〕

- **현상**: 라우트 100/500/1000개 등록 + build 시간 미측정.
- **조치**: 라우트 수 별 addAll→build 시간 측정.

---

## 작업 순서 가이드

```
Phase 0 (Bug/Crash)       → 최우선. 0-1, 0-2, 0-3 순서대로 즉시 착수.
Phase 1 (Dead Code)       → Phase 0 이후. 1-1~1-7 의존성 없음, 병행 가능.
Phase 2 (Cleanup)         → Phase 1 이후 또는 병행. 2-2는 3-1의 선행.
Phase 5 (Security)        → 독립적. 언제든 가능.
Phase 6 (Tests)           → Phase 0-2 완료 후 착수. cache.spec → builder.spec → matcher.spec → router.spec 순.
Phase 3 (Architecture)    → Phase 6 기본 테스트 확보 후. 3-1(match 분해) → 3-2(builder 분할) → 3-3(walk 분해) → 3-4~3-7.
Phase 4 (Performance)     → Phase 3 이후. 4-6(BFS) → 4-3(TypedArray) → 4-8(sparse) → 4-9(options resolve) → 4-2(buildNormalizer) → 4-1(buildMatch).
Phase 7 (Benchmarks)      → Phase 4와 병행. 최적화 효과 측정.
```

### 항목 간 의존 관계 요약

```
0-1 → 2-4 (기본값 확정)
1-6 → 3-2 (strict 제거 후 validator 분리)
2-2 → 3-1, 4-5 (METHOD_OFFSET fallback 제거 후 match 분해)
2-3 → 3-1 (캐시 write 중복 제거 → writeCacheEntry)
2-7 → 3-2 (onWarn 콜백 후 validator에서 사용)
2-8 → 3-4 (class→함수 후 서브함수 분해)
3-1 → 3-6 (match 분해 시 params freeze 통합)
3-1 → 3-7 (match 분해 후 matchStatic 동작 확인)
3-1 → 4-8 (matchStatic 시그니쳐 변경 — Map<number, T> 전환)
3-4 → 4-3, 4-6 (flattener 분해 후 TypedArray/BFS 최적화)
3-1 → 4-7 (preNormalize 통합)
3-1 → 4-9 (match 분해 후 options resolve 적용)
4-9 → 4-2 (options resolve 후 buildNormalizer 클로저에서 동일 값 사용)
```

---

## 현재 벤치마크 기준값 (2025-02-25)

| 시나리오 | 시간 | 비고 |
|----------|------|------|
| Static match | ~70 ns | ✅ 우수 |
| Param match (1 param) | ~700 ns | 정규화 비용 포함 |
| Param match (3 params) | ~930 ns | 정규화 비용 포함 |
| Wildcard match | ~820 ns | |
| Cache hit | ~112 ns | ✅ 우수 |
| 404 (not found) | ~780 ns | |
| Full options | ~1.1 µs | 모든 옵션 활성화 |
| Build (100 routes) | ~1.2 ms | |

---

## 완료 조건

- [ ] Phase 0 완료: throw 0건 (`assertDefined`만 잔존), depth/param 방어 확인, collapseSlashes 버그 수정
- [ ] Phase 1-2 완료: dead code 0, `strictParamNames` 제거, lint clean, `onWarn` 콜백 동작
- [ ] Phase 3 완료: 모든 파일 300줄 이하, `match()` 40줄 이하, `walk()` 100줄 이하
- [ ] Phase 4 완료:
  - 4-1 채택 시: param match < 400ns
  - 4-1 미채택 시: param match < 550ns
  - 벤치마크 기준값 대비 모든 시나리오 개선, options IC resolve 확인, Processor null 해제 확인
- [ ] Phase 5 완료: maxPathLength 동작 확인
- [ ] Phase 6 완료: line coverage ≥ 80%, branch coverage ≥ 70%, spec 파일 20개 이상 (steps 5개 + property-based 포함)
- [ ] Phase 7 완료: 벤치마크 시나리오 12개 이상
- [ ] 전체 완성도 ≥ 95% (4-1 채택 여부에 따라 변동)
