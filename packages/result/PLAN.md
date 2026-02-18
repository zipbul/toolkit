# @zipbul/result 구현 계획

> **Status:** Draft
> **Spec Source:** `zipbul/zipbul/docs/30_SPEC/common/result.spec.md`
> **Spec ID:** COMMON-RESULT v1

---

## 0. 스펙 요약 (구현 근거)

### 0.1 타입 정의 (result.spec.md §3.2)

```ts
export type ZipbulError<E extends object = Record<string, never>> = {
  __zipbul_error__: true;
  stack: string;
  cause: unknown;
  data: E;
};

export type Result<T, E extends object = ZipbulError<Record<string, never>>> = T | E;
```

### 0.2 규칙 매핑

| Rule ID | 키워드 | 조건 | 강제 레벨 | 구현 위치 |
|---------|--------|------|-----------|-----------|
| COMMON-RESULT-R-001 | MUST | Result/ZipbulError contract은 기계적으로 검증 가능 | build | `types.ts` |
| COMMON-RESULT-R-002 | MUST | `isError(X)`는 `X.__zipbul_error__ === true`일 때만 true | runtime | `is-error.ts` |
| COMMON-RESULT-R-003 | MUST | `error` 헬퍼는 ZipbulError를 반환하고 절대 throw하지 않음 | runtime | `error.ts` |
| COMMON-RESULT-R-004 | MUST | cause는 입력값 X 그 자체; X가 Error이고 X.stack이 비어있지 않은 문자열이면 stack = X.stack, 아니면 생성 시점에서 캡처; Object.freeze 후 노출 | runtime | `error.ts` |
| COMMON-RESULT-R-005 | MUST NOT | `error` 헬퍼가 throw | runtime | `error.ts` |
| COMMON-RESULT-R-006 | MUST NOT | `isError` 헬퍼가 throw | runtime | `is-error.ts` |
| COMMON-RESULT-R-007 | MUST | 정적으로 관측 가능한 Success 객체 리터럴에 `__zipbul_error__ === true` 포함 시 진단 발생 | build | **본 패키지 범위 밖** (lint/정적분석 도구 책임) |

### 0.3 INVARIANTS.md 관련 제약

| 불변식 | 적용 |
|--------|------|
| Exclusive Bun | Bun 런타임만 지원. Node.js 호환 코드 없음 |
| No Runtime Reflection | reflect-metadata 등 런타임 타입 탐색 금지 |
| Result-First Domain Success | 도메인 실패는 throw가 아닌 Result로 표현 |

### 0.4 용어 (GLOSSARY.md)

| 용어 | 정의 |
|------|------|
| Error | 도메인 실패. Result 경로(값 흐름)로 처리 |
| Panic | throw로 표현되는 시스템 오류 |

---

## 1. 디렉토리 구조

```
packages/result/
├── PLAN.md               ← 본 문서
├── bunfig.toml           ← Bun 테스트 설정
├── package.json          ← @zipbul/result
├── tsconfig.json         ← ../../tsconfig.json 확장
├── index.ts              ← Public Facade (재수출만)
├── src/
│   ├── types.ts          ← ZipbulError<E>, Result<T,E> 타입 정의
│   ├── error.ts          ← error() 헬퍼 함수
│   ├── error.spec.ts     ← error() 유닛 테스트
│   ├── is-error.ts       ← isError() 타입 가드 함수
│   └── is-error.spec.ts  ← isError() 유닛 테스트
└── test/
    └── result.test.ts  ← 통합 테스트
```

### 1.1 파일별 역할

| 파일 | 역할 | export | spec 파일 필요 여부 |
|------|------|--------|---------------------|
| `types.ts` | 순수 타입 정의만 포함. 런타임 코드 없음 | `ZipbulError<E>`, `Result<T,E>` | 불필요 (TST-COVERAGE-MAP: types.ts 제외) |
| `error.ts` | `error()` 헬퍼 함수 1개만 export | `error` | `error.spec.ts` |
| `is-error.ts` | `isError()` 타입 가드 함수 1개만 export | `isError` | `is-error.spec.ts` |
| `index.ts` | 재수출 전용. 로직 없음 | 위 모든 export | 불필요 (TST-COVERAGE-MAP: index.ts 제외) |

