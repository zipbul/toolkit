# @zipbul/baker 구현 계획

> **Status:** Draft v6 (async 지원 + 코드 생성 안전성 강화)
> **Package:** `@zipbul/baker`
> **Location:** `packages/baker/`

---

## 0. 개요

### 0.1 한 줄 정의

**class-validator + class-transformer 호환 데코레이터 DX를 제공하되, reflect-metadata 없이 런타임 코드 생성(`new Function`)으로 AOT와 동급 성능을 달성하는 validate + transform 통합 패키지.**

### 0.2 설계 원칙

| 원칙 | 설명 |
|------|------|
| **Decorator DX** | class-validator/class-transformer 호환 데코레이터 표면. 학습 비용 최소 |
| **Legacy Decorators** | `experimentalDecorators: true`. TC39 Stage 3 데코레이터에는 파라미터 데코레이터가 미포함이며, 별도 파라미터 데코레이터 제안은 Stage 1 (2023-03~, 3년 정체). zipbul 프레임워크가 파라미터 데코레이터(@Body, @Query 등)를 필수로 사용하고, 같은 tsconfig에서 TC39과 Legacy를 동시 사용 불가하므로 프레임워크 전체 호환을 위해 Legacy 채택 |
| **No reflect-metadata** | reflect-metadata 의존 0. 글로벌 `Reflect` 오염 0. `emitDecoratorMetadata` 불필요 |
| **Symbol on Class** | 메타데이터를 Class 자체에 Symbol 프로퍼티로 직접 저장. 외부 저장소 0. 전역 레지스트리는 인덱스(어떤 클래스가 등록되었는지)로만 사용 |
| **Inline Code Generation** | `seal()` 시 `new Function()`으로 인라인 코드 생성 |
| **AOT Equivalence** | 런타임 seal ≡ AOT 빌드 출력. 실행 성능 차이 0 |
| **Fused Pipeline** | validate + transform = 1패스. 프로퍼티 1회 순회 |
| **Dual Mode** | AOT (zipbul CLI) + 독립 런타임 (seal). 둘 다 데코레이터 DX |
| **Throw on Error** | `deserialize()` 실패 시 `BakerValidationError` throw. `serialize()`는 무검증 전제. 두 함수 모두 항상 `async` — `deserialize()`: `Promise<T>`, `serialize()`: `Promise<Record<string, unknown>>` 반환. 내부 executor는 sync/async 자동 분기 (async 요소 없으면 sync function 생성). 내부 `_deserialize` executor만 Result 패턴 사용 (코드 생성 효율). `@zipbul/result`는 내부 의존으로만 사용, 외부 노출 0 |
| **Zero Dependencies** | validator.js 포함 외부 의존 0. 검증 로직 100% 직접 구현 (`@zipbul/result` 내부 사용 제외 — 모노레포 내부, 외부 미노출) |
| **Bun Exclusive** | Bun 런타임 전용 |
| **Strict Seal** | `seal()`은 전역 레지스트리의 모든 DTO를 봉인. Lazy 모드 없음. 미봉인 클래스 사용 시 `SealError` throw |

### 0.3 핵심 아키텍처 — 3-Tier

```
Tier 1: 수집 (Collect)         Tier 2: 봉인 (Seal)              Tier 3: 실행 (Execute)
클래스 정의 시 1회              앱 시작 시 1회                     매 요청
──────────────────────────────────────────────────────────────────────────────────
데코레이터 실행                 전역 레지스트리 순회               deserialize(Class, input)
→ Class[RAW]에                → 각 Class의 RAW 읽기             → Class[SEALED] executor 실행
  RawPropertyMeta 저장         → prototype chain 병합            → new Class() 인스턴스 생성
  (Symbol 직접 프로퍼티)        → .emit()으로 인라인 코드 생성    → 성공: T 반환
→ 전역 레지스트리에             → new Function() 컴파일           → 실패: throw BakerValidationError
  클래스 자동 등록              → Class[SEALED]에 dual executor
```

### 0.4 사용 모드

| 모드 | 대상 | Tier 2 수행 시점 | 데코레이터 |
|------|------|-----------------|-----------|
| **AOT** | zipbul CLI 사용자 | 빌드타임 (CLI가 코드 파일 생성) | `/stubs` (빈 스텁) |
| **독립 런타임** | 누구나 | 앱 시작 시 `seal()` 호출 (전체 봉인) | `Class[RAW]` 수집 |
| **헬퍼** | 누구나 | 없음 | 데코레이터 없이 rules 직접 사용 |

> **Lazy 모드 없음**: 미봉인 클래스에 `deserialize()` 호출 시 `SealError` throw. 반드시 앱 시작 시 `seal()`을 먼저 호출해야 한다.

### 0.5 class-validator/transformer 대비 성능 모델

```
class-validator + class-transformer (매 요청):
  plainToInstance() → Reflect.getMetadata() × 4/필드 → Map 순회 → validate() → 규칙 배열 순회
  = 2패스, 필드 2회 순회, Map lookup N회, 함수 호출 N회

baker (매 요청):
  deserialize(Class, input) → 인라인 코드 1패스 실행 → T 반환 or throw
```

**제거된 오버헤드:**

| 항목 | class-validator/transformer | baker |
|------|---------------------------|-------|
| 규칙 배열 순회 | O(N)/요청 | 0 (코드 생성 시 소멸) |
| 메타데이터 Map lookup | 4N/요청 | 0 (Symbol 직접 프로퍼티) |
| Reflect 전역 접근 | N/요청 | 0 |
| validator.js 함수 호출 | N/요청 | 0 (인라인) |
| strategy 런타임 분기 | N/요청 | 0 (ExposeAll 고정) |
| validate 별도 패스 | 1패스 추가 | 0 (fused) |

**명시적 예외 (0이 아닌 것):**

| 항목 | 발생 조건 | 비용 |
|------|----------|------|
| `@Transform` 사용자 함수 | `_refs[i](value)` 호출 | 함수 호출 1회/필드 |
| `@ValidateNested` + 배열 | for 루프 + 중첩 executor 호출 | O(배열길이) |
| `discriminator` | switch 분기 | O(subTypes 수) |
| `enableCircularCheck` | WeakSet has/add | O(1)/객체 |
| `groups` 런타임 체크 | indexOf | O(groups 수)/필드 |
| 알고리즘 고유 루프 | isCreditCard(Luhn) 등 | 알고리즘 고유 — 제거 불필요 |

---

## 1. 기능 범위

### 1.1 Validation (class-validator 대응)

