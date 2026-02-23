# @zipbul/baker

> AOT-equivalent validate + transform for Bun — **no reflect-metadata, zero dependencies, inline code generation**

## 소개

`@zipbul/baker`는 class-validator / class-transformer 호환 데코레이터 DX를 제공하면서
`new Function()` 기반 인라인 코드 생성으로 AOT와 동급 성능을 달성하는 **validate + transform 통합 패키지**입니다.

- `reflect-metadata` 불필요
- 외부 의존 없음 (`@zipbul/result`는 모노레포 내부 전용)
- Bun 전용 (ESM, `experimentalDecorators: true`)

---

## 설치

```bash
bun add @zipbul/baker
```

`tsconfig.json`에 다음 설정이 필요합니다.

```json
{
  "compilerOptions": {
    "experimentalDecorators": true
  }
}
```

---

## 빠른 시작

### 1. DTO 클래스 정의

```typescript
import { IsString, IsInt, IsEmail, Min, Max } from '@zipbul/baker/decorators';

class CreateUserDto {
  @IsString()
  name!: string;

  @IsInt()
  @Min(0)
  @Max(120)
  age!: number;

  @IsEmail()
  email!: string;
}
```

### 2. 앱 시작 시 seal()

```typescript
import { seal } from '@zipbul/baker';

// 앱 초기화 — 전역 레지스트리의 모든 DTO를 봉인
seal();
```

### 3. 요청마다 deserialize()

```typescript
import { deserialize, BakerValidationError } from '@zipbul/baker';

try {
  const user = await deserialize(CreateUserDto, req.body);
  // user는 CreateUserDto 인스턴스 — 검증 + 변환 완료
} catch (e) {
  if (e instanceof BakerValidationError) {
    // e.errors: BakerError[] — 모든 필드 에러
    console.log(e.errors);
  }
}
```

### serialize()

```typescript
import { serialize } from '@zipbul/baker';

const plain = await serialize(CreateUserDto, instance);
// plain: Record<string, unknown>
```

---

## Validation Options

모든 validation 데코레이터는 마지막 인자로 `ValidationOptions`를 받습니다.

```typescript
interface ValidationOptions {
  /** 배열의 각 원소에 규칙 적용 */
  each?: boolean;
  /** 이 규칙이 속하는 그룹 목록 */
  groups?: string[];
  /** 검증 실패 시 BakerError.message에 포함할 값 */
  message?: string | ((args: { property: string; value: unknown; constraints: unknown[] }) => string);
  /** 검증 실패 시 BakerError.context에 포함할 임의 값 */
  context?: unknown;
}
```

```typescript
class UserDto {
  @IsString({ message: '이름은 문자열이어야 합니다' })
  name!: string;

  @IsInt({ message: (args) => `${args.property}는 정수여야 합니다`, context: { httpStatus: 400 } })
  age!: number;
}
```

---

## BakerError

```typescript
interface BakerError {
  readonly path: string;     // 필드 경로 (중첩: 'user.address.city')
  readonly code: string;     // 에러 코드 (예: 'isString', 'min', 'isEmail')
  readonly message?: string; // 사용자 정의 메시지 (message 옵션 설정 시만 포함)
  readonly context?: unknown; // 사용자 정의 컨텍스트 (context 옵션 설정 시만 포함)
}
```

---

## 데코레이터 목록

### Type Checkers

| 데코레이터 | 설명 |
|---|---|
| `@IsString()` | `typeof === 'string'` |
| `@IsNumber(opts?)` | `typeof === 'number'` + NaN/Infinity 검사 |
| `@IsInt()` | 정수 검사 |
| `@IsBoolean()` | `typeof === 'boolean'` |
| `@IsDate()` | `instanceof Date && !isNaN` |
| `@IsEnum(enumObj)` | 열거형 값 검사 |
| `@IsArray()` | `Array.isArray()` |
| `@IsObject()` | `typeof === 'object'` + null/Array 제외 |

### Common

| 데코레이터 | 설명 |
|---|---|
| `@IsDefined()` | `!== undefined && !== null` |
| `@IsOptional()` | 값이 없으면 이후 규칙 건너뜀 |
| `@IsNotEmpty()` | `!== undefined && !== null && !== ''` |
| `@IsEmpty()` | `=== undefined \|\| === null \|\| === ''` |
| `@Equals(val)` | `=== val` |
| `@NotEquals(val)` | `!== val` |
| `@ValidateNested()` | 중첩 DTO 검증 |
| `@ValidateIf(fn)` | 조건부 검증 |

### Number

| 데코레이터 | 설명 |
|---|---|
| `@Min(n)` | `value >= n` |
| `@Max(n)` | `value <= n` |
| `@IsPositive()` | `value > 0` |
| `@IsNegative()` | `value < 0` |
| `@IsInRange(min, max)` | `min <= value <= max` |

### String