---

## 2. 파일별 상세 구현 명세

### 2.1 `package.json`

```json
{
  "name": "@zipbul/result",
  "version": "0.0.1",
  "module": "index.ts",
  "type": "module",
  "scripts": {
    "coverage": "bun test --coverage"
  }
}
```

- 의존성: **없음** (순수 스탠드얼론 패키지)
- `@zipbul/shared` 불필요 — 공유 enum/상수를 사용하지 않음

### 2.2 `tsconfig.json`

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "paths": {
      "@zipbul/result": ["./index.ts"]
    }
  },
  "include": ["./**/*.ts"]
}
```

### 2.3 `bunfig.toml`

```toml
[test]
onlyFailures = true
coverageReporter = ["text", "lcov"]
coverageThreshold = 0.9
coveragePathIgnorePatterns = [
  "node_modules/**",
  "dist/**"
]

[test.reporter]
dots = true
```

### 2.4 `index.ts`

```ts
export { error } from './src/error';
export { isError } from './src/is-error';
export type { ZipbulError, Result } from './src/types';
```

- `export type` 사용 필수 — `verbatimModuleSyntax: true` 설정 때문
- 타입은 `export type`으로, 값은 `export`로 분리

### 2.5 `src/types.ts`

```ts
/**
 * zipbul 에러 마커 타입.
 * `__zipbul_error__: true`가 에러/성공 분기의 유일한 판별 기준이다.
 *
 * @template E - 에러에 첨부할 추가 데이터의 타입. 기본값은 빈 객체.
 */
export type ZipbulError<E extends object = Record<string, never>> = {
  __zipbul_error__: true;
  stack: string;
  cause: unknown;
  data: E;
};

/**
 * 성공(T) 또는 에러(E)를 표현하는 유니온 타입.
 * wrapper 클래스가 아닌 plain union으로, 런타임 오버헤드가 없다.
 *
 * @template T - 성공값 타입
 * @template E - 에러 타입. 기본값은 ZipbulError<Record<string, never>>
 */
export type Result<T, E extends object = ZipbulError<Record<string, never>>> = T | E;
```

**구현 제약:**
- 스펙 §3.2의 타입 정의를 **문자 그대로** 복사한다. readonly 추가하지 않는다.
- 런타임 코드(함수, 변수, 상수) 일절 없다.

### 2.6 `src/error.ts`

```ts
import type { ZipbulError } from './types';

/**
 * ZipbulError를 생성한다.
 * 절대 throw하지 않는다 (COMMON-RESULT-R-005).
 * 반환 전 Object.freeze를 적용한다 (COMMON-RESULT-R-004).
 *
 * @param cause - 에러의 원인. 타입 무관. 그대로 cause 필드에 저장.
 * @returns 동결(frozen)된 ZipbulError
 */
export function error(cause: unknown): ZipbulError;
/**
 * @param cause - 에러의 원인.
 * @param data - 에러에 첨부할 추가 데이터.
 * @returns 동결(frozen)된 ZipbulError<E>
 */
