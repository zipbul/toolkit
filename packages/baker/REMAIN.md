# @zipbul/baker 잔여 작업 목록

> **작성일:** 2026-02-23
> **최종 갱신:** 2026-02-24
> **기준:** BAKER_PLAN.md Draft v6 + 코드 심층 분석 결과
> **현재 상태:** 1111 테스트 통과, 0 실패, 98.28% 라인 커버리지
> **Phase 1 완료:** 모든 CRITICAL / HIGH / MEDIUM / LOW 항목 해결 완료

---

## 완료 요약

| 등급 | 건수 | 상태 |
|------|------|------|
| CRITICAL | 5 | ✅ 전부 완료 |
| HIGH | 6 | ✅ 전부 완료 |
| MEDIUM | 5 | ✅ 전부 완료 (M5는 Phase 2+ 트래킹) |
| LOW | 3 | ✅ 전부 완료 |

---

## 작업 순서 (의존성 기반) — 완료

```
C1 (async 아키텍처)  ✅
├─ C5 (bracket notation)  ✅
├─ H1 (변수명 prefix)     ✅
├─ C4 (NaN/Infinity)      ✅
├─ C2 (@IsDefined)        ✅
├─ H4 (serialize nested)  ✅
└─ H5 (Transform 체이닝)  ✅
C3 (checksum emit)         ✅
H2 (hasOwnProperty)        ✅
H3 (expose 검증)           ✅
H6 (데코레이터 커버리지)   ✅
M1~M5, L1~L3              ✅
```

---

## CRITICAL (5건) — ✅ 전부 완료

### C1. async 아키텍처 통합 — 단일 async API ✅

**이슈:** 현재 deserialize executor가 무조건 `async function`으로 생성되어 sync DTO에도 불필요한 async 오버헤드 발생. serialize는 async @Transform 미지원.

**PLAN 변경 (v6):** §4.12 참조

**수정 대상:**

| 파일 | 변경 내용 |
|------|----------|
| `src/types.ts` | `SealedExecutors._deserialize` 반환 타입 → `(T \| Err) \| Promise<T \| Err>`. `_serialize` → `Record \| Promise<Record>`. `_isAsync: boolean`, `_isSerializeAsync: boolean` 추가 |
| `src/seal/seal.ts` | `sealOne()`에 `analyzeAsync(merged, 'deserialize')`/`analyzeAsync(merged, 'serialize')` 호출 추가. `placeholder`에 `_isAsync`, `_isSerializeAsync` 포함. `Object.assign`에도 반영 |
| `src/seal/deserialize-builder.ts` | `buildDeserializeCode`에 `isAsync: boolean` 매개변수 추가. `isAsync=true`면 `async function` 생성 + @Transform 호출에 `await` 삽입 + nested DTO `_execs[i]._deserialize()`에 `await` 삽입. `isAsync=false`면 sync function 생성 |
| `src/seal/serialize-builder.ts` | `buildSerializeCode`에 `isAsync: boolean` 매개변수 추가. 동일 분기 로직. async @Transform에 `await` 삽입 |
| `src/functions/deserialize.ts` | 이미 `async` — 변경 없음. 단 `await`이 sync executor에도 적용되는 것 확인 |
| `src/functions/serialize.ts` | `function serialize()` → `async function serialize()`. `return await sealed._serialize(instance, options)` |
| `src/create-rule.ts` | 이미 async 감지 구현됨 (`isAsync` 플래그). 변경 없음. emit의 `await` 코드 생성도 이미 구현 |

**신규 함수 (seal.ts 또는 별도 파일):**