| 데코레이터 | 설명 |
|---|---|
| `@MinLength(n)` | 최소 길이 |
| `@MaxLength(n)` | 최대 길이 |
| `@Length(min, max)` | 길이 범위 |
| `@Contains(seed)` | 부분 문자열 포함 |
| `@NotContains(seed)` | 부분 문자열 미포함 |
| `@IsAlpha()` | 알파벳만 |
| `@IsAlphanumeric()` | 알파벳 + 숫자만 |
| `@IsNumeric()` | 숫자 문자열 |
| `@IsEmail(opts?)` | 이메일 형식 |
| `@IsURL(opts?)` | URL 형식 |
| `@IsUUID(version?)` | UUID v1/v2/v3/v4/v5/any |
| `@IsIP(version?)` | IPv4 / IPv6 |
| `@IsMACAddress()` | MAC 주소 |
| `@IsISBN(version?)` | ISBN-10 / ISBN-13 |
| `@IsISIN()` | ISIN |
| `@IsIBAN()` | IBAN |
| `@IsJSON()` | JSON 파싱 가능 문자열 |
| `@IsBase64()` | Base64 인코딩 |
| `@IsBase32()` | Base32 인코딩 |
| `@IsBase58()` | Base58 인코딩 |
| `@IsHexColor()` | 16진수 색상 코드 |
| `@IsHSL()` | HSL 색상 |
| `@IsRgbColor()` | RGB 색상 |
| `@IsHexadecimal()` | 16진수 문자열 |
| `@IsBIC()` | BIC/SWIFT 코드 |
| `@IsISRC()` | ISRC 코드 |
| `@IsEAN()` | EAN 바코드 |
| `@IsMimeType()` | MIME 타입 |
| `@IsMagnetURI()` | Magnet URI |
| `@IsCreditCard()` | 신용카드 번호 |
| `@IsHash(algorithm)` | 해시 (`md5\|sha1\|sha256\|sha512` 등) |
| `@IsRFC3339()` | RFC 3339 날짜 |
| `@IsMilitaryTime()` | 24시간 형식 (`HH:MM`) |
| `@IsLatitude()` | 위도 (-90 ~ 90) |
| `@IsLongitude()` | 경도 (-180 ~ 180) |
| `@IsEthereumAddress()` | 이더리움 주소 |
| `@IsBtcAddress()` | 비트코인 주소 (P2PKH/P2SH/bech32) |
| `@IsISO4217CurrencyCode()` | ISO 4217 통화 코드 |
| `@IsPhoneNumber()` | E.164 국제 전화번호 |
| `@IsStrongPassword(opts?)` | 강력한 패스워드 |
| `@IsTaxId(locale)` | 국가별 납세자 번호 |

### Date

| 데코레이터 | 설명 |
|---|---|
| `@MinDate(date)` | 최소 날짜 |
| `@MaxDate(date)` | 최대 날짜 |

### Array

| 데코레이터 | 설명 |
|---|---|
| `@ArrayContains(values)` | 배열이 주어진 요소들을 모두 포함 |
| `@ArrayNotContains(values)` | 배열이 주어진 요소들을 포함하지 않음 |
| `@ArrayMinSize(n)` | 배열 최소 길이 |
| `@ArrayMaxSize(n)` | 배열 최대 길이 |
| `@ArrayUnique()` | 배열 중복 없음 |
| `@ArrayNotEmpty()` | 빈 배열 아님 |

### Locale-specific

| 데코레이터 | 설명 |
|---|---|
| `@IsMobilePhone(locale)` | 국가별 이동전화 번호 |
| `@IsPostalCode(locale)` | 국가별 우편번호 |
| `@IsIdentityCard(locale)` | 국가별 신분증 번호 |
| `@IsPassportNumber(locale)` | 국가별 여권 번호 |

### Transform

| 데코레이터 | 설명 |
|---|---|
| `@Transform(fn, opts?)` | 커스텀 변환 함수 |

### Type

| 데코레이터 | 설명 |
|---|---|
| `@Type(fn)` | 중첩 DTO 타입 지정 + 변환 |

---

## 배열 / Set / Map 검증 (each)

`each: true` 옵션을 사용하면 Array, Set, Map의 각 원소에 규칙을 적용합니다.

```typescript
class TagsDto {
  @IsString({ each: true })
  tags!: string[];   // 또는 Set<string>, Map<string, string>
}
```

---

## 커스텀 규칙

`createRule()` 헬퍼로 `EmittableRule`을 직접 생성할 수 있습니다.

```typescript
import { createRule } from '@zipbul/baker';

const isPositiveInt = createRule({
  name: 'isPositiveInt',
  validate: (value) => Number.isInteger(value) && (value as number) > 0,
  emit: (varName, ctx) =>
    `if (!Number.isInteger(${varName}) || ${varName} <= 0) ${ctx.fail('isPositiveInt')};`,
});
```

---

## AOT 모드 (zipbul CLI)

zipbul CLI를 사용하면 `seal()`을 런타임에 호출하지 않아도 됩니다.  
CLI가 빌드 시점에 코드 파일을 생성하고, `/stubs` 엔트리의 빈 스텁 데코레이터를 사용합니다.

```typescript
// AOT 모드에서는 /stubs 임포트
import { IsString } from '@zipbul/baker/stubs';
```

---

## 그룹 기반 검증

```typescript
class UserDto {
  @IsString({ groups: ['create'] })
  name!: string;

  @IsEmail({ groups: ['create', 'update'] })
  email!: string;
}

const user = await deserialize(UserDto, body, { groups: ['create'] });
```

---

## 라이선스

MIT © [Junhyung Park](https://github.com/parkrevil)