export function error<E extends object>(cause: unknown, data: E): ZipbulError<E>;
export function error<E extends object = Record<string, never>>(
  cause: unknown,
  data?: E,
): ZipbulError<E> {
  // ── 1. stack 결정 (R-004) ──
  // cause가 Error이고 stack이 비어있지 않은 문자열이면 그것을 사용.
  // 아니면 생성 시점의 스택을 캡처.
  // try-catch로 감싸서 hostile input(Proxy 등)에도 throw하지 않음 (R-005).
  let stack: string;
  try {
    if (
      cause instanceof Error &&
      typeof cause.stack === 'string' &&
      cause.stack.length > 0
    ) {
      stack = cause.stack;
    } else {
      stack = new Error().stack ?? '';
    }
  } catch {
    stack = new Error().stack ?? '';
  }

  // ── 2. ZipbulError 객체 생성 ──
  const zipbulError: ZipbulError<E> = {
    __zipbul_error__: true,
    stack,
    cause,
    data: (data ?? {}) as E,
  };

  // ── 3. 동결 후 반환 (R-004: freeze-before-expose) ──
  return Object.freeze(zipbulError) as ZipbulError<E>;
}
```

**구현 세부 결정 기록:**

| 결정 | 근거 |
|------|------|
| 오버로드 2개 + 구현 1개 | `error(cause)` → `ZipbulError`, `error(cause, data)` → `ZipbulError<E>` 타입 추론 정확도 |
| try-catch로 stack 결정 감쌈 | R-005 (throw 금지). Proxy 등 hostile cause의 `.stack` 접근이 throw할 수 있음 |
| `(data ?? {}) as E` | data 미제공 시 빈 객체. E의 기본값 `Record<string, never>`와 구조적으로 호환 |
| `Object.freeze() as ZipbulError<E>` | `Object.freeze`는 `Readonly<T>`를 반환하지만, 스펙 타입에 readonly 없으므로 캐스트 |
| `cause` 필드에 입력값 그대로 저장 | R-004: "cause is exactly X" — 복사/변환 없이 참조 저장 |

### 2.7 `src/is-error.ts`

```ts
import type { ZipbulError } from './types';

/**
 * 값이 ZipbulError인지 판별하는 타입 가드.
 * `__zipbul_error__ === true`인 경우에만 true를 반환한다 (COMMON-RESULT-R-002).
 * 절대 throw하지 않는다 (COMMON-RESULT-R-006).
 *
 * 주의: 제네릭 E는 런타임 검증 없이 타입 단언만 제공한다.
 * data의 구조는 호출자가 보장해야 한다.
 *
 * @param value - 판별 대상. 타입 무관.
 * @returns value가 ZipbulError이면 true
 */
export function isError<E extends object = Record<string, never>>(
  value: unknown,
): value is ZipbulError<E> {
  // try-catch로 감싸서 hostile input(Proxy 등)에도 throw하지 않음 (R-006).
  try {
    return (
      value !== null &&
      value !== undefined &&
      typeof value === 'object' &&
      (value as Record<string, unknown>).__zipbul_error__ === true
    );
  } catch {
    return false;
  }
}
```

**구현 세부 결정 기록:**

| 결정 | 근거 |
|------|------|
| null/undefined/typeof 사전 검사 | R-006 (throw 금지). `null.__zipbul_error__` 같은 접근을 방지 |
| `=== true` (strict equality) | R-002: "iff X.__zipbul_error__ === true". truthy가 아닌 정확히 `true`만 |
| try-catch 전체 래핑 | Proxy의 property access trap이 throw하는 경우 대비 |
| 제네릭 E는 런타임 무검증 | 런타임 리플렉션 금지 (INVARIANTS). 타입 단언만 제공, 구조 검증은 호출자 책임 |

---

## 3. 유닛 테스트 명세

### 3.1 `src/error.spec.ts` — SUT: `error`

테스트 러너: `bun:test`
describe 1-depth: `error`
BDD 형식: `should ... when ...`
AAA 패턴: Arrange → Act → Assert

**import 문:**
```ts
import { describe, expect, it } from 'bun:test';

import { error } from './error';
```

**describe 구조:**
```ts
describe('error', () => {
  describe('happy path', () => { /* A 시리즈 */ });
  describe('cause preservation', () => { /* B 시리즈 */ });
  describe('stack selection', () => { /* C 시리즈 */ });
  describe('freeze', () => { /* D 시리즈 */ });
  describe('marker', () => { /* E 시리즈 */ });
  describe('no-throw guarantee', () => { /* F 시리즈 */ });
});
```

**공용 fixture:**
```ts
// F-1에서 사용: hostile Proxy
const hostileProxy = new Proxy({}, {
  get() { throw new Error('proxy trap'); },
  has() { throw new Error('proxy trap'); },
});