```typescript
function analyzeAsync(merged: RawClassMeta, direction: 'deserialize' | 'serialize'): boolean {
  for (const meta of Object.values(merged)) {
    // 1. createRule async (deserialize만)
    if (direction === 'deserialize' && meta.validation.some(rd => rd.rule.isAsync)) return true;
    // 2. @Transform AsyncFunction
    const transforms = direction === 'deserialize'
      ? meta.transform.filter(td => !td.options?.serializeOnly)
      : meta.transform.filter(td => !td.options?.deserializeOnly);
    if (transforms.some(td => td.fn.constructor.name === 'AsyncFunction')) return true;
    // 3. nested DTO async 재귀
    if (meta.type?.fn) {
      const nested = (meta.type.fn() as any)[SEALED];
      if (direction === 'deserialize' && nested?._isAsync) return true;
      if (direction === 'serialize' && nested?._isSerializeAsync) return true;
    }
  }
  return false;
}
```

**테스트 시나리오:**
- sync DTO → sync executor 생성 확인 (generated code에 `async` 없음)
- async @Transform → async executor 생성 + `await` 포함 확인
- async createRule → async executor + `await` 포함 확인
- nested DTO가 async → 부모도 async 전파 확인
- serialize async @Transform → async serialize executor 확인
- `await deserialize(SyncDto, plain)` → 정상 동작 확인
- `await serialize(instance)` → 정상 동작 확인

---

### C2. @IsDefined 로직 누락 ✅

**이슈:** `@IsDefined` 플래그가 `isOptional` 가드 억제에만 사용되고, undefined 전용 거부 로직이 없음.

**PLAN 변경 (v6):** §4.3 ② @IsDefined 처리 추가

**수정 대상:**

| 파일 | 변경 내용 |
|------|----------|
| `src/seal/deserialize-builder.ts` | `generateFieldCode()`의 `useOptionalGuard` 분기 아래에 `isDefined` 전용 분기 추가 |

**구체적 변경:**