class-validator **0.14.1** 기준으로 데코레이터를 1:1 대응한다.
개별 목록은 class-validator 소스를 직접 참조: [`src/decorator/decorators.ts`](https://github.com/typestack/class-validator/blob/v0.14.1/src/decorator/decorators.ts)

| 카테고리 | 예시 | 수량 |
|----------|------|------|
| Common | `@IsDefined`, `@IsOptional`, `@ValidateNested`, `@ValidateIf`, `@Equals`, ... | ~15 |
| Type Checkers | `@IsString`, `@IsNumber`, `@IsBoolean`, `@IsDate`, `@IsEnum`, ... | ~8 |
| Number | `@Min`, `@Max`, `@IsPositive`, `@IsNegative`, `@IsDivisibleBy` | 5 |
| Date | `@MinDate`, `@MaxDate` | 2 |
| String | `@IsEmail`, `@IsUrl`, `@IsUUID`, `@IsIP`, `@MinLength`, `@Matches`, ... | ~68 |
| Array | `@ArrayContains`, `@ArrayMinSize`, `@ArrayUnique`, ... | 6 |
| Object | `@IsNotEmptyObject`, `@IsInstance` | 2 |

#### 제외 목록 (baker에서 지원하지 않는 데코레이터)

| 데코레이터 | 제외 이유 |
|-----------|----------|
| `@ValidateBy` | baker는 `createRule()` API로 대체. ValidateBy의 메타데이터 기반 접근은 baker 아키텍처와 비호환 |
| `@ValidatePromise` | `@ValidatePromise`의 Promise unwrap 패턴은 baker 아키텍처와 비호환. baker는 `createRule({ validate: async ... })` + `@Transform(async ...)` 으로 비동기 검증/변환을 직접 지원 |
| `@Allow` | baker는 ExposeAll 기본이므로 역할 없음 |

#### 커스텀 검증: `createRule()` API

사용자가 자체 검증 규칙을 만들 수 있는 공식 API:

```typescript
// src/create-rule.ts
export function createRule(options: {
  name: string;               // 규칙 이름 (에러 코드로 사용)
  validate: (value: unknown) => boolean | Promise<boolean>;
  defaultMessage?: string;
}): EmittableRule;
```

- `createRule()`이 반환하는 `EmittableRule`은 반드시 `.emit()` 메서드를 갖는다
- **async 자동 감지**: `validate.constructor.name === 'AsyncFunction'`이면 `isAsync: true` 플래그 설정. `seal()` 시 해당 DTO의 executor가 `async function`으로 생성되며, emit 코드에 `await` 삽입
- 데코레이터/헬퍼 양쪽에서 사용 가능
- `.emit()` 구현: `_refs[i]` 슬롯에 `validate` 함수를 등록하고 `if(!_refs[${i}](${valueExpr}))` (sync) 또는 `if(!(await _refs[${i}](${valueExpr})))` (async) 인라인 코드 생성

#### `@ValidateIf` — 조건부 검증

```typescript
@ValidateIf((obj) => obj.type === 'email')
@IsEmail()
email?: string;
```

- `@ValidateIf`는 `RawPropertyMeta.flags.validateIf`에 조건 함수를 저장
- 코드 생성 시: `if(_refs[condIdx](input)){...검증 코드...}` 로 감싸기 (`input` = 원본 입력 객체. 필드 처리 순서에 무관하게 모든 필드가 확정된 상태)
- 조건이 false면 해당 필드의 모든 검증을 건너뜀

### 1.2 Transform (class-transformer 대응)

class-transformer에서 **4개 데코레이터를 유지**, 3개 제거.

#### 유지

| 데코레이터 | 설명 |
|-----------|------|
| `@Exclude` | 필드 제외 (방향별: `deserializeOnly`, `serializeOnly`). **@Expose와 동시 적용 시 @Exclude 우선** |
| `@Expose` | 필드 노출 제어 + name 매핑 (복수 스택 지원) |
| `@Transform` | 커스텀 변환 함수 |
| `@Type` | 중첩 객체 타입 지정 + discriminator |

#### 제거

| 데코레이터 | 제거 이유 |
|-----------|----------|
| `@Allow` | baker는 `whitelist`/`forbidNonWhitelisted` 옵션이 없음 (ExposeAll 기본). @Allow의 역할이 없으므로 제거 |
| `@TransformInstanceToInstance` | baker가 fused pipeline으로 대체. AOT stubs에서도 의미 없음 |
| `@TransformInstanceToPlain` | `serialize()` 함수로 대체 |
| `@TransformPlainToInstance` | `deserialize()` 함수로 대체 |

### 1.3 전략: ExposeAll 기본

class-transformer의 `strategy` 옵션 제거. **데코레이터가 1개 이상 부착된 필드는 별도 `@Expose` 없이도 기본 노출 (ExposeAll).**
숨기려면 `@Exclude()`만 사용.

- `excludeExtraneousValues` 옵션 불필요 (코드 생성이 등록 필드만 처리)
- `@Expose()` (빈 인자) = "이 필드를 baker에 등록" (getter/computed 등록용, 순수 매핑 전용 필드 등)
- 데코레이터가 **하나도 없는** 필드(plain property)는 코드 생성 대상에서 제외

### 1.4 글로벌 옵션

| 옵션 | 기본값 | 시점 | 설명 |
|------|--------|------|------|
| `enableImplicitConversion` | `false` | seal() | validation 데코레이터를 타입 힌트로 활용한 자동 변환 (reflect-metadata 불필요) |
| `enableCircularCheck` | `auto` | seal() | 순환 참조 감지. auto = 정적 분석으로 필요한 DTO만 WeakSet 삽입 |
| `exposeDefaultValues` | `false` | seal() | `false`: `input['key']` 값(없으면 undefined) → 검증. `true`: `('key' in input) ? input['key'] : defaultValue` → 검증. **양쪽 모두 검증을 수행한다**. `new Class()` 인스턴스는 항상 생성. |
| `stopAtFirstError` | `false` | seal() | true: 첫 에러 즉시 반환. false(기본): 전체 에러 수집 |
| `groups` | `undefined` | **런타임** | 요청별 상이 → `deserialize()` / `serialize()` 호출 시 전달 |

### 1.5 방향 옵션 네이밍

class-transformer의 `toClassOnly` / `toPlainOnly`를 직관적으로 변경:

| class-transformer | baker | 적용 대상 |
|-------------------|-------|----------|
| `toClassOnly` | `deserializeOnly` | @Expose, @Exclude, @Transform |
| `toPlainOnly` | `serializeOnly` | @Expose, @Exclude, @Transform |

### 1.6 네이밍 규칙

```
데코레이터: PascalCase  → @IsString(), @MinLength(3), @Transform(fn)
헬퍼:      camelCase   → isString,     minLength(3),   transform(fn)
함수:      camelCase   → deserialize(), serialize(), seal()
```

- 데코레이터와 헬퍼는 **동일한 검증/변환 로직**을 공유
- 데코레이터는 `Class[RAW]`에 수집 + 헬퍼는 실제 검증 함수
- AOT/seal 모두 헬퍼 함수의 `.emit()`으로 인라인 코드 생성

---

## 2. Symbol 기반 메타데이터 저장

### 2.1 저장 구조

```typescript
// 2개의 Symbol — 외부 저장소 0, 글로벌 오염 0
export const RAW    = Symbol.for('baker:raw');    // 재료 (데코레이터 수집)
export const SEALED = Symbol.for('baker:sealed'); // 완성품 (컴파일된 dual executor)
```

```typescript
// Class[RAW] 구조 — 메타데이터 종류별 분리
interface RawClassMeta {
  [propertyKey: string]: RawPropertyMeta;
}

interface RawPropertyMeta {
  validation: RuleDef[];       // @IsString, @Min, ...
  transform: TransformDef[];   // @Transform
  expose: ExposeDef[];         // @Expose (복수 스택 가능)
  exclude: ExcludeDef | null;  // @Exclude
  type: TypeDef | null;        // @Type
  flags: PropertyFlags;        // @IsOptional, @IsDefined, @ValidateIf 등
}

/** 필드 레벨 플래그 — validation 규칙과 독립적으로 저장 */
interface PropertyFlags {
  isOptional?: boolean;       // @IsOptional() → undefined/null 허용, validation 스킵
  isDefined?: boolean;        // @IsDefined() → null/undefined 불허 (groups 무시)
  validateIf?: ((obj: any) => boolean);  // @ValidateIf(cond) → false면 필드 전체 검증 스킵
  validateNested?: boolean;   // @ValidateNested() → 중첩 DTO 재귀 검증 트리거. @Type과 함께 사용.
                              // builder 트리거 조건: meta.type !== null && meta.flags.validateNested === true
}

/** 데코레이터 공통 옵션 */
interface ValidationOptions {
  each?: boolean;             // true: 배열의 각 원소에 규칙 적용
  groups?: string[];          // 이 규칙이 속하는 그룹 목록
  /** @phase2 — Phase 1에서는 수집만 하고 생성 코드에서 미사용. Phase 2에서 BakerError.message 확장과 함께 활성화 예정. */
  message?: string | ((args: { property: string; value: unknown; constraints: unknown[] }) => string);
}

interface RuleDef {
  rule: EmittableRule;        // 검증 함수 (pre-bound) + .emit()
  each?: boolean;             // ValidationOptions.each에서 파생
  groups?: string[];          // ValidationOptions.groups에서 파생
  // 에러 코드는 rule.ruleName을 사용한다
}

/** @Transform 콜백 시그니처 */
type TransformFunction = (params: TransformParams) => unknown;

interface TransformParams {
  value: unknown;             // 현재 필드 값
  key: string;                // 필드 이름
  obj: Record<string, unknown>;  // deserialize: input (원본 입력 객체), serialize: instance (클래스 인스턴스)
  type: 'deserialize' | 'serialize';  // 변환 방향
}

interface TransformDef {
  fn: TransformFunction;
  options?: { groups?: string[]; deserializeOnly?: boolean; serializeOnly?: boolean; };
}

interface ExposeDef {
  name?: string;              // 매핑할 이름
  groups?: string[];
  deserializeOnly?: boolean;
  serializeOnly?: boolean;
}

interface ExcludeDef {
  deserializeOnly?: boolean;
  serializeOnly?: boolean;
}

interface TypeDef {
  fn: () => new (...args: any[]) => any;
  discriminator?: { property: string; subTypes: { value: Function; name: string; }[] };
  keepDiscriminatorProperty?: boolean;
}
```

```typescript
// Class[SEALED] 구조 — 방향별 dual executor + async 플래그
interface SealedExecutors<T> {
  /** 내부 executor — Result 패턴. deserialize()가 감싸서 throw로 변환 */
  _deserialize: (input: unknown, options?: RuntimeOptions) => (T | Err<BakerError[]>) | Promise<T | Err<BakerError[]>>;
  /** 내부 executor — 항상 성공. serialize는 무검증 전제 (§4.3). */
  _serialize: (instance: T, options?: RuntimeOptions) => Record<string, unknown> | Promise<Record<string, unknown>>;
  /** seal() 시 자동 감지 — deserialize 방향에 async 규칙/@Transform 존재 시 true */
  _isAsync: boolean;
  /** seal() 시 자동 감지 — serialize 방향에 async @Transform 존재 시 true */
  _isSerializeAsync: boolean;
}

interface RuntimeOptions {
  groups?: string[];
}

// ─── 에러 타입 → §12.2 참조 ───
// BakerError, BakerValidationError, SealError의 정의는 §12.2에 단일 정의.
// 여기서는 SealedExecutors가 참조하는 BakerError = §12.2의 { readonly path: string; readonly code: string }.
```

### 2.2 reflect-metadata vs Symbol 프로퍼티

| | reflect-metadata | Symbol 프로퍼티 |
|---|---|---|
| 저장소 | 글로벌 `Reflect` 객체 내부 Map | **클래스 자체** |
| 접근 | `Reflect.getMetadata()` 체인 | **`Class[RAW]` 직접 프로퍼티 접근** |
| GC | 수동 관리 | **Class와 함께 자동 해제** |
| 글로벌 오염 | `Reflect` 전역 확장 | **없음** |
| 의존성 | `reflect-metadata` 패키지 | **없음 (JS 네이티브)** |
| 순회 | Map 이터레이션 | **Object.entries() 직접** |

---

## 3. 데코레이터 — Tier 1: 수집

### 3.1 수집 메커니즘

```typescript
// src/collect.ts — 내부 유틸
import { RAW } from './symbols';
import { globalRegistry } from './registry';
import type { RawPropertyMeta } from './types';

type MetaCategory = keyof RawPropertyMeta;

export function ensureMeta(ctor: Function, key: string): RawPropertyMeta {
  // 전역 레지스트리에 자동 등록 — 데코레이터가 1개라도 붙으면 등록
  globalRegistry.add(ctor);

  const raw = ((ctor as any)[RAW] ??= Object.create(null));
  return (raw[key] ??= {
    validation: [],
    transform: [],
    expose: [],
    exclude: null,
    type: null,
    flags: {},           // PropertyFlags — @IsOptional, @IsDefined, @ValidateIf 등
  });
}

export function collectValidation(target: Object, key: string, ruleDef: RuleDef): void {
  const meta = ensureMeta(target.constructor, key);
  meta.validation.push(ruleDef);
}

export function collectTransform(target: Object, key: string, transformDef: TransformDef): void {
  const meta = ensureMeta(target.constructor, key);
  meta.transform.push(transformDef);
}

export function collectExpose(target: Object, key: string, exposeDef: ExposeDef): void {
  const meta = ensureMeta(target.constructor, key);
  meta.expose.push(exposeDef);
}

export function collectExclude(target: Object, key: string, excludeDef: ExcludeDef): void {
  const meta = ensureMeta(target.constructor, key);
  meta.exclude = excludeDef;
}

export function collectType(target: Object, key: string, typeDef: TypeDef): void {
  const meta = ensureMeta(target.constructor, key);
  meta.type = typeDef;
}
```

### 3.2 데코레이터 구현 패턴

```typescript
// src/decorators/typechecker.ts (예시)
import { collectValidation } from '../collect';
import { isString } from '../rules/typechecker';

export function IsString(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    collectValidation(target, key as string, {
      rule: isString,
      each: options?.each,
      groups: options?.groups,
    });
  };
}
```

```typescript
// src/decorators/common.ts (예시 — @IsOptional, @IsDefined, @ValidateIf)
import { ensureMeta } from '../collect';

export function IsOptional(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    const meta = ensureMeta(target.constructor, key as string);
    meta.flags.isOptional = true;
  };
}

export function IsDefined(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    const meta = ensureMeta(target.constructor, key as string);
    meta.flags.isDefined = true;
    // IsDefined는 groups를 무시하고 항상 적용
  };
}

export function ValidateIf(condition: (obj: any) => boolean): PropertyDecorator {
  return (target, key) => {
    const meta = ensureMeta(target.constructor, key as string);
    meta.flags.validateIf = condition;
  };
}

export function ValidateNested(options?: ValidationOptions): PropertyDecorator {
  return (target, key) => {
    const meta = ensureMeta(target.constructor, key as string);
    meta.flags.validateNested = true;
    // each 옵션은 코드 생성 시 배열 순회 여부 결정에 사용
    // @Type과 함께 사용해야 함 — builder 트리거: meta.type !== null && meta.flags.validateNested
  };
}
```

```typescript
// src/decorators/transform.ts
import { collectExpose, collectExclude, collectTransform, collectType } from '../collect';

export function Expose(options?: ExposeOptions): PropertyDecorator {
  return (target, key) => {
    collectExpose(target, key as string, options ?? {});
  };
}

export function Exclude(options?: ExcludeOptions): PropertyDecorator {
  return (target, key) => {
    collectExclude(target, key as string, options ?? {});
  };
}

export function Transform(fn: TransformFunction, options?: TransformOptions): PropertyDecorator {
  return (target, key) => {
    collectTransform(target, key as string, { fn, options });
  };
}

export function Type(fn: () => Function, options?: TypeOptions): PropertyDecorator {
  return (target, key) => {
    collectType(target, key as string, {
      fn: fn as any,
      discriminator: options?.discriminator,
      keepDiscriminatorProperty: options?.keepDiscriminatorProperty,
    });
  };
}
```

### 3.3 @Expose 복수 스택

방향별 다른 name 매핑을 위해 @Expose를 복수 적용 가능:

```typescript
class UserDto {
  @Expose({ name: 'user_name', deserializeOnly: true })
  @Expose({ name: 'userName', serializeOnly: true })
  name: string;
}
```

**seal() 시 정적 검증 규칙:**

| 조건 | 결과 |
|------|------|
| 다른 방향 (deserializeOnly + serializeOnly) | ✅ 항상 OK |
| 같은 방향 + 겹치지 않는 groups | ✅ OK |
| 같은 방향 + groups 없음 + 복수 | ❌ ERROR |
| 같은 방향 + groups 겹침 | ❌ ERROR |

**검증 에러 메시지 형식**: `validateExposeStacks()` 실패 시, 사용자가 원인을 즉시 파악할 수 있도록 다음 정보를 포함하는 `SealError`를 throw한다:

```typescript
// SealError 메시지 형식
`@Expose conflict on '${className}.${propertyKey}': ` +
`${count} @Expose stacks with ${direction} direction and overlapping groups ${groups}.` +
` Each direction must have at most one @Expose per group set.`

// 예시 출력:
// @Expose conflict on 'UserDto.name': 2 @Expose stacks with 'deserializeOnly' direction
// and overlapping groups []. Each direction must have at most one @Expose per group set.
```

### 3.4 AOT용 빈 스텁 — `@zipbul/baker/stubs`

```typescript
// src/stubs/typechecker.ts — 시그니처 동일, 바디 없음
export function IsString(_options?: ValidationOptions): PropertyDecorator {
  return () => {};
}

export function MinLength(_n: number, _options?: ValidationOptions): PropertyDecorator {
  return () => {};
}
```

AOT 빌드 시 CLI가 `import { IsString } from '@zipbul/baker'` → `'@zipbul/baker/stubs'` 로 리라이팅.
→ `Class[RAW]` 수집 코드 완전 제거. 런타임 코스트 0.

---

## 4. 봉인 — Tier 2: seal()

### 4.1 seal() 개요

```typescript
// src/registry.ts — 전역 레지스트리
/** 데코레이터가 1개라도 부착된 클래스는 ensureMeta()에서 자동 등록 */
export const globalRegistry = new Set<Function>();
```

```typescript
// src/seal.ts
import { RAW, SEALED } from './symbols';
import { globalRegistry } from './registry';

interface SealOptions {
  enableImplicitConversion?: boolean;  // default: false
  enableCircularCheck?: boolean | 'auto';  // default: 'auto'
  exposeDefaultValues?: boolean;  // default: false
  stopAtFirstError?: boolean;  // default: false
}

/**
 * 전역 레지스트리에 등록된 **모든** DTO를 봉인한다.
 * - 인자 없음: 개별 클래스 지정 불가
 * - 2회 호출 시: SealError throw ("already sealed")
 * - 미봉인 클래스에 deserialize() 호출 시: SealError throw ("not sealed")
 */
let _sealed = false;

export function seal(options?: SealOptions): void {
  if (_sealed) throw new SealError('already sealed: seal() must be called exactly once');

  for (const Class of globalRegistry) {
    sealOne(Class, options);
  }

  _sealed = true;
}

/** @internal 테스트 전용 — testing.ts의 unseal()에서 호출 */
export function _resetForTesting(): void {
  _sealed = false;
}

function sealOne<T>(Class: Function, options?: SealOptions): void {
  if ((Class as any)[SEALED]) return;  // 이미 봉인됨 (순환 참조 중 재귀)

  // 0. placeholder 등록 — 순환 참조 시 중첩 seal()이 무한 재귀에 빠지지 않도록
  const placeholder: SealedExecutors<T> = {
    _deserialize: () => { throw new Error('seal in progress'); },
    _serialize: () => { throw new Error('seal in progress'); },
  };
  (Class as any)[SEALED] = placeholder;

  // 1. 상속 메타데이터 병합
  const merged = mergeInheritance(Class);

  // 2. @Expose 스택 정적 검증 (실패 시 SealError throw)
  validateExposeStacks(merged);

  // 3. 순환 참조 정적 분석 (auto 모드)
  const needsCircularCheck = analyzeCircular(Class, merged, options);

  // 4. 중첩 @Type 참조 DTO 먼저 봉인 (재귀)
  for (const meta of Object.values(merged)) {
    if (meta.type?.fn) {
      const nested = meta.type.fn();
      sealOne(nested, options);
    }
    if (meta.type?.discriminator) {
      for (const sub of meta.type.discriminator.subTypes) {
        sealOne(sub.value, options);
      }
    }
  }

  // 5. deserialize executor 코드 생성 (IIFE 클로저 패턴으로 new Function 호출)
  const deserializeExecutor = buildDeserializeCode(Class, merged, options, needsCircularCheck);

  // 6. serialize executor 코드 생성 (IIFE 클로저 패턴으로 new Function 호출)
  const serializeExecutor = buildSerializeCode(Class, merged, options);

  // 7. placeholder를 실제 executor로 교체
  Object.assign(placeholder, { _deserialize: deserializeExecutor, _serialize: serializeExecutor });
  // 동일 객체 유지 (Object.assign으로 in-place 교체)
  // → 이미 참조 중인 중첩 executor가 실제 함수를 얻음
}
```

```typescript
// src/testing.ts — @zipbul/baker/testing 엔트리포인트
/**
 * 테스트 전용: 봉인 상태를 초기화한다.
 * - 모든 Class[SEALED] 제거
 * - 전역 레지스트리 유지 (데코레이터 수집 정보는 보존)
 * - _sealed 플래그 false로 리셋
 * - 프로덕션에서 사용 금지
 */
export function unseal(): void {
  for (const Class of globalRegistry) {
    delete (Class as any)[SEALED];
  }
  _resetForTesting();  // seal.ts에서 export된 내부 리셋 함수 사용
}
```

### 4.2 상속 메타데이터 병합

```typescript
function mergeInheritance(Class: Function): RawClassMeta {
  const chain: Function[] = [];
  let current = Class;
  while (current && current !== Object) {
    if (Object.hasOwn(current as object, RAW)) chain.push(current);  // hasOwn으로 자기 소유만
    current = Object.getPrototypeOf(current);
  }

  // child-first merge: 자식 우선, 부모 보충 (카테고리별 독립 병합)
  const merged: RawClassMeta = Object.create(null);
  for (const ctor of chain) {
    const raw = (ctor as any)[RAW] as RawClassMeta;
    for (const [key, meta] of Object.entries(raw)) {
      if (!merged[key]) {
        // 필드 최초 등장 — 그대로 복사
        merged[key] = { ...meta, validation: [...meta.validation], transform: [...meta.transform], expose: [...meta.expose], flags: { ...meta.flags } };
      } else {
        // 이미 자식에 존재 — 카테고리별 독립 병합
        // validation: 부모 rule을 union (class-validator 호환)
        for (const rd of meta.validation) {
          if (!merged[key].validation.some(d => d.rule === rd.rule)) {
            merged[key].validation.push(rd);
          }
        }
        // transform: 자식에 해당 카테고리가 있을 때만 자식 우선, 없으면 부모 계승
        if (merged[key].transform.length === 0 && meta.transform.length > 0) {
          merged[key].transform = [...meta.transform];
        }
        // expose: 자식에 해당 카테고리가 있을 때만 자식 우선, 없으면 부모 계승
        if (merged[key].expose.length === 0 && meta.expose.length > 0) {
          merged[key].expose = [...meta.expose];
        }
        // exclude: 자식에 설정이 없으면 부모 계승
        if (merged[key].exclude === null && meta.exclude !== null) {
          merged[key].exclude = meta.exclude;
        }
        // type: 자식에 설정이 없으면 부모 계승
        if (merged[key].type === null && meta.type !== null) {
          merged[key].type = meta.type;
        }
        // flags: 자식 우선, 부모에 있고 자식에 없는 플래그만 보충
        const mf = merged[key].flags;
        const pf = meta.flags;
        if (pf.isOptional !== undefined && mf.isOptional === undefined) mf.isOptional = pf.isOptional;
        if (pf.isDefined !== undefined && mf.isDefined === undefined) mf.isDefined = pf.isDefined;
        if (pf.validateIf !== undefined && mf.validateIf === undefined) mf.validateIf = pf.validateIf;
      }
    }
  }

  return merged;
}
```

**병합 규칙 요약**: 모든 카테고리가 **카테고리별 독립 병합**을 따른다.

| 카테고리 | 병합 전략 | 설명 |
|----------|-----------|------|
| validation | **union merge** | 부모+자식 rule 모두 적용 (class-validator 호환) |
| transform | **자식 우선, 부모 계승** | 자식에 `@Transform`이 있으면 자식 것만 사용, 없으면 부모 것 계승 |
| expose | **자식 우선, 부모 계승** | 자식에 `@Expose`가 있으면 자식 것만 사용, 없으면 부모 것 계승 |
| exclude | **자식 우선, 부모 계승** | 자식에 `@Exclude`가 있으면 자식 것만 사용, 없으면 부모 것 계승 |
| type | **자식 우선, 부모 계승** | 자식에 `@Type`이 있으면 자식 것만 사용, 없으면 부모 것 계승 |
| flags | **자식 우선, 부모 보충** | 자식에 해당 플래그가 있으면 자식 것 사용, 없으면 부모 것 보충 |

```typescript
// 예시 1: validation union + transform 부모 계승
class BaseDto {
  @IsString() @Transform(v => v.trim()) name: string;
}
class UserDto extends BaseDto {
  @MinLength(10) name: string;  // validation: 부모 @IsString + 자식 @MinLength = union
                                // transform: 자식에 없음 → 부모 @Transform(trim) 계승
  @IsNumber() age: number;      // 새 필드
}
// seal(UserDto) → {
//   name: { validation: [isString, minLength(10)], transform: [trim] },
//   age: { validation: [isNumber] }
// }

// 예시 2: expose 자식 우선
class BaseDto2 {
  @Expose({ name: 'user_name' }) @IsString() name: string;
}
class ChildDto extends BaseDto2 {
  @Expose({ name: 'username' }) name: string;  // expose: 자식 것 사용 (부모 'user_name' 무시)
                                               // validation: 부모 @IsString 계승
}
```

### 4.3 파이프라인 실행 순서

#### deserialize (필드별):

```
⓪ 제외(Exclude)   : @Exclude({ deserializeOnly: true }) 필드 → 해당 필드 코드 생성 skip (빌드타임 필터)
①  ValidateIf 가드: @ValidateIf 존재 시 조건 함수 실행, false면 필드 전체 skip
② Optional 가드  : @IsOptional 존재 시 undefined/null → 해당 필드 전체 skip
                    (@IsDefined 동시 존재 시 @IsDefined 우선 — optional 가드 생성 안 함)
③ 추출(Extract)   : input에서 값 추출 + @Expose name 매핑 (deserializeOnly)
④ 타입 가드       : string 계열 rule은 builder가 typeof string 자동 삽입 (에러 코드는 첫 번째 rule 이름)
⑤ 변환(Transform) : @Transform 실행 또는 enableImplicitConversion 자동 변환. 복수 @Transform 적용 시 선언 순서대로 파이프라인 (최초 결과가 다음 입력). async @Transform은 seal() 시 자동 감지되어 `await` 삽입
⑥ 배열 전개       : each:true인 규칙이 있으면 for 루프로 각 원소에 규칙 적용
⑦ 검증(Validate)  : validation 데코레이터 실행
⑧ 할당(Assign)    : 통과한 값을 new Class() 인스턴스에 할당
```

> 각 step은 해당 조건 충족 시에만 코드 생성된다 (예: validation 데코레이터 없으면 ④⑦ 생략, @Transform 없으면 ⑤ 생략, @Exclude deserializeOnly면 ⓪에서 skip, @ValidateIf 없으면 ① 생략). 상세 조건은 각 절 참조.

**우선순위 규칙**: `@Transform` 존재 시 → `enableImplicitConversion` 자동 변환 건너뜀 ("명시적 > 자동")

**@IsOptional 처리**: `@IsOptional`은 `EmittableRule`이 아니라 `RawPropertyMeta.flags.isOptional` 플래그로 처리한다. `deserialize-builder`가 `meta.flags.isOptional`을 확인하고 `if (v !== undefined && v !== null) { ... }` 래핑을 생성한다. `@IsDefined`(`meta.flags.isDefined`)와 `@IsOptional`이 동시 선언된 경우 `@IsDefined`가 우선하여 optional 가드를 생성하지 않는다 (class-validator 호환).

**@IsDefined 처리**: `@IsDefined`는 `undefined`만 거부한다. `null`, 빈 문자열(`""`), `0` 등은 통과한다. 코드 생성 시 `if (v === undefined) fail('isDefined')` 코드를 삽입한 후, 후속 validation 로직을 이어서 생성한다. `@IsOptional`이 없으면서 `@IsDefined`만 있으면: undefined → 에러, 나머지 값 → validation 진행.

**@ValidateIf 처리**: `meta.flags.validateIf`가 존재하면 해당 필드의 전체 검증 코드를 `if(_refs[condIdx](input)){...}` 로 감싼다. 조건 함수는 `_refs` 배열에 등록되며, `input` (원본 입력 객체)을 인자로 전달한다. `_out`이 아닌 `input`을 사용하는 이유: `_out`은 필드 처리 순서에 의존하는 불완전 인스턴스이므로, 조건 함수가 참조하는 필드가 아직 undefined일 수 있다. `input`은 모든 필드가 확정된 원본이므로 순서 의존성이 없다. 조건이 false면 해당 필드의 추출/변환/검증/할당을 모두 건너뛴다.

**타입 가드**: "string 계열 rule" = string을 **전제**하는 rule (isEmail, isUUID, isUrl 등). `@IsString` 자체는 제외 — `isString.emit()`이 typeof 체크를 자체 포함하므로 builder 타입 가드 불필요. string 계열 rule이 있으면 builder가 `typeof` 체크를 자동 삽입한다. 이때 에러 코드는 해당 rule의 이름을 사용한다 (예: `@IsEmail` 필드의 string 타입 실패 → `code:'isEmail'`).

**validation 없는 필드**: `@Expose`만 있고 validation 데코레이터가 없는 필드는 타입 체크 없이 직접 할당한다 (baker는 reflect-metadata를 사용하지 않으므로 TS 타입 정보를 알 수 없다).

**each:true 코드 생성**: `RuleDef.each === true`인 규칙은 배열 순회 코드를 생성한다. 값이 배열인지 먼저 확인 (`Array.isArray`) 후, 각 원소에 대해 해당 규칙의 `.emit()`을 적용. `each:true`가 아닌 규칙과 혼합 시, 배열 전체에 대한 규칙을 먼저 실행한 후 원소별 규칙을 순회한다.

**groups 런타임 코드 생성**: `RuleDef.groups`가 존재하는 규칙은 런타임에 groups 체크를 삽입한다: `if(!_groups || _groups.some(g => ['admin','editor'].indexOf(g) !== -1)){...}`. groups가 `undefined`인 규칙은 항상 실행 (조건문 생략, 분기 비용 0).

**Builder 분기 규칙 (stopAtFirstError: false)**: 동일 필드 내 여러 검증 규칙의 코드 생성 분기 기준:

| 상황 | 분기 방식 | 이유 |
|------|-----------|------|
| 타입 가드 실패 (typeof 불일치) | `else if` — 하위 규칙 전체 skip | 타입이 다르면 하위 규칙 실행 자체가 무의미 |
| 동일 타입 내 독립 규칙 (`@Min` + `@Max` 등) | 독립 `if` + 마커 패턴 | 각 규칙이 독립적으로 실패 가능 → 전체 에러 수집 |
| 모든 독립 규칙 통과 후 할당 | `if (_errors.length === _mark)` 체크 | 하나라도 실패하면 할당하지 않음 |

```javascript
// 예시: 타입 가드 → else if, 독립 규칙 → 독립 if + 마커
var __bk$f_age = input['age'];
if (typeof __bk$f_age !== 'number') __bk$errors.push({path:'age',code:'isNumber'});  // 타입 가드
else {
  var __bk$mark_age = __bk$errors.length;                                             // 마커
  if (__bk$f_age < 0) __bk$errors.push({path:'age',code:'min'});                      // 독립 규칙 1
  if (__bk$f_age > 150) __bk$errors.push({path:'age',code:'max'});                    // 독립 규칙 2
  if (__bk$errors.length === __bk$mark_age) __bk$out["age"] = __bk$f_age;             // 전부 통과 시만 할당
}
```

#### serialize (필드별):

```
⓪ 제외(Exclude)   : @Exclude({ serializeOnly: true }) 필드 → 해당 필드 코드 생성 skip (빌드타임 필터)
① 추출(Extract)   : 인스턴스에서 필드 읽기 (baker 등록 필드만)
② Optional 가드  : @IsOptional 필드 → `if (instance.field !== undefined)` 래핑 (undefined면 출력 생략)
③ 필터(Filter)    : groups 체크
④ 변환(Transform) : @Transform 실행 (serializeOnly). 복수 @Transform 적용 시 선언 순서대로 파이프라인. async @Transform은 seal() 시 자동 감지되어 `await` 삽입
⑤ 재귀 직렬화  : @Type 지정된 중첩 DTO는 해당 DTO의 sealed serialize executor를 재귀 호출. 배열이면 `.map()`으로 각 요소 처리
⑥ 매핑(Map)       : @Expose name 매핑 (serializeOnly)
⑦ 출력(Output)    : plain 객체에 할당
```

**serialize 필드 범위**: baker에 등록된 필드만 (validation/transform/expose/exclude/type 중 하나라도 데코레이터가 있는 필드).
→ `@Expose()` (빈 인자) = "이 필드를 등록" (getter/computed용).

**serialize 무검증 전제**: serialize는 이미 `deserialize()`를 통해 검증된(유효한) 인스턴스만을 대상으로 한다. 필드 값의 재검증은 수행하지 않는다. 검증되지 않은 인스턴스를 serialize에 전달한 경우의 결과는 보장하지 않는다.

**@IsOptional serialize 처리**: `@IsOptional`이 선언된 필드는 serialize-builder가 `if (instance.field !== undefined)` 래핑을 생성한다. undefined 값은 출력 객체에 포함하지 않는다 (JSON 직렬화 시 `undefined` 필드 제거와 동일 효과).

### 4.4 exposeDefaultValues 규칙

**핵심 원칙**: `exposeDefaultValues`가 `true`든 `false`든, **값이 결정된 후에는 반드시 validation을 수행한다.**

| 조건 | 동작 |
|------|------|
| `input[key]` 존재 | input 값 사용, validation 실행 |
| `input[key] === undefined` + `exposeDefaultValues: false` | undefined를 값으로 사용, validation 실행 (undefined에 대해 검증) |
| `input[key] === undefined` + `exposeDefaultValues: true` | `('key' in input) ? input['key'] : __bk$out["key"]` → 클래스 기본값 사용, **기본값에 대해 validation 실행** |

> `new _Cls()` 인스턴스는 **항상** 생성한다 (exposeDefaultValues와 무관). `exposeDefaultValues: true`일 때 input에 해당 키가 없으면 `__bk$out["key"]`(기본값)를 변수에 재할당한 뒤 동일한 검증 파이프라인을 통과시킨다.

**@IsOptional 동시 적용**: `@IsOptional` 가드(`!== undefined && !== null`)가 `exposeDefaultValues` 가드(`!== undefined`)를 포함(subsume)하므로, `@IsOptional`이 존재하면 optional 가드만 생성하고 exposeDefaultValues 가드는 생략한다.

```javascript
// exposeDefaultValues: false 생성 코드 (기본)
var __bk$f_name = input['name'];         // undefined면 undefined
if (typeof __bk$f_name !== 'string') __bk$errors.push({path:'name',code:'isString'});
else if (__bk$f_name.length < 3) __bk$errors.push({path:'name',code:'minLength'});
else __bk$out["name"] = __bk$f_name;

// exposeDefaultValues: true 생성 코드
var __bk$f_name = ('name' in input) ? input['name'] : __bk$out["name"];  // input에 없으면 기본값
if (typeof __bk$f_name !== 'string') __bk$errors.push({path:'name',code:'isString'});
else if (__bk$f_name.length < 3) __bk$errors.push({path:'name',code:'minLength'});
else __bk$out["name"] = __bk$f_name;
```

### 4.5 groups + ExposeAll 상호작용

class-transformer 호환 규칙:

| 필드 상태 | groups 옵션 없이 호출 | groups=['admin'] 으로 호출 |
|----------|---------------------|--------------------------|
| groups 미지정 | ✅ 포함 | ✅ 포함 |
| `@Expose({ groups: ['admin'] })` | ❌ 제외 | ✅ 포함 |
| `@Expose({ groups: ['user'] })` | ❌ 제외 | ❌ 제외 |

**groups + name 상호작용**: groups 체크가 name 매핑보다 선행한다. 필드가 groups에 의해 제외되면 `@Expose.name` 매핑도 적용되지 않는다. 예: `@Expose({ name: 'foo', groups: ['admin'] })` — groups 미전달 시 해당 필드 자체가 제외되며, 기본 키로 노출되지도 않음.

코드 생성:
```javascript
// groups 없는 필드 → 조건문 없이 항상 포함 (분기 0)
var __bk$f_name = input['name'];

// groups=['admin'] 필드 → 런타임 체크
if (!__bk$groups || __bk$groups.indexOf('admin') !== -1) {
  var __bk$f_secret = input['secret'];
  // ...
}
```

### 4.6 순환 참조 자동 감지

```typescript
function analyzeCircular(Class: Function, merged: RawClassMeta, options?: SealOptions): boolean {
  if (options?.enableCircularCheck === true) return true;
  if (options?.enableCircularCheck === false) return false;

  // auto: seal() 시 @Type 참조를 따라가며 순환 감지
  const visited = new Set<Function>();
  function walk(cls: Function): boolean {
    if (visited.has(cls)) return true; // 순환 발견
    visited.add(cls);
    const raw = (cls as any)[RAW] as RawClassMeta;
    if (!raw) return false;
    for (const meta of Object.values(raw)) {
      // 단순 @Type
      if (meta.type?.fn) {
        const nested = meta.type.fn();
        if (walk(nested)) return true;
      }
      // discriminator subTypes
      if (meta.type?.discriminator) {
        for (const sub of meta.type.discriminator.subTypes) {
          if (walk(sub.value)) return true;
        }
      }
    }
    visited.delete(cls);
    return false;
  }
  return walk(Class);
}
```

- 순환 없는 flat DTO → WeakSet 코드 0 (오버헤드 0)
- 순환 있는 DTO → WeakSet 자동 삽입

### 4.7 `.emit()` 프로토콜

모든 rule 함수는 `.emit()` 메서드를 가진다. 검증 로직을 **코드 문자열**로 반환.

```typescript
interface EmitContext {
  /** RegExp 참조 배열 (인덱스 반환) */
  addRegex(re: RegExp): number;
  /** 함수 참조 배열 — @Transform 사용자 함수 등 (직접 호출: _refs[i](value)) */
  addRef(fn: Function): number;
  /** SealedExecutors 객체 참조 — 중첩 @Type DTO용 (메서드 호출: _execs[i]._deserialize(v, opts)) */
  addExecutor(executor: SealedExecutors<any>): number;
  /** 에러 코드 생성 — path는 builder가 바인딩, rule은 code만 전달 */
  fail(code: string): string;
  /** 에러 수집 모드 여부 (= !stopAtFirstError) */
  collectErrors: boolean;
}

// EmitContext 구현 참고 — deserialize-builder.ts에서 **필드별로** ctx를 생성:
// const ctx = makeFieldContext(basePath + fieldName);
// addRegex: _re 배열에 push, index 반환
// addRef: _refs 배열에 push, index 반환 (Function 직접 호출용)
// addExecutor: _execs 배열에 push, index 반환 (SealedExecutors 객체 참조용)
//   — 중첩 DTO는 executor 객체를 저장해야 Object.assign placeholder 교체가 유효
// fail: path는 ctx 생성 시 바인딩됨. rule.emit()은 code만 전달.
//   collectErrors ? "_errors.push({path:'${boundPath}',code:'${code}'})" : "return _err([{path:'${boundPath}',code:'${code}'}])"

interface EmittableRule {
  (value: unknown): boolean | Promise<boolean>;
  emit(varName: string, ctx: EmitContext): string;
  readonly ruleName: string;
  /** builder가 typeof 가드 삽입 여부를 판단하는 메타. 해당 타입을 전제하는 rule만 설정. */
  readonly requiresType?: 'string' | 'number';
  /** async validate 함수 사용 시 true — deserialize-builder가 await 코드를 생성 */
  readonly isAsync?: boolean;
}
```

### 4.8 인라인 전략 — 3가지 유형

#### A. 연산자 인라인 (함수 호출 0, 참조 0)

```typescript
isString.emit = (v, ctx) =>
  `if (typeof ${v} !== 'string') ${ctx.fail('isString')};`;
// isString.requiresType = undefined (자체 typeof 포함)

function minLength(n: number) {
  const fn = (v: unknown) => typeof v === 'string' && v.length >= n;
  fn.emit = (v: string, ctx: EmitContext) =>
    `if (${v}.length < ${n}) ${ctx.fail('minLength')};`;
  fn.ruleName = 'minLength';
  fn.requiresType = 'string';  // builder가 typeof string 가드 자동 삽입
  return fn;
}
```

#### B. 정규식 인라인 (RegExp.test만)

```typescript
isEmail.emit = (v: string, ctx: EmitContext) => {
  const i = ctx.addRegex(EMAIL_RE);
  return `if (!_re[${i}].test(${v})) ${ctx.fail('isEmail')};`;
};
isEmail.requiresType = 'string';  // builder가 typeof string 가드 자동 삽입
```

#### C. 알고리즘 인라인 (로직 코드 직접 펼침)

```typescript
isCreditCard.emit = (v: string, ctx: EmitContext) => `{
  var _s=0,_a=false;
  for(var _i=${v}.length-1;_i>=0;_i--){
    var _n=${v}.charCodeAt(_i)-48;
    if(_a){_n*=2;if(_n>9)_n-=9;}
    _s+=_n;_a=!_a;
  }
  if(_s%10!==0) ${ctx.fail('isCreditCard')};
}`;
```

### 4.9 new Function 주입 패턴

`buildDeserializeCode` / `buildSerializeCode`는 **IIFE 클로저 패턴**으로 new Function을 호출한다:

```javascript
// 외부 변수는 클로저 캡처, input/options만 매 호출 매개변수
// 내부 executor는 Result 패턴 (err/isErr)을 사용 — public API (deserialize())가 throw로 변환
const executor = new Function(
  '_Cls', '_re', '_refs', '_execs', '_err', '_isErr',
  'return function(input, _opts) { ' + code + ' }'
)(_Cls, regexes, refs, execs, err, isErr);
```

- `_Cls`: Class 생성자 (new _Cls()용)
- `_re`: RegExp 참조 배열 (seal 시 수집)
- `_refs`: 함수 참조 배열 — `_refs[i](value, meta)` 직접 호출 (@Transform 사용자 함수, @ValidateIf 조건 함수)
- `_execs`: SealedExecutors 객체 참조 배열 — `_execs[i]._deserialize(v, opts)` 메서드 호출 (중첩 @Type DTO)
  - executor **객체** 자체를 저장하므로 `Object.assign(placeholder, sealed)` 이후 `_execs[i]._deserialize()`가 교체된 실제 함수를 호출 (placeholder 참조 무결성 보장)
- `_err`: `@zipbul/result`의 `err()` 함수 — 내부 executor는 실패 시 `_err(errors)` 반환 (Result 패턴)
- `_isErr`: `@zipbul/result`의 `isErr()` 함수 — 중첩 DTO executor 결과 확인용
- `input`: 매 호출마다 전달되는 입력 객체
- `_opts`: RuntimeOptions — `_opts?.groups`로 groups 접근

> **2-layer 에러 모델**: 내부 `_deserialize` executor는 `Result<T, BakerError[]>` 패턴을 사용한다. 성공 시 `T` 직접 반환, 실패 시 `_err(errors)` 반환. Public API `deserialize()`가 이 Result를 받아서 `isErr()` 확인 후 `BakerValidationError`로 throw한다. `_serialize`는 무검증 전제(§4.3)이므로 Result 없이 `Record<string, unknown>`을 직접 반환한다.

**sourceURL 규칙**: 생성되는 코드 문자열 말미에 `//# sourceURL=` 주석을 삽입하여 디버거에서 가상 파일로 인식되게 한다.

```javascript
// deserialize executor
`return ${fnPrefix}(input, _opts) { ` + code + '\n//# sourceURL=baker://ClassName/deserialize }'
// serialize executor
`return ${fnPrefix}(instance, _opts) { ` + code + '\n//# sourceURL=baker://ClassName/serialize }'
```

이를 통해 에러 발생 시 스택 트레이스에서 `baker://CreateUserDto/deserialize`와 같은 가상 경로가 표시되어 어느 DTO의 어느 방향 executor에서 문제가 발생했는지 즉시 파악 가능하다.

**preamble 규칙**:
1. **input guard** (항상 생성): `if (input == null || typeof input !== 'object' || Array.isArray(input)) return _err([{path:'',code:'invalidInput'}]);` — null, 비객체, 배열 입력을 모두 거부한다. baker는 Class 인스턴스를 생성하므로 input은 반드시 plain object여야 한다.
2. **groups**: groups를 참조하는 필드가 1개 이상이면 `var _groups = _opts && _opts.groups;`를 자동 삽입한다.

### 4.10 에러 수집 모드

`stopAtFirstError` 옵션에 따라 다른 코드 생성:

**stopAtFirstError: true (early return):**
```javascript
if (typeof __bk$f_name !== 'string') return _err([{path:'name',code:'isString'}]);
if (__bk$f_name.length < 3) return _err([{path:'name',code:'minLength'}]);
```

**stopAtFirstError: false (전체 수집, 기본):**
```javascript
var __bk$errors = [];
if (typeof __bk$f_name !== 'string') __bk$errors.push({path:'name',code:'isString'});
else if (__bk$f_name.length < 3) __bk$errors.push({path:'name',code:'minLength'});
// 타입 실패 시 해당 필드 하위 규칙 skip, 다른 필드는 계속 진행
// ...
if (__bk$errors.length) return _err(__bk$errors);
return __bk$out;
```

### 4.11 생성되는 코드 예시

**입력 DTO:**
```typescript
class CreateUserDto {
  @IsString() @MinLength(3)
  name: string = 'anonymous';

  @IsEmail()
  email: string;

  @IsNumber() @Min(0) @Max(150) @IsOptional()
  age?: number;

  @Expose({ name: 'user_name', deserializeOnly: true })
  @Expose({ name: 'userName', serializeOnly: true })
  displayName: string;
}
```

**seal({ exposeDefaultValues: true }) — deserialize executor 생성 코드 (stopAtFirstError: false):**
```javascript
'use strict';
var __bk$out = new _Cls();
var __bk$errors = [];
// input 타입 방어 (preamble — §4.9 input guard 규칙)
if (input == null || typeof input !== 'object' || Array.isArray(input)) return _err([{path:'',code:'invalidInput'}]);
// name (exposeDefaultValues: input 없으면 기본값 유지)
var __bk$f_name = input['name'];
if (__bk$f_name !== undefined) {
  if (typeof __bk$f_name !== 'string') __bk$errors.push({path:'name',code:'isString'});
  else if (__bk$f_name.length < 3) __bk$errors.push({path:'name',code:'minLength'});
  else __bk$out["name"] = __bk$f_name;
}
// email (타입 가드: isEmail.emit()이 typeof 체크 포함, 에러 코드는 rule 이름)
var __bk$f_email = input['email'];
if (typeof __bk$f_email !== 'string') __bk$errors.push({path:'email',code:'isEmail'});
else if (!_re[0].test(__bk$f_email)) __bk$errors.push({path:'email',code:'isEmail'});
else __bk$out["email"] = __bk$f_email;
// age (optional)
var __bk$f_age = input['age'];
if (__bk$f_age !== undefined && __bk$f_age !== null) {
  if (typeof __bk$f_age !== 'number') __bk$errors.push({path:'age',code:'isNumber'});
  else {
    var __bk$mark_age = __bk$errors.length;
    if (__bk$f_age < 0) __bk$errors.push({path:'age',code:'min'});
    if (__bk$f_age > 150) __bk$errors.push({path:'age',code:'max'});
    if (__bk$errors.length === __bk$mark_age) __bk$out["age"] = __bk$f_age;
  }
}
// displayName (deserializeOnly name mapping: 'user_name' → displayName, validation 없음 → 직접 할당)
var __bk$f_displayName = input['user_name'];
__bk$out["displayName"] = __bk$f_displayName;
// result
if (__bk$errors.length) return _err(__bk$errors);
return __bk$out;
```

**serialize executor 생성 코드 (동일 DTO):**
```javascript
'use strict';
var __bk$out = {};
// name (groups 없음 → 항상 포함)
__bk$out["name"] = instance["name"];
// email (groups 없음 → 항상 포함)
__bk$out["email"] = instance["email"];
// age (groups 없음 → 항상 포함)
if (instance["age"] !== undefined) __bk$out["age"] = instance["age"];
// displayName (serializeOnly name mapping: displayName → 'userName')
__bk$out['userName'] = instance["displayName"];
// result
return __bk$out;
```

**serialize 코드 생성 규칙:**
- `@Exclude()` 필드 → 코드 생성 skip
- `@Exclude({ serializeOnly: true })` → serialize에서만 skip
- `@Expose({ groups: ['admin'], serializeOnly: true })` → `if (!__bk$groups || __bk$groups.indexOf('admin') !== -1) { ... }` 래핑
- `@Expose({ name: 'foo', serializeOnly: true })` → `__bk$out['foo'] = instance["fieldName"]`
- `@Transform` → `__bk$out["name"] = _refs[i]({value: instance["name"], key: 'name', obj: instance, type: 'serialize'})`. 복수 @Transform 시 선언 순서 파이프라인. async @Transform은 `await` 삽입
- `@Type` 중첩 DTO → `__bk$out["field"] = _execs[i]._serialize(instance["field"], _opts)`. 배열이면 `.map()` 사용
- `@IsOptional` 필드 → `if (instance["field"] !== undefined) __bk$out["field"] = instance["field"]` (§4.3 serialize ②)

### 4.12 Async 지원 설계

desserialize/serialize 모두 `async` Public API를 제공한다. 내부적으로는 async 요소 존재 여부에 따라 sync/async executor를 분기 생성하여 성능을 최적화한다.

#### 4.12.1 Async 요소 자동 감지

`seal()` 시 각 DTO의 메타데이터를 분석하여 비동기 요소 존재 여부를 판단한다:

```typescript
function analyzeAsync(merged: RawClassMeta, direction: 'deserialize' | 'serialize'): boolean {
  for (const meta of Object.values(merged)) {
    // 1. createRule의 isAsync 플래그 검사 (deserialize에만 적용)
    if (direction === 'deserialize' && meta.validation.some(rd => rd.rule.isAsync)) return true;
    // 2. @Transform 함수의 AsyncFunction 여부 검사
    const transforms = direction === 'deserialize'
      ? meta.transform.filter(td => !td.options?.serializeOnly)
      : meta.transform.filter(td => !td.options?.deserializeOnly);
    if (transforms.some(td => td.fn.constructor.name === 'AsyncFunction')) return true;
    // 3. @ValidateNested의 하위 DTO가 async인지 재귀 확인
    if (meta.type?.fn) {
      const nested = (meta.type.fn() as any)[SEALED];
      if (direction === 'deserialize' && nested?._isAsync) return true;
      if (direction === 'serialize' && nested?._isSerializeAsync) return true;
    }
  }
  return false;
}
```

#### 4.12.2 코드 생성 분기

| 조건 | executor 생성 | @Transform/createRule 호출 | 중첩 DTO 호출 |
|------|----------------|--------------------------|----------------|
| async 요소 0개 | `function(input, _opts) { ... }` | 직접 호출 | 직접 호출 |
| async 요소 1+개 | `async function(input, _opts) { ... }` | `await` 삽입 | `await` 삽입 |

#### 4.12.3 Public API

```typescript
// 항상 async — 사용자는 async 여부 신경 안 쓰
// sync executor면 Promise.resolve()로 자동 래핑됨 (Bun에서 await 오버헤드 ≈ 0.1μs)
async function deserialize<T>(Class, input, options?): Promise<T>
async function serialize<T>(instance, options?): Promise<Record<string, unknown>>
```

### 4.13 코드 생성 안전성

#### 4.13.1 Bracket Notation 의무

생성 코드에서 **모든 필드 접근은 bracket notation**을 사용한다:

```javascript
// ✅ 올바른 형식
__bk$out["fieldName"] = __bk$f_field;
instance["fieldName"]

// ❌ 금지된 형식
__bk$out.fieldName = __bk$f_field;
instance.fieldName
```

이유: dot notation은 `__proto__`, `constructor` 같은 필드명에서 prototype pollution 위험이 있다.

#### 4.13.2 금지된 프로퍼티명

`seal()` 시 다음 필드명이 발견되면 `SealError`를 throw한다:

```typescript
const BANNED_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
```

#### 4.13.3 내부 변수 Prefix

생성 코드의 내부 변수는 `__bk$` prefix를 사용하여 DTO 필드명과의 충돌을 방지한다:

| 목적 | 변수명 |
|------|----------|
| 출력 인스턴스 | `__bk$out` |
| 에러 배열 | `__bk$errors` |
| groups | `__bk$groups` |
| 필드 변수 | `__bk$f_${fieldKey}` |
| 마커 | `__bk$mark_${fieldKey}` |

이 prefix는 사용자가 DTO 필드명으로 `out`, `errors`, `groups` 등을 사용해도 충돌하지 않음을 보장한다.

---

## 5. 실행 — Tier 3

### 5.1 deserialize() — Public API (throw 패턴)

```typescript
import { isErr } from '@zipbul/result';
import { SEALED } from './symbols';
import { SealError, BakerValidationError } from './errors';
import type { RuntimeOptions, BakerError } from './types';

/**
 * input → Class 인스턴스 변환 + 검증.
 * - 성공: Promise<T> 반환
 * - 검증 실패: BakerValidationError throw
 * - 미봉인: SealError throw
 */
export async function deserialize<T>(
  Class: new (...args: any[]) => T,
  input: unknown,
  options?: RuntimeOptions,
): Promise<T> {
  const sealed = (Class as any)[SEALED];
  if (!sealed) throw new SealError(`not sealed: ${Class.name}. Call seal() before deserialize()`);

  const result = await sealed._deserialize(input, options);
  if (isErr(result)) {
    throw new BakerValidationError(result.data as BakerError[]);
  }
  return result;
}
```

```typescript
// 사용
try {
  const user = await deserialize(CreateUserDto, body);
  // user: CreateUserDto 인스턴스
} catch (e) {
  if (e instanceof BakerValidationError) {
    // e.errors: BakerError[] — 개별 필드 에러 목록
    return new Response(JSON.stringify(e.errors), { status: 400 });
  }
  throw e;
}
```

- 성공 시: `Promise<T>` 반환
- 검증 실패 시: `BakerValidationError` throw (errors 배열 포함)
- 미봉인 시: `SealError` throw — Lazy fallback **없음**

### 5.2 serialize() — Public API

```typescript
/**
 * Class 인스턴스 → plain 객체 변환.
 * - 미봉인: SealError throw
 */
export async function serialize<T>(
  instance: T,
  options?: RuntimeOptions,
): Promise<Record<string, unknown>> {
  const Class = (instance as any).constructor;
  const sealed = (Class as any)[SEALED];
  if (!sealed) throw new SealError(`not sealed: ${Class.name}. Call seal() before serialize()`);

  return await sealed._serialize(instance, options);
}
```

### 5.3 RuntimeOptions

```typescript
interface RuntimeOptions {
  groups?: string[];
}

// groups가 요청마다 다를 수 있으므로 런타임에 전달
const adminResult = await deserialize(UserDto, body, { groups: ['admin'] });
const publicResult = await serialize(user, { groups: ['public'] });
```

---

## 6. AOT 통합

### 6.1 AOT 플로우

```
[빌드타임]
1. CLI가 DTO 소스를 AST 분석 (oxc-parser)
2. 데코레이터 + 인자 추출
3. 각 rule의 .emit()과 동일한 로직으로 코드 생성
4. @Transform 사용자 함수 처리 (아래 §6.1.1 참조)
5. Class[SEALED]에 dual executor를 세팅하는 코드 파일 emit
6. 데코레이터 import를 @zipbul/baker/stubs로 리라이팅

[런타임]
7. 생성된 코드가 Class[SEALED]를 직접 세팅
8. deserialize(Class, input) → 이미 SEALED 존재 → 즉시 실행
```

#### 6.1.1 AOT에서 @Transform 사용자 함수 처리

`@Transform(fn)` 의 사용자 함수는 인라인 코드 생성이 불가하다. AOT는 다음 전략으로 처리한다:

| 조건 | AOT 처리 |
|------|----------|
| 함수가 named export / named function | AST에서 원본 파일 경로 + export명 추출 → 생성 코드에 `import { fn } from '../dto/...'` 삽입 |
| 함수가 inline arrow / anonymous | **AOT 대상에서 제외** → 해당 DTO는 런타임 `seal()`로 보정 |

```typescript
// AOT 가능: named export
export const trimStr = (v: string) => v.trim();
class UserDto {
  @Transform(trimStr) name: string;  // → import { trimStr } from '...' 생성
}

// AOT 불가 → 런타임 seal()로 보정
class UserDto2 {
  @Transform(v => v.toUpperCase()) name: string;  // inline → AOT 제외
} 제외된 DTO는 런타임 `seal()`에서 보정된다.

### 6.2 AOT가 생성하는 코드

```typescript
// generated/create-user.dto.sealed.ts
import { SEALED } from '@zipbul/baker/symbols';
import { err } from '@zipbul/result';
import { CreateUserDto } from '../dto/create-user.dto';

const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@...$/;

(CreateUserDto as any)[SEALED] = {
  _deserialize(input: unknown, _opts?: any) {
    'use strict';
    var _out = new CreateUserDto();
    var _errors: any[] = [];
    var _name = (input as any)['name'];
    if (typeof _name !== 'string') _errors.push({path:'name',code:'isString'});
    else if (_name.length < 3) _errors.push({path:'name',code:'minLength'});
    else _out.name = _name;
    var _email = (input as any)['email'];
    if (typeof _email !== 'string') _errors.push({path:'email',code:'isEmail'});
    else if (!EMAIL_RE.test(_email)) _errors.push({path:'email',code:'isEmail'});
    else _out.email = _email;
    if (_errors.length) return err(_errors);
    return _out;
  },
  _serialize(instance: any, _opts?: any) {
    'use strict';
    var _out: any = {};
    _out.name = instance.name;
    _out.email = instance.email;
    return _out;
  },
};
```

### 6.3 AOT vs 런타임 seal — 등가 증명

| | AOT | 런타임 seal |
|---|---|---|
| 코드 생성 시점 | 빌드타임 | 앱 시작 시 |
| 코드 생성 방법 | AST 분석 + emit | `Class[RAW]` + `.emit()` |
| RegExp 참조 | 모듈 상수 | refs 배열 `_re[N]` |
| 생성자 참조 | `new ClassName()` | `new _Cls()` |
| 생성 코드 구조 | **동일** (참조 방식만 차이) | **동일** (참조 방식만 차이) |
| 실행 성능 | **동일** | **동일** |
| 차이점 | 앱 시작 시 코드 생성 비용 0 | 앱 시작 시 코드 생성 < 1ms/DTO |

---

## 7. enableImplicitConversion 설계

reflect-metadata 없이, **validation 데코레이터를 타입 힌트로 활용**:

| 데코레이터 | 추론 타입 | 변환 |
|-----------|----------|------|
| `@IsNumber`, `@IsInt`, `@Min`, `@Max` | number | `Number(value)` |
| `@IsBoolean` | boolean | `value === 'true' \|\| value === '1'` |
| `@IsDate`, `@MinDate`, `@MaxDate` | Date | `new Date(value)` |
| `@IsString`, `@MinLength` 등 | string | 변환 없음 (HTTP input 기본이 string) |
| `@IsEnum(MyEnum)` | enum | 해당 enum 값으로 변환 |

**우선순위**: `@Transform` 존재 시 implicit conversion **skip** ("명시적 > 자동")

코드 생성 예시 (`enableImplicitConversion: true`):
```javascript
// @IsNumber @Min(0) age 필드
var __bk$f_age = input['age'];
if (typeof __bk$f_age === 'string') __bk$f_age = Number(__bk$f_age);  // implicit conversion
if (typeof __bk$f_age !== 'number') __bk$errors.push({path:'age',code:'isNumber'});
else if (__bk$f_age < 0) __bk$errors.push({path:'age',code:'min'});
else __bk$out["age"] = __bk$f_age;
```

---

## 8. discriminator + 다형성 (Phase 2)

```typescript
class NotificationDto {
  @ValidateNested()
  @Type(() => Content, {
    discriminator: {
      property: 'type',
      subTypes: [
        { value: TextContent, name: 'text' },
        { value: ImageContent, name: 'image' },
      ],
    },
    keepDiscriminatorProperty: true,
  })
  content: TextContent | ImageContent;
}
```

### 8.1 단순 중첩 (discriminator 없음)

```typescript
class UserDto {
  @ValidateNested()
  @Type(() => AddressDto)
  address: AddressDto;
}
```

코드 생성:
```javascript
// _execs[0] = AddressDto의 SealedExecutors 객체 (addExecutor로 등록)
// 내부 executor(_deserialize)를 직접 호출하여 Result 패턴으로 처리
var _address = input['address'];
if (_address != null && typeof _address === 'object') {
  var _r = _execs[0]._deserialize(_address, _opts);
  if (_isErr(_r)) {
    var _re = _r.data;
    for (var _i = 0; _i < _re.length; _i++) {
      _errors.push({path:'address.' + _re[_i].path, code:_re[_i].code});
    }
  } else {
    _out.address = _r;
  }
} else {
  _errors.push({path:'address',code:'isObject'});
}
```

**에러 path prefix 합성**: 중첩 executor가 반환한 `BakerError[]`의 각 `path` 앞에 부모 필드명을 붙인다 (`'address.' + childError.path`). builder가 코드 생성 시 prefix 문자열을 하드코딩.

### 8.2 배열 중첩 (`each: true`)

```typescript
class OrderDto {
  @ValidateNested({ each: true })
  @Type(() => ItemDto)
  items: ItemDto[];
}
```

코드 생성:
```javascript
var _items = input['items'];
if (Array.isArray(_items)) {
  var _arr = [];
  for (var _i = 0; _i < _items.length; _i++) {
    var _r = _execs[0]._deserialize(_items[_i], _opts);
    if (_isErr(_r)) {
      var _re = _r.data;
      for (var _j = 0; _j < _re.length; _j++) {
        _errors.push({path:'items[' + _i + '].' + _re[_j].path, code:_re[_j].code});
      }
    } else {
      _arr.push(_r);
    }
  }
  _out.items = _arr;
} else {
  _errors.push({path:'items',code:'isArray'});
}
```

### 8.3 discriminator

```typescript
class NotificationDto {
  @ValidateNested()
  @Type(() => Content, {
    discriminator: {
      property: 'type',
      subTypes: [
        { value: TextContent, name: 'text' },
        { value: ImageContent, name: 'image' },
      ],
    },
    keepDiscriminatorProperty: true,
  })
  content: TextContent | ImageContent;
}
```

코드 생성:
```javascript
var _content = input['content'];
var _contentType = _content && _content['type'];
switch (_contentType) {
  case 'text':
    var _r = _execs[0]._deserialize(_content, _opts);
    if (_isErr(_r)) {
      var _re = _r.data;
      for (var _i = 0; _i < _re.length; _i++) {
        _errors.push({path:'content.' + _re[_i].path, code:_re[_i].code});
      }
    } else {
      _out.content = _r;
    }
    break;
  case 'image':
    var _r = _execs[1]._deserialize(_content, _opts);
    if (_isErr(_r)) {
      var _re = _r.data;
      for (var _i = 0; _i < _re.length; _i++) {
        _errors.push({path:'content.' + _re[_i].path, code:_re[_i].code});
      }
    } else {
      _out.content = _r;
    }
    break;
  default:
    _errors.push({path:'content.type',code:'invalidDiscriminator'});
}
```

### 8.4 중첩 DTO SealOptions 전파

`seal()` 호출 시 전역 레지스트리의 모든 DTO를 순회하되, 중첩 `@Type` DTO는 `sealOne()` 내부에서 재귀적으로 먼저 봉인된다 (§4.1 참조). 모든 DTO에 동일한 `SealOptions`가 적용된다.

```typescript
// 예시: 일관된 옵션 전파
seal({ stopAtFirstError: true });
// → 전역 레지스트리의 모든 DTO (중첩 포함)가 { stopAtFirstError: true }로 봉인
```

---

## 9. 디렉토리 구조

```
packages/baker/
├── BAKER_PLAN.md
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── bunfig.toml
├── index.ts                    ← Public Facade (seal, deserialize, serialize, 데코레이터 재수출)
├── testing.ts                  ← @zipbul/baker/testing 엔트리 (unseal)
│
├── src/
│   ├── symbols.ts              ← RAW, SEALED Symbol 정의
│   ├── registry.ts             ← globalRegistry (Set<Function>) — 데코레이터가 자동 등록
│   ├── collect.ts              ← collect*() 수집 유틸 (종류별) + ensureMeta (전역 레지스트리 등록)
│   ├── types.ts                ← RawPropertyMeta, RuleDef, TransformDef, ExposeDef, PropertyFlags, ...
│   ├── interfaces.ts           ← ValidationOptions, SealOptions, RuntimeOptions
│   ├── errors.ts               ← BakerValidationError, SealError, BakerError 인터페이스
│   ├── create-rule.ts          ← createRule() API — 커스텀 EmittableRule 생성
│   │
│   ├── seal/                   ← seal() 코드 생성
│   │   ├── seal.ts             ← seal() 메인 + sealOne() + 상속 병합
│   │   ├── deserialize-builder.ts  ← deserialize executor 코드 생성
│   │   ├── serialize-builder.ts    ← serialize executor 코드 생성
│   │   ├── circular-analyzer.ts    ← 순환 참조 정적 분석
│   │   ├── expose-validator.ts     ← @Expose 스택 정적 검증
│   │   └── index.ts
│   │
│   ├── decorators/             ← 데코레이터 (Class[RAW] 수집)
│   │   ├── common.ts           ← @IsOptional, @IsDefined, @ValidateIf, @ValidateNested, @Equals 등
│   │   ├── typechecker.ts
│   │   ├── number.ts
│   │   ├── date.ts
│   │   ├── string.ts
│   │   ├── array.ts
│   │   ├── object.ts
│   │   ├── transform.ts        ← @Expose, @Exclude, @Transform, @Type
│   │   └── index.ts
│   │
│   ├── stubs/                  ← AOT용 빈 스텁 (시그니처만, 바디 없음)
│   │   └── ... (decorators 미러)
│   │
│   ├── rules/                  ← 검증 함수 + .emit() 메서드
│   │   ├── common.ts + spec
│   │   ├── typechecker.ts + spec
│   │   ├── number.ts + spec
│   │   ├── date.ts + spec
│   │   ├── string.ts + spec    ← 최대 파일 (RFC 기반 직접 구현)
│   │   ├── array.ts + spec
│   │   ├── object.ts + spec
│   │   └── index.ts
│   │
│   ├── functions/              ← deserialize, serialize (Public API — throw 패턴)
│   │   ├── deserialize.ts + spec
│   │   ├── serialize.ts + spec
│   │   └── index.ts
│   │
│   └── locales/                ← 로케일 데이터 (top-20, 확장 가능)
│       ├── mobile-phone.ts
│       ├── postal-code.ts
│       └── identity-card.ts
│
├── test/                       ← 통합 테스트
│   ├── deserialize.test.ts
│   ├── serialize.test.ts
│   ├── seal.test.ts
│   ├── inheritance.test.ts
│   ├── nested.test.ts
│   ├── transform.test.ts
│   ├── groups.test.ts
│   ├── error.test.ts
│   └── codegen.test.ts
│
└── coverage/
    └── lcov.info
```

---

## 10. package.json

```json
{
  "name": "@zipbul/baker",
  "version": "0.0.1",
  "description": "AOT-equivalent validate + transform with inline code generation",
  "license": "MIT",
  "type": "module",
  "module": "index.ts",
  "dependencies": {
    "@zipbul/result": "workspace:*"
  },
  "exports": {
    ".": { "import": "./index.ts" },
    "./decorators": { "import": "./src/decorators/index.ts" },
    "./stubs": { "import": "./src/stubs/index.ts" },
    "./rules": { "import": "./src/rules/index.ts" },
    "./symbols": { "import": "./src/symbols.ts" },
    "./testing": { "import": "./testing.ts" }
  },
  "engines": { "bun": ">=1.0.0" },
  "scripts": {
    "test": "bun test",
    "coverage": "bun test --coverage"
  }
}
```

> **`@zipbul/result`**: 모노레포 내부 의존. Public API에는 노출되지 않는다 (내부 executor의 Result 패턴에만 사용). 사용자는 `@zipbul/result`를 직접 `import`할 필요 없다.

---

## 11. 직접 구현 전략

검증 로직은 validator.js를 포크하지 않고 **RFC/표준 명세 기반 직접 구현**.

### 11.1 구현 근거별 분류

| 분류 | 구현 근거 | 예시 |
|------|----------|------|
| **RFC 기반** | 해당 RFC 명세 직접 참조 | isEmail (RFC 5322), isUrl (RFC 3986), isIP (RFC 791/2460) |
| **알고리즘 기반** | 알고리즘 명세 구현 | isCreditCard (Luhn), isISBN (체크섬), isIBAN (mod-97) |
| **패턴 기반** | 정규식 형식 검증 | isUUID, isHexColor, isMacAddress, isJWT, isSemVer |
| **단순 검사** | typeof / 범위 검사 | isString, isNumber, min, max, length |
| **로케일** | top-20 로케일 + 확장 API | isMobilePhone, isPostalCode, isIdentityCard |

### 11.2 edge case 검증

- validator.js **테스트 케이스(입력/출력 쌍)만 참조**하여 edge case spec 작성 (코드 의존 0, devDependency도 미사용)
- RFC 문서 예제를 spec에 포함
- 정답 기준: RFC/표준 명세 (validator.js 자체가 아님)

### 11.3 .emit() 의무

**모든 rule 함수는 `.emit()` 메서드 필수.** emit 없는 rule은 seal에서 사용 불가.
이는 인라인을 보장하는 핵심 제약.

**예외**: `@Transform` 사용자 함수는 인라인 불가 → refs 배열로 전달 (`_refs[i](value)`).

---

## 12. 에러 모델

### 12.1 2-Layer 에러 아키텍처

```
┌─────────────────────────────────────────────────────┐
│  Public API Layer (사용자 접점)                       │
│  deserialize() → 성공: Promise<T> / 실패: throw        │
│  serialize()   → 항상 성공: Promise<Record> 반환      │
│  미봉인: throw SealError                              │
└───────────────────────┬─────────────────────────────┘
                        │ deserialize: await + isErr() 확인 후 throw 변환
                        │ serialize: await 후 직접 반환
┌───────────────────────┴─────────────────────────────┐
│  Internal Executor Layer (코드 생성)                  │
│  _deserialize() → sync|async executor                │
│    성공: T / 실패: _err(BakerError[])                   │
│  _serialize()   → sync|async executor                │
│    항상 Record<string, unknown> 반환                   │
│  @zipbul/result: _deserialize만 사용 (사용자 미노출)  │
└─────────────────────────────────────────────────────┘
```

**이유**: 내부 executor는 `_err(errors)` 한 줄로 실패를 반환하므로 코드 생성이 단순하다. Public API는 사용자 DX를 위해 throw 패턴을 사용하므로 `@zipbul/result` 의존을 사용자에게 강제하지 않는다.

### 12.2 에러 타입

```typescript
/** 개별 필드 에러 — 최소 계약 */
interface BakerError {
  readonly path: string;       // 'name', 'profile.bio', 'items[0].name', '' (루트)
  readonly code: string;       // 'isString', 'minLength', 'isEmail', 'invalidInput'
}

// 예약 에러 코드:
// - 'invalidInput': input이 null, 비객체, 배열일 때 (§4.9 preamble, path='').
//   예: deserialize(UserDto, null) → throw BakerValidationError([{path:'',code:'invalidInput'}])
//   예: deserialize(UserDto, [1,2]) → throw BakerValidationError([{path:'',code:'invalidInput'}])
// - 'isObject': 중첩 @Type 필드의 값이 객체가 아닐 때 (§8.1)
// - 'isArray': 배열 중첩 (each:true) 필드의 값이 배열이 아닐 때 (§8.2)
// - 'invalidDiscriminator': discriminator 값이 subTypes에 없을 때 (§8.3)
```

```typescript
/** Public API가 throw하는 에러 — 검증 실패 */
class BakerValidationError extends Error {
  readonly errors: BakerError[];
  constructor(errors: BakerError[]) {
    super(`Validation failed: ${errors.length} error(s)`);
    this.name = 'BakerValidationError';
    this.errors = errors;
  }
}

/** 봉인 관련 에러 — seal() 중복 호출, 미봉인 클래스 사용 */
class SealError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SealError';
  }
}
```

**하위 호환 원칙**: `{path, code}`는 **최소 계약(minimum contract)**이다. 향후 확장 필드(`message`, `expected`, `actual` 등)는 반드시 **Optional**로 정의하여, 기존 `{path, code}`만 참조하는 코드가 파괴되지 않도록 보장한다.

```typescript
// 향후 확장 시 인터페이스 형태 (하위 호환)
interface BakerError {
  readonly path: string;            // 최소 계약 — 항상 존재
  readonly code: string;            // 최소 계약 — 항상 존재
  readonly message?: string;        // Phase 2+ 확장 — Optional
  readonly expected?: unknown;      // Phase 2+ 확장 — Optional
  readonly actual?: unknown;        // Phase 2+ 확장 — Optional
}
```

### 12.3 내부 Result 패턴 (`@zipbul/result`)

내부 executor가 사용하는 Result 패턴. **사용자에게 노출되지 않는다.**

```typescript
// @zipbul/result 의 타입 (참고용)
type Result<T, E> = T | Err<E>;
type Err<E> = { readonly stack: string; readonly data: E };

// 내부 executor가 실패 시:
return _err(errors);  // → Err<BakerError[]> 반환

// Public API가 변환:
const result = sealed._deserialize(input, options);
if (isErr(result)) {
  throw new BakerValidationError(result.data);  // Result → throw 변환
}
return result;  // T
```

---

## 13. 성능 계층 — 정직한 표

| 계층 | 해당 규칙 | 루프 | 외부 호출 | 비고 |
|------|----------|------|----------|------|
| **T0: 순수 인라인** | typeof, 비교, length | 0 | 0 | 연산자만 |
| **T1: 정규식** | isEmail, isUUID, isSemVer | 0 | RegExp.test (엔진 네이티브) | |
| **T2: 알고리즘 펼침** | isCreditCard (Luhn) | 알고리즘 고유 루프 | 0 | 제거 불가/불필요 |
| **T3: refs 함수 호출** | @Transform (사용자 함수) | 0 | `_refs[i](value)` 1회 | 사용자 코드 = 인라인 불가 |
| **T4: 중첩 재귀** | @ValidateNested + @Type | 배열 시 for 루프 | `_execs[i]._deserialize()` 호출 | 구조적 한계 |

**baker가 제거한 것**: 규칙 배열 순회, 메타데이터 Map lookup, Reflect 접근, strategy 분기, validator.js 함수 호출, validate 별도 패스.

---

## 14. class-transformer 대비 향상 요약

### 성능

| 항목 | class-transformer | baker |
|------|-------------------|-------|
| 메타데이터 조회 | 4× Map lookup/필드/요청 | 0 (코드 생성 시 소멸) |
| 규칙 순회 | O(N)/요청 | 0 (정적 인라인) |
| reflect-metadata | 전역 Map + prototype chain | 0 (Symbol 직접) |
| 패스 수 | 2 (transform → validate) | 1 (fused) |
| 인스턴스 할당 | `Object.keys().forEach()` | 정적 직접 할당 |
| circular check | 매 호출 Set | 정적 분석, 필요 시만 |
| strategy 분기 | 런타임 매 필드 | 0 (ExposeAll 고정) |

### DX

| 항목 | Before (class-transformer+validator) | After (baker) |
|------|--------------------------------------|---------------|
| 패키지 | 3개 (validator + transformer + reflect-metadata) | 1개 (@zipbul/baker) |
| tsconfig | `emitDecoratorMetadata: true` 필수 | 불필요 |
| API | `plainToInstance → validate → if errors` = 3단계 | `try { deserialize() } catch` = 1단계 |
| 에러 타입 | `ValidationError[]` (복잡) | `BakerValidationError` (throw, errors 배열 포함) |
| 에러 접근 | `errors[0].constraints['isString']` 중첩 접근 | `e.errors[0].code === 'isString'` 평탄 접근 |
| Result 의존 | N/A | 없음 (내부만 사용, 사용자 미노출) |
| 동기/비동기 | `validate()` = async | `deserialize()` = async (`Promise<T>`). 내부적으로 sync DTO는 sync executor 생성 → await 오버헤드 최소화. `serialize()` = async (`Promise<Record>`) |
| 방향별 name | 불가 (양방향 동일) | @Expose 스택으로 방향별 가능 |
| AOT | 없음 | stubs + CLI 연동 |
| 커스텀 규칙 | `@ValidateBy` (메타데이터 기반) | `createRule()` (직접 `.emit()` 포함) |

---

## 15. 구현 순서

### Phase 1: 코어 인프라

| # | 파일 |
|---|------|
| 1 | `package.json`, `tsconfig.json`, `bunfig.toml` |
| 2 | `src/symbols.ts` — RAW, SEALED |
| 3 | `src/registry.ts` — globalRegistry (Set<Function>) |
| 4 | `src/types.ts` — RawPropertyMeta, RuleDef, TransformDef, ExposeDef, PropertyFlags, EmitContext |
| 5 | `src/interfaces.ts` — ValidationOptions, SealOptions, RuntimeOptions |
| 6 | `src/errors.ts` — BakerValidationError, SealError, BakerError + spec |
| 7 | `src/collect.ts` |
| 8 | `src/create-rule.ts` — createRule() API + spec |

### Phase 2: Rules (검증 함수 + .emit())

| # | 파일 |
|---|------|
| 9 | `src/rules/typechecker.ts` + spec |
| 10 | `src/rules/number.ts` + spec |
| 11 | `src/rules/date.ts` + spec |
| 12 | `src/rules/common.ts` + spec |
| 13 | `src/rules/string.ts` + spec — 최대 파일 (RFC 기반) |
| 14 | `src/rules/array.ts` + spec |
| 15 | `src/rules/object.ts` + spec |

### Phase 3: seal + 코드 생성

| # | 파일 |
|---|------|
| 16 | `src/seal/seal.ts` + spec — 상속 병합 + 메인 |
| 17 | `src/seal/deserialize-builder.ts` + spec |
| 18 | `src/seal/serialize-builder.ts` + spec |
| 19 | `src/seal/circular-analyzer.ts` + spec |
| 20 | `src/seal/expose-validator.ts` + spec |

### Phase 4: Functions + Decorators + Stubs

| # | 파일 |
|---|------|
| 21 | `src/functions/deserialize.ts` + spec |
| 22 | `src/functions/serialize.ts` + spec |
| 23-30 | `src/decorators/*.ts` — Class[RAW] 수집 |
| 31-38 | `src/stubs/*.ts` — AOT용 빈 스텁 |

### Phase 5: 통합

| # | 파일 |
|---|------|
| 39 | `src/*/index.ts`, `index.ts` — 재수출 |
| 40 | `testing.ts` — unseal() (테스트 전용) |
| 41-49 | `test/*.test.ts` — 통합 테스트 9개 |

### Phase 6 (후속): 고급 기능

| # | 기능 |
|---|------|
| 50 | `src/locales/*.ts` — top-20 로케일별 정규식/알고리즘 (isMobilePhone, isPostalCode, isIdentityCard) |
| 51 | discriminator + keepDiscriminatorProperty |
| 52 | enableImplicitConversion |
| 53 | AOT CLI 연동 |
| 54 | ESLint 플러그인 — `reflect-metadata` 부재 보완: `@Type` 누락 감지/경고, 원시 타입 외 필드의 데코레이터 부착 강제 |

---

## 16. 라이센스

```
packages/baker/THIRD_PARTY_LICENSES.md
```

```markdown
# Third Party Licenses

## class-validator
- License: MIT
- Copyright: (c) 2015-2020 TypeStack
- Source: https://github.com/typestack/class-validator
- Usage: Decorator API surface reference.

## class-transformer
- License: MIT
- Copyright: (c) 2015-2020 TypeStack
- Source: https://github.com/typestack/class-transformer
- Usage: Transformer decorator API surface reference.
```

---

## 17. 불변식

| 불변식 | 설명 |
|--------|------|
| **Bun Exclusive** | Bun 런타임만 지원 |
| **Legacy Decorators** | `experimentalDecorators: true`. TC39 Stage 3 데코레이터에 파라미터 데코레이터 미포함, 별도 제안 Stage 1 정체 → Legacy 고정 |
| **No reflect-metadata** | reflect-metadata 금지. `Reflect` 전역 확장 금지. `emitDecoratorMetadata` 불필요 |
| **Symbol on Class** | 외부 저장소(WeakMap, Map, Set) 금지. Class[Symbol]만 사용. 전역 레지스트리(`Set<Function>`)는 인덱스로만 사용 (메타데이터 저장 안 함) |
| **Strict Seal** | `seal()` 1회만 호출 가능, 전역 레지스트리 전체 봉인. 미봉인 클래스에 `deserialize()` 시 `SealError` throw. Lazy 모드 없음. `unseal()`은 테스트 전용 (`@zipbul/baker/testing`) |
| **Throw on Error** | `deserialize()` 실패 시 `BakerValidationError` throw. `serialize()`는 무검증 전제. 두 함수 모두 `async` — `Promise<T>`, `Promise<Record<string, unknown>>` 반환. 내부 executor는 sync/async 자동 분기. `_deserialize`만 `@zipbul/result` Result 패턴 사용. 사용자에게 `@zipbul/result` 의존 미강제 |
| **ExposeAll 기본** | strategy 옵션 없음. 데코레이터 1개 이상 부착된 필드 기본 노출. @Exclude로만 숨김 |
| **.emit() 필수** | 모든 rule은 `.emit()` 필수. @Transform 사용자 함수만 refs로 전달 |
| **Zero Dependencies** | 외부 npm 의존 금지 (모노레포 내부 `@zipbul/result` 제외 — 사용자에게 미노출) |
| **AOT Equivalence** | 런타임 seal와 AOT 빌드의 실행 코드 = 동치 |
| **Fused Pipeline** | validate + transform은 단일 패스로 통합 실행 |
| **명시적 > 자동** | @Transform 존재 시 enableImplicitConversion 건너뜀 |
| **상속 병합** | seal() 시 prototype chain 순회. 모든 카테고리가 **카테고리별 독립 병합**: validation은 union merge (부모+자식 모두 적용), expose/exclude/type/transform은 **자식 우선, 부모 계승** (자식에 해당 카테고리가 있으면 자식 것 사용, 없으면 부모 것 계승) |
| **등록 필드만** | serialize는 baker 데코레이터가 1개라도 있는 필드만 대상 |
| **class-validator 0.14.1** | 호환 기준 버전 고정. 제외 목록: `@ValidateBy`, `@ValidatePromise`, `@Allow` |