// F-2에서 사용: stack getter가 throw하는 Error 서브클래스
// 주의: JSC(Bun)에서 Error 생성자가 own 'stack' property를 설정하면
// class getter가 shadow될 수 있다. 그 경우 아래 대안을 사용:
//   const e = new Error('x');
//   Object.defineProperty(e, 'stack', { get() { throw new Error('stack trap'); } });
class ThrowingStackError extends Error {
  get stack(): string { throw new Error('stack trap'); }
}
```

#### 카테고리별 테스트 케이스

##### A. Happy Path — 기본 생성 (R-003)

| # | it 제목 | 검증 내용 |
|---|---------|-----------|
| A-1 | `should return object with __zipbul_error__ true when cause is an Error` | `error(new Error('x'))` → `__zipbul_error__`가 `true` |
| A-2 | `should return object with __zipbul_error__ true when cause is a string` | `error('msg')` → `__zipbul_error__`가 `true` |
| A-3 | `should set data to provided object when data argument is given` | `error(x, { code: 'A' })` → `data.code === 'A'` |
| A-4 | `should set data to empty object when data argument is omitted` | `error(x)` → `data`가 `{}` (빈 객체) |

##### B. Cause 보존 (R-004: cause is exactly X)

| # | it 제목 | 검증 내용 |
|---|---------|-----------|
| B-1 | `should preserve Error instance as cause by reference` | `const e = new Error(); error(e).cause === e` |
| B-2 | `should preserve string as cause` | `error('hello').cause === 'hello'` |
| B-3 | `should preserve null as cause` | `error(null).cause === null` |
| B-4 | `should preserve undefined as cause` | `error(undefined).cause === undefined` |
| B-5 | `should preserve number as cause` | `error(42).cause === 42` |
| B-6 | `should preserve symbol as cause` | `const s = Symbol(); error(s).cause === s` |
| B-7 | `should preserve object as cause by reference` | `const o = {}; error(o).cause === o` |
| B-8 | `should preserve bigint as cause` | `error(42n).cause === 42n` |
| B-9 | `should preserve boolean as cause` | `error(false).cause === false` |

##### C. Stack 선택 (R-004: stack selection)

| # | it 제목 | 검증 내용 |
|---|---------|-----------|
| C-1 | `should use Error.stack when cause is Error with non-empty stack` | `const e = new Error('x'); error(e).stack === e.stack` |
| C-2 | `should capture new stack when cause is Error with empty string stack` | Arrange: `const e = new Error('x'); e.stack = '';` → `error(e).stack !== ''` && `typeof ... === 'string'` |
| C-3 | `should capture new stack when cause is Error with undefined stack` | Arrange: `const e = new Error('x'); Object.defineProperty(e, 'stack', { value: undefined });` → `typeof error(e).stack === 'string'` |
| C-4 | `should capture new stack when cause is a string` | `typeof error('x').stack === 'string'` && `error('x').stack.length > 0` |
| C-5 | `should capture new stack when cause is null` | `typeof error(null).stack === 'string'` |
| C-6 | `should capture new stack when cause is a plain object` | `typeof error({}).stack === 'string'` |
| C-7 | `should always return string type for stack` | 모든 cause 타입(Error, string, null, undefined, number, object)에 대해 `typeof .stack === 'string'` |

##### D. Freeze (R-004: freeze-before-expose)

| # | it 제목 | 검증 내용 |
|---|---------|-----------|
| D-1 | `should return a frozen object` | `Object.isFrozen(error(new Error('x'))) === true` |
| D-2 | `should throw TypeError when assigning to __zipbul_error__` | `expect(() => { (err as any).__zipbul_error__ = false; }).toThrow(TypeError)` (ESM = strict mode) |
| D-3 | `should throw TypeError when assigning to cause` | `expect(() => { (err as any).cause = null; }).toThrow(TypeError)` |
| D-4 | `should throw TypeError when assigning to stack` | `expect(() => { (err as any).stack = ''; }).toThrow(TypeError)` |
| D-5 | `should throw TypeError when assigning to data` | `expect(() => { (err as any).data = {}; }).toThrow(TypeError)` |
| D-6 | `should throw TypeError when adding new property` | `expect(() => { (err as any).newProp = 1; }).toThrow(TypeError)` |
| D-7 | `should not deep-freeze data object` | `const d = { x: 1 }; const e = error(null, d); d.x = 2; expect(e.data.x).toBe(2)` (shallow freeze) |

##### E. Marker 검증 (R-003)

| # | it 제목 | 검증 내용 |
|---|---------|-----------|
| E-1 | `should set __zipbul_error__ to exactly boolean true not truthy value` | `=== true` (not `1`, not `'true'`) |
| E-2 | `should have exactly four own properties` | `Object.keys().length === 4`, keys: `__zipbul_error__`, `stack`, `cause`, `data` |

##### F. No-throw 보장 (R-005)

> B 시리즈에서 null/undefined/primitive cause의 정상 반환을 검증하므로, throw 안 함도 암시적으로 보장된다.
> F 카테고리는 B에서 커버 불가능한 hostile 입력만 테스트한다.

| # | it 제목 | 검증 내용 |
|---|---------|----------|
| F-1 | `should not throw when cause is a Proxy that throws on property access` | 아래 Proxy fixture 사용. throw 없이 ZipbulError 반환 확인 |
| F-2 | `should not throw when cause is Error subclass with getter stack that throws` | 아래 ThrowingStackError fixture 사용. throw 없이 ZipbulError 반환, stack은 fallback 캡처 |

---

### 3.2 `src/is-error.spec.ts` — SUT: `isError`

테스트 러너: `bun:test`
describe 1-depth: `isError`

**import 문:**
```ts
import { describe, expect, it } from 'bun:test';