```typescript
// 현재 (약 L200)
const useOptionalGuard = meta.flags.isOptional && !meta.flags.isDefined;

// 추가할 분기
if (meta.flags.isDefined) {
  // undefined만 거부, null/""/0은 통과
  innerCode += `if (${varName} === undefined) ${emitCtx.fail('isDefined')};\n`;
  innerCode += validationCode;
} else if (useOptionalGuard) {
  innerCode += `if (${varName} !== undefined && ${varName} !== null) {\n`;
  innerCode += validationCode;
  innerCode += '}\n';
} else {
  innerCode += validationCode;
}
```

**테스트 시나리오:**
- `@IsDefined` + undefined 입력 → `{code: 'isDefined'}` 에러
- `@IsDefined` + null 입력 → 통과 (후속 validation으로 이동)
- `@IsDefined` + `""` 입력 → 통과
- `@IsDefined` + `0` 입력 → 통과
- `@IsDefined` + `@IsOptional` 동시 → IsDefined 우선 (optional 가드 생성 안 함)

---

### C3. isISIN / isISSN emit checksum 누락 ✅

**이슈:** `isISIN`과 `isISSN`의 emit 함수가 정규식만 검사하고 Luhn/mod-11 checksum 검증을 누락.

**수정 대상:**

| 파일 | 변경 내용 |
|------|----------|
| `src/rules/string.ts` | `isISIN.emit()`과 `isISSN.emit()`에 checksum 코드 추가 |

**수정 방식 (2가지 중 택 1):**

**방식 A — validate 함수를 refs로 등록 (간단, 정확):**
```typescript
// isISIN
emit(v, ctx) {
  const i = ctx.addRef(isISIN);  // validate 함수 통째로
  return `if(!_refs[${i}](${v})) ${ctx.fail('isISIN')};`;
}
```
→ 장점: validate와 emit 결과 100% 동등. 구현 간단.
→ 단점: 함수 호출 오버헤드 (T0/T1 → T3 격하). isISIN/isISSN은 사용 빈도 낮아 무시할 수 있음.

**방식 B — checksum 코드 인라인 (최적):**
→ Luhn/mod-11 알고리즘을 emit 코드로 직접 펼침. isCreditCard.emit()과 동일 패턴.
→ 장점: 함수 호출 0.
→ 단점: 코드 복잡도 증가.

**권장:** 방식 A (간단, 정확). 나중에 성능이 중요해지면 방식 B로 전환.

**테스트 시나리오:**
- 유효 ISIN (regex + checksum 통과) → pass
- regex 통과 + checksum 실패 ISIN → fail (이게 핵심 — 현재 emit은 통과시킴)
- 유효 ISSN → pass
- regex 통과 + check digit 실패 ISSN → fail

---

### C4. 숫자 타입 게이트 NaN/Infinity 하드코딩 제거 ✅

**이슈:** `deserialize-builder.ts`의 number 타입 게이트가 `typeof !== 'number' || isNaN(v) || !isFinite(v)`로 NaN/Infinity를 무조건 거부.

**현재 코드 위치:** `deserialize-builder.ts` L361 부근
```typescript
gateCondition = `typeof ${varName} !== 'number' || isNaN(${varName}) || !isFinite(${varName})`;
```

**수정 대상:**

| 파일 | 변경 내용 |
|------|----------|
| `src/seal/deserialize-builder.ts` | number 타입 게이트 → `typeof v !== 'number'`만. NaN/Infinity 검사 제거 |
| `src/rules/number.ts` | `isNumber` 규칙에 옵션 추가: `{ allowNaN?: boolean, allowInfinity?: boolean }` (기본 둘 다 false) |
| `src/decorators/typechecker.ts` | `@IsNumber(options?)` 데코레이터에 옵션 전달 |

**isNumber 규칙 변경:**
```typescript
// 현재: typeof만 검사
// 변경: 옵션에 따라 조건부 검사
function isNumber(opts?: { allowNaN?: boolean; allowInfinity?: boolean }): EmittableRule {
  const fn = (v: unknown) => {
    if (typeof v !== 'number') return false;
    if (!opts?.allowNaN && Number.isNaN(v)) return false;
    if (!opts?.allowInfinity && !Number.isFinite(v)) return false;
    return true;
  };
  fn.emit = (v, ctx) => {
    let cond = `typeof ${v} !== 'number'`;
    if (!opts?.allowNaN) cond += ` || ${v} !== ${v}`;
    if (!opts?.allowInfinity) cond += ` || ${v} === Infinity || ${v} === -Infinity`;
    return `if (${cond}) ${ctx.fail('isNumber')};`;
  };
  // ...
}
```

→ 타입 게이트에서 NaN/Infinity 제거. isNumber.emit()이 자체적으로 처리.

**테스트 시나리오:**
- `@IsNumber()` + NaN 입력 → fail
- `@IsNumber()` + Infinity 입력 → fail
- `@IsNumber({ allowNaN: true })` + NaN → pass
- `@IsNumber({ allowInfinity: true })` + Infinity → pass
- number 타입 게이트만 (isNumber 없이 @Min/@Max만) → NaN/Infinity도 typeof 통과

---

### C5. Bracket Notation + 금지 프로퍼티명 ✅

**이슈:**
1. 생성 코드에서 `_out.${fieldKey}`, `instance.${fieldKey}` dot notation 사용 → prototype pollution 가능
2. `__proto__`, `constructor`, `prototype` 같은 필드명 허용

**PLAN 변경 (v6):** §4.13 참조

**수정 대상:**

| 파일 | 변경 내용 |
|------|----------|
| `src/seal/deserialize-builder.ts` | 모든 `_out.${fieldKey}` → `__bk$out[${JSON.stringify(fieldKey)}]`. `instance.${fieldKey}` → `instance[${JSON.stringify(fieldKey)}]` |
| `src/seal/serialize-builder.ts` | 동일하게 bracket notation 적용 |
| `src/seal/seal.ts` | `sealOne()`에 banned names 검사 추가: `__proto__`, `constructor`, `prototype` |

**전체 치환 대상 패턴:**
```
_out.${fieldKey}     → __bk$out[${JSON.stringify(fieldKey)}]
instance.${fieldKey} → instance[${JSON.stringify(fieldKey)}]
_out.${outputKey}    → __bk$out[${JSON.stringify(outputKey)}]  (이미 일부 bracket 사용 중)
```

**테스트 시나리오:**
- `__proto__` 필드명 → `SealError` throw
- `constructor` 필드명 → `SealError` throw
- 정상 필드명 → bracket notation으로 생성된 코드 확인
- 특수문자 필드명 (`foo-bar`, `with space`) → 정상 동작

---

## HIGH (6건) — ✅ 전부 완료

### H1. 생성 코드 변수명 충돌 ✅

**이슈:** 내부 변수 `_out`, `_errors`, `_groups`가 DTO 필드 `out`, `errors`, `groups`와 충돌 가능.

**PLAN 변경 (v6):** §4.13.3 참조

**수정 대상:** `src/seal/deserialize-builder.ts`, `src/seal/serialize-builder.ts`

**규칙:**

| 현재 | 변경 후 |
|------|---------|
| `_out` | `__bk$out` |
| `_errors` | `__bk$errors` |
| `_groups` | `__bk$groups` |
| `_${fieldKey}` (필드 변수) | `__bk$f_${fieldKey}` |
| `_mark${key}` (마커) | `__bk$mark_${fieldKey}` |
| `_r${key}`, `_arr${key}` 등 (중첩) | `__bk$r_${key}`, `__bk$arr_${key}` |

**참고:** C1, C5와 함께 builder 리팩토링 시 일괄 적용.

---

### H2. mergeInheritance hasOwnProperty 누락 ✅

**이슈:** `(current as any)[RAW]`가 프로토타입 체인의 RAW도 읽어 같은 메타데이터가 중복 병합됨.

**PLAN 변경 (v6):** §4.2에 `Object.hasOwn` 반영 완료

**수정 대상:** `src/seal/seal.ts` L130 부근

```typescript
// 현재
if ((current as any)[RAW]) chain.push(current);
// 변경
if (Object.hasOwn(current as object, RAW)) chain.push(current);
```

**테스트 시나리오:**
- 부모에만 데코레이터 → chain에 부모만 포함
- 자식에 데코레이터 없이 상속 → chain에 부모만 (자식 X)
- 부모+자식 둘 다 데코레이터 → chain에 둘 다 포함
- 같은 RAW 중복 병합 안 되는 것 확인

---

### H3. validateExposeStacks 불완전 ✅

**이슈:** `deserializeOnly + serializeOnly` 동시 검사만 구현. PLAN §3.3의 같은 방향 + groups 없음 복수, 같은 방향 + groups 겹침 검증 미구현.

**수정 대상:** `src/seal/expose-validator.ts`

**추가할 검증:**
```typescript
// 1. 같은 방향 + groups 없음 + 복수 → ERROR
// 2. 같은 방향 + groups 겹침 → ERROR
// 3. 다른 방향 → OK
// 4. 같은 방향 + 겹치지 않는 groups → OK
```

**에러 메시지 형식:** PLAN §3.3 준수
```
@Expose conflict on 'UserDto.name': 2 @Expose stacks with 'deserializeOnly' direction and overlapping groups []. Each direction must have at most one @Expose per group set.
```

---

### H4. serialize에서 nested DTO 미처리 ✅

**이슈:** `@Type`으로 지정된 중첩 DTO의 serialize executor를 재귀 호출하지 않음. `instance.field` 그대로 할당.

**수정 대상:**

| 파일 | 변경 내용 |
|------|----------|
| `src/seal/serialize-builder.ts` | `TypeDef` 존재 시 `_execs[i]._serialize(instance[key], _opts)` 호출 코드 생성 |
| `src/seal/seal.ts` | serialize-builder에 `execs` 배열 주입 (현재 deserialize만 사용 중) |

**코드 생성 예시:**
```javascript
// 단일 nested
__bk$out["address"] = _execs[0]._serialize(instance["address"], _opts);

// 배열 nested
__bk$out["items"] = instance["items"].map(function(__bk$item) {
  return _execs[0]._serialize(__bk$item, _opts);
});

// async serialize면 await 삽입
__bk$out["address"] = await _execs[0]._serialize(instance["address"], _opts);
```

---

### H5. @Transform 체이닝 (serialize) ✅

**이슈:** `serialize-builder.ts`에서 `serTransforms[0]`만 사용. 복수 @Transform 시 첫 번째만 적용.

**수정 대상:** `src/seal/serialize-builder.ts` `buildSerializeOutputExpr()` 함수

**현재:**
```typescript
const td = serTransforms[0]; // 첫 번째만
```

**변경:**
```typescript
let valueExpr = `instance[${JSON.stringify(fieldKey)}]`;
for (const td of serTransforms) {
  const refIdx = refs.length;
  refs.push(td.fn);
  const callExpr = `_refs[${refIdx}]({value:${valueExpr},key:${JSON.stringify(fieldKey)},obj:instance,type:'serialize'})`;
  if (td.fn.constructor.name === 'AsyncFunction') {
    valueExpr = `(await ${callExpr})`;
  } else {
    valueExpr = callExpr;
  }
}
code += `${outputTarget} = ${valueExpr};`;
```

**참고:** deserialize-builder는 이미 전체 순회 (`for (const td of dsTransforms)`, L248-L252). serialize만 수정 필요.

---

### H6. 데코레이터 테스트 커버리지 부족 ✅

**이슈:** 대부분 데코레이터 파일 커버리지 0~33%.

**수정 대상:** 각 데코레이터 파일별 spec 보강

| 파일 | 현재 커버리지 | 필요 spec |
|------|-------------|----------|
| `src/decorators/common.ts` | 33.33% | common.spec.ts 보강 |
| `src/decorators/typechecker.ts` | 00.00% | typechecker.spec.ts 신규 |
| `src/decorators/transform.ts` | 00.00% | transform.spec.ts 신규 |
| `src/decorators/number.ts` | 00.00% | number.spec.ts 신규 |
| `src/decorators/date.ts` | 00.00% | date.spec.ts 신규 |
| `src/decorators/string.ts` | 00.00% | string.spec.ts 신규 |
| `src/decorators/array.ts` | 00.00% | array.spec.ts 신규 |
| `src/decorators/object.ts` | 00.00% | object.spec.ts 신규 |

**테스트 관점:**
1. 메타데이터 수집 검증: 데코레이터 적용 후 `Class[RAW]`에 올바른 메타 저장되는지
2. 통합 테스트: seal → deserialize까지 end-to-end 동작

---

## MEDIUM (5건) — ✅ 전부 완료

### M1. isISO8601 emit regex 정합성 ✅

**이슈:** emit 함수의 정규식이 validate 함수의 정규식보다 느슨할 수 있음.

**수정 대상:** `src/rules/string.ts` — `isISO8601`의 emit

**수정:** emit과 validate가 동일한 RegExp를 사용하도록 통일.

---

### M2. circular-analyzer discriminator 커버리지 ✅

**이슈:** discriminator subTypes 탐색 코드는 이미 구현되어 있으나 (`circular-analyzer.ts` L45-L48), 해당 경로의 테스트 커버리지가 미달 (89.66%).

**수정 대상:** `src/seal/circular-analyzer.spec.ts` — discriminator 경로 테스트 추가

---

### M3. 코드 생성 debug 옵션 ✅

**이슈:** seal() 생성 코드를 디버깅하기 어려움.

**수정 대상:**

| 파일 | 변경 내용 |
|------|----------|
| `src/interfaces.ts` | `SealOptions.debug?: boolean` 추가 |
| `src/types.ts` | `SealedExecutors._source?: { deserialize: string; serialize: string }` 추가 |
| `src/seal/deserialize-builder.ts` | debug=true면 body를 `_source.deserialize`에 저장 |
| `src/seal/serialize-builder.ts` | debug=true면 body를 `_source.serialize`에 저장 |

---

### M4. groups 런타임 필터링 (validation groups) ✅

**이슈:** expose groups는 구현됨 (필드 표시 여부). 하지만 validation `RuleDef.groups` — 특정 groups에서만 실행되는 규칙 — 의 런타임 필터링이 미구현.

**수정 대상:** `src/seal/deserialize-builder.ts` — 규칙별 groups 체크 코드 생성

```javascript
// RuleDef.groups가 존재하면 런타임 체크 삽입
if (!__bk$groups || ['admin'].some(function(g){return __bk$groups.indexOf(g)!==-1;})) {
  // 이 규칙 실행
}
```

---

### M5. Phase 2+ 기능 미구현 (Phase 2 트래킹)

**이슈:** PLAN §7 enableImplicitConversion, §6 AOT 통합, §8 discriminator 일부 등 Phase 2+ 기능 미착수.

**대응:** Phase 1 완성도 확보가 우선. 이슈로만 트래킹.

---

## LOW (3건) — ✅ 전부 완료

### L1. globalRegistry 메모리 ✅

**이슈:** `Set<Function>`은 등록된 클래스를 GC 대상에서 제외. `WeakSet` 전환 불가 (seal() 시 이터레이션 필요).

**대응:** `unregister(cls)` API 추가 또는 문서에 "seal 후 registry는 GC 대상 아님" 명시.

---

### L2. SealError 메시지에 클래스명 누락 ✅

**이슈:** seal 중 에러 발생 시 어느 클래스에서 발생했는지 파악 불가.

**수정 대상:** `src/seal/seal.ts` — `sealOne()` 내부의 `SealError` / `validateExposeStacks()` 호출부에 className 전달.

---

### L3. testing.ts unseal 정합성 ✅

**이슈:** `unseal()`이 `SEALED` 삭제 + `_sealed` 리셋은 하지만, registry와의 정합성 재확인 필요.

**대응:** 현재 구현 재확인. `_sealed` 리셋 확인됨. 추가 작업 필요 없을 수 있음.

---

## 참고: 현재 코드에서 이미 올바르게 구현된 것

| 항목 | 상태 |
|------|------|
| `createRule` async 감지 (`isAsync` 플래그) | ✅ 구현됨 |
| `createRule` emit에서 `await` 코드 생성 | ✅ 구현됨 |
| `seal()` 2회 호출 방지 | ✅ 구현됨 |
| 순환 참조 정적 분석 (auto 모드) | ✅ 구현됨 |
| placeholder 패턴 (순환 참조 무한재귀 방지) | ✅ 구현됨 |
| `@Expose` name 매핑 (방향별) | ✅ 구현됨 |
| `@Exclude` 방향별 skip | ✅ 구현됨 |
| `@ValidateIf` 조건부 검증 | ✅ 구현됨 |
| `@ValidateNested` + `@Type` (배열/단일/discriminator) | ✅ 구현됨 |
| `each: true` 배열/Set/Map 순회 | ✅ 구현됨 |
| exposeDefaultValues | ✅ 구현됨 |
| stopAtFirstError / collectErrors 모드 | ✅ 구현됨 |
| sourceURL 주석 | ✅ 구현됨 |
| `testing.ts` unseal() | ✅ 구현됨 |
| message/context 옵션 (RuleDef) | ✅ 구현됨 |
| deserialize @Transform 체이닝 (복수) | ✅ 구현됨 |
| input guard preamble | ✅ 구현됨 |
| WeakSet circular guard | ✅ 구현됨 |