import { isError } from './is-error';
```

**describe 구조:**
```ts
describe('isError', () => {
  describe('true cases', () => { /* G 시리즈 */ });
  describe('false cases - primitives', () => { /* H 시리즈 */ });
  describe('false cases - objects', () => { /* I 시리즈 */ });
  describe('no-throw guarantee', () => { /* J 시리즈 */ });
  describe('idempotency', () => { /* K 시리즈 */ });
});
```

**공용 fixture:**
```ts
// J-1에서 사용: hostile Proxy
const hostileProxy = new Proxy({}, {
  get() { throw new Error('proxy trap'); },
  has() { throw new Error('proxy trap'); },
});
```

#### 카테고리별 테스트 케이스

##### G. True 반환 조건 (R-002: iff)

| # | it 제목 | 검증 내용 |
|---|---------|-----------|
| G-1 | `should return true when value is manually crafted object with __zipbul_error__ true` | `{ __zipbul_error__: true, stack: '', cause: null, data: {} }` |
| G-2 | `should return true when value is frozen object with __zipbul_error__ true` | `Object.freeze({ __zipbul_error__: true, stack: '', cause: null, data: {} })` |
| G-3 | `should return true when value has extra properties beyond ZipbulError shape` | `{ __zipbul_error__: true, stack: '', cause: null, data: {}, extra: 1 }` |

##### H. False 반환 조건 — 프리미티브 (R-002: iff의 역)

| # | it 제목 | 검증 내용 |
|---|---------|-----------|
| H-1 | `should return false when value is null` | `isError(null) === false` |
| H-2 | `should return false when value is undefined` | `isError(undefined) === false` |
| H-3 | `should return false when value is a string` | `isError('hello') === false` |
| H-4 | `should return false when value is a number` | `isError(42) === false` |
| H-5 | `should return false when value is a boolean true` | `isError(true) === false` |
| H-6 | `should return false when value is a boolean false` | `isError(false) === false` |
| H-7 | `should return false when value is a symbol` | `isError(Symbol()) === false` |
| H-8 | `should return false when value is a bigint` | `isError(42n) === false` |
| H-9 | `should return false when value is a function` | `isError(() => {}) === false` |

##### I. False 반환 조건 — 객체 (R-002: marker 불일치)

| # | it 제목 | 검증 내용 |
|---|---------|-----------|
| I-1 | `should return false when value is an empty object` | `isError({}) === false` |
| I-2 | `should return false when __zipbul_error__ is false` | `{ __zipbul_error__: false }` |
| I-3 | `should return false when __zipbul_error__ is string "true"` | `{ __zipbul_error__: 'true' }` |
| I-4 | `should return false when __zipbul_error__ is number 1` | `{ __zipbul_error__: 1 }` |
| I-5 | `should return false when __zipbul_error__ is null` | `{ __zipbul_error__: null }` |
| I-6 | `should return false when __zipbul_error__ is undefined` | `{ __zipbul_error__: undefined }` |
| I-7 | `should return false when value is an array` | `isError([]) === false` |
| I-8 | `should return false when value is a Date` | `isError(new Date()) === false` |
| I-9 | `should return false when value is a RegExp` | `isError(/abc/) === false` |
| I-10 | `should return false when value is a Map` | `isError(new Map()) === false` |
| I-11 | `should return false when value is an Error instance` | `isError(new Error()) === false` (Error에는 `__zipbul_error__` 없음) |
| I-12 | `should return false when value is Object.create(null)` | 프로토타입 없는 객체 |

##### J. No-throw 보장 (R-006)

> H 시리즈에서 프리미티브/null/undefined의 false 반환을 검증하므로, throw 안 함도 암시적으로 보장된다.
> J 카테고리는 H에서 커버 불가능한 hostile 입력만 테스트한다.

| # | it 제목 | 검증 내용 |
|---|---------|----------|
| J-1 | `should not throw when value is a Proxy that throws on property access` | 아래 Proxy fixture 사용. `expect(() => isError(proxy)).not.toThrow()` 그리고 반환값 `false` |

##### K. Idempotency

| # | it 제목 | 검증 내용 |
|---|---------|-----------|
| K-1 | `should return same result when called multiple times on same value` | N번 호출 → 동일 결과 |

---

## 4. 통합 테스트 명세

### 4.1 `test/result.test.ts`

테스트 러너: `bun:test`
SUT 경계: `error` + `isError` 모듈 조합
접근 수준: Public API만 (index.ts 경유)

**import 문:**
```ts
import { describe, expect, it } from 'bun:test';

import { error, isError } from '../index';
import type { Result, ZipbulError } from '../index';
```

**describe 구조:**
```ts
describe('result', () => {
  // INT-1 ~ INT-9
});
```

| # | it 제목 | 검증 내용 |
|---|---------|-----------|
| INT-1 | `should detect error created by error() using isError()` | `isError(error(new Error('x'))) === true` |
| INT-2 | `should not detect plain success value as error` | `isError('success') === false` |
| INT-3 | `should preserve cause through error creation and detection cycle` | `const e = new Error(); const r = error(e); isError(r) && r.cause === e` |
| INT-4 | `should preserve custom data through error creation and detection cycle` | `error(x, { code: 'A' })` → `isError()` → `.data.code === 'A'` |
| INT-5 | `should work with Error instance as cause end-to-end` | `const e = new Error(); error(e).stack === e.stack && isError(error(e))` |
| INT-6 | `should work with non-Error cause end-to-end` | `const r = error('msg'); isError(r) && r.cause === 'msg'` |
| INT-7 | `should produce same marker and cause for identical cause input` | `const e = new Error(); error(e).__zipbul_error__ === error(e).__zipbul_error__ && error(e).cause === error(e).cause` |
| INT-8 | `should handle multiple different error types in sequence` | 여러 타입의 error 연속 생성 → 각각 isError true |
| INT-9 | `should work with function returning Result type` | 아래 예시 패턴: `function f(): Result<string, ZipbulError> { ... }` → isError 분기 검증 |

---

## 5. 구현 순서 (워크플로우)

```
Step 1 ─ 스캐폴드      package.json, tsconfig.json, bunfig.toml, index.ts
                       → root에서 `bun install` 실행 (workspace symlink 생성)
Step 2 ─ 타입 + Stub   src/types.ts + src/error.ts (stub) + src/is-error.ts (stub)
Step 3 ─ 테스트 작성   src/error.spec.ts, src/is-error.spec.ts, test/result.test.ts
Step 4 ─ RED 확인      bun test → 전체 실패 확인 → [RED Checkpoint]
Step 5 ─ 구현          src/error.ts, src/is-error.ts (stub → 실제 구현으로 교체)
Step 6 ─ GREEN 확인    bun test → 전체 통과 확인 → [GREEN Checkpoint]
Step 7 ─ 커버리지      bun test --coverage → 100% 확인
Step 8 ─ 커밋          feat(result): implement Result pattern package
```

### 5.2 Step 2 Stub 파일 상세

Step 3(테스트 작성) 이전에, 테스트가 import 가능하도록 stub 파일을 생성한다.
stub은 시그니처만 갖고 본문에서 throw하여 RED 상태를 보장한다.

**`src/error.ts` (stub)**
```ts
import type { ZipbulError } from './types';

export function error(cause: unknown): ZipbulError;
export function error<E extends object>(cause: unknown, data: E): ZipbulError<E>;
export function error<E extends object = Record<string, never>>(
  cause: unknown,
  data?: E,
): ZipbulError<E> {
  throw new Error('Not implemented');
}
```

**`src/is-error.ts` (stub)**
```ts
import type { ZipbulError } from './types';

export function isError<E extends object = Record<string, never>>(
  value: unknown,
): value is ZipbulError<E> {
  throw new Error('Not implemented');
}
```

stub은 Step 5에서 실제 구현(§2.6, §2.7)으로 **파일 전체를 교체**한다.

### 5.3 워크플로우 게이트 체인

```
OVERFLOW → PRUNE → RED → GREEN
```

- **Step 3 이전:** TST-OVERFLOW → TST-PRUNE 수행 (§3, §4의 테스트 목록이 PRUNE 후 최종 목록)
- **Step 4:** `[RED Checkpoint]` 블록 출력 필수. 없으면 Step 5 진입 불가.
- **Step 6:** `[GREEN Checkpoint]` 블록 출력 필수. 없으면 커밋 불가.

---

## 6. 설계 결정 기록 (ADR)

### ADR-1: 타입에 readonly 추가하지 않음

- **결정:** 스펙 §3.2의 타입 정의 그대로 사용. `readonly` 키워드 없음.
- **근거:** 스펙이 readonly를 명시하지 않음. 런타임 immutability는 `Object.freeze`로 보장.
- **영향:** 컴파일 타임에 프로퍼티 재할당 경고 없음. freeze가 런타임 가드.

### ADR-2: error() 함수 오버로드

- **결정:** 오버로드 시그니처 2개 + 구현 시그니처 1개.
- **근거:** `error(cause)` 호출 시 `ZipbulError` (E = Record<string, never>), `error(cause, data)` 호출 시 `ZipbulError<E>` 추론. 오버로드 없이 단일 시그니처 사용 시 E 추론 불정확.
- **영향:** 호출자는 명시적 제네릭 없이도 정확한 타입 추론 가능.

### ADR-3: isError 제네릭 E는 런타임 미검증

- **결정:** `isError<E>(value)` 의 E는 타입 단언만 제공. data의 구조는 런타임에서 검증하지 않음.
- **근거:** INVARIANTS.md "No Runtime Reflection" — 런타임 타입 탐색 금지.
- **영향:** `isError<{ code: string }>(x)` 호출 시 `x.data.code`가 string임은 호출자가 보장해야 함.

### ADR-4: error()와 isError() 모두 try-catch 래핑

- **결정:** 핵심 로직을 try-catch로 감싸 어떤 입력에도 throw하지 않음.
- **근거:** R-005, R-006 (MUST NOT throw). Proxy input의 property access trap이 throw 가능.
- **영향:** 극히 예외적 입력(hostile Proxy)에서도 안전. 정상 경로 성능 영향 미미.

### ADR-5: data의 기본값

- **결정:** data 미제공 시 `(data ?? {}) as E`.
- **근거:** E의 기본값은 `Record<string, never>` (빈 객체). `{}`는 이와 구조적으로 호환.
- **영향:** `as E` 캐스트 사용. 타입 안전성은 오버로드 시그니처에서 보장 (data 미제공 시 E가 명확).

### ADR-6: R-007은 본 패키지 범위 밖

- **결정:** R-007 (Success 객체에 `__zipbul_error__: true` 포함 시 빌드 진단)은 구현하지 않음.
- **근거:** R-007은 `Enforced Level: build`이며, 정적 분석/lint 도구(firebat 등)의 책임.
- **영향:** 본 패키지는 런타임 헬퍼만 제공. 빌드 진단은 별도 도구에서 처리.

### ADR-7: shallow freeze만 적용

- **결정:** `Object.freeze`는 ZipbulError 객체 자체에만 적용. data 내부는 freeze하지 않음.
- **근거:** R-004 "the created ZipbulError is frozen" — ZipbulError 자체만 명시. deep freeze 언급 없음.
- **영향:** `err.data.prop = x`는 가능. `err.data = x`는 불가 (frozen). 이는 의도된 동작.

---

## 7. Public API 요약

```ts
// 타입
type ZipbulError<E extends object = Record<string, never>> = {
  __zipbul_error__: true;
  stack: string;
  cause: unknown;
  data: E;
};

type Result<T, E extends object = ZipbulError<Record<string, never>>> = T | E;

// 함수
function error(cause: unknown): ZipbulError;
function error<E extends object>(cause: unknown, data: E): ZipbulError<E>;

function isError<E extends object = Record<string, never>>(value: unknown): value is ZipbulError<E>;
```

**사용 예시:**

```ts
import { error, isError, type Result, type ZipbulError } from '@zipbul/result';

// 에러 생성
const err = error(new Error('not found'), { code: 'NOT_FOUND' });

// 타입 가드
if (isError(err)) {
  console.log(err.cause);  // Error: not found
  console.log(err.data);   // { code: 'NOT_FOUND' }
}

// Result 패턴
function findUser(id: string): Result<User, ZipbulError<{ code: string }>> {
  if (!id) return error(new Error('invalid id'), { code: 'INVALID' });
  return { id, name: 'Alice' };
}

const result = findUser('1');
if (isError(result)) {
  // result: ZipbulError<{ code: string }>
  console.log(result.data.code);
} else {
  // result: User
  console.log(result.name);
}
```

---

## 8. 체크리스트

구현 완료 시 모든 항목이 충족되어야 한다.

- [ ] `types.ts` — 스펙 §3.2와 문자 단위 일치
- [ ] `error()` — R-003, R-004, R-005 충족
- [ ] `isError()` — R-002, R-006 충족
- [ ] `Object.freeze` — 반환 전 적용 (R-004)
- [ ] try-catch — error(), isError() 모두 적용 (R-005, R-006)
- [ ] cause 참조 보존 — 복사/변환 없음 (R-004)
- [ ] stack 선택 로직 — Error + non-empty stack → 사용, 그 외 → 캡처 (R-004)
- [ ] 유닛 테스트 — error.spec.ts 전체 통과
- [ ] 유닛 테스트 — is-error.spec.ts 전체 통과
- [ ] 통합 테스트 — result.test.ts 전체 통과
- [ ] 커버리지 — ≥ 90% (bunfig.toml threshold)
- [ ] 외부 의존성 — 없음 (zero dependencies)
- [ ] Bun 전용 — Node.js 호환 코드 없음
