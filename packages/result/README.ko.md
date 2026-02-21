# @zipbul/result

[English](./README.md) | **한국어**

[![npm](https://img.shields.io/npm/v/@zipbul/result)](https://www.npmjs.com/package/@zipbul/result)
![coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/parkrevil/3965fb9d1fe2d6fc5c321cb38d88c823/raw/result-coverage.json)

예외(exception) 없이 에러를 처리하는 경량 Result 타입입니다.
클래스로 감싸지 않고 평범한 유니온 값(`T | Err<E>`)을 반환합니다 — 런타임 오버헤드 제로, 완전한 타입 안전성.

> throw 없음, try/catch 없음, 래퍼 클래스 없음. 값만 있습니다.

<br>

## 📦 설치

```bash
bun add @zipbul/result
```

<br>

## 💡 핵심 개념

`throw`를 사용하는 전통적 에러 처리는 제어 흐름을 끊고, 타입 정보를 잃으며, 호출자에게 `try/catch` 추측 게임을 강요합니다.

```typescript
// ❌ Throw — 호출자는 뭐가 올지 전혀 모릅니다
function parseConfig(raw: string): Config {
  if (!raw) throw new Error('empty input');      // 타입이 뭔가요? 알 수 없음.
  if (!valid(raw)) throw new ValidationError();  // 조용히 상위로 전파됨.
  return JSON.parse(raw);
}

try {
  const config = parseConfig(input);
} catch (e) {
  // `e`가 뭔가요? Error? ValidationError? JSON.parse의 SyntaxError?
  // TypeScript는 여기서 도와줄 수 없습니다 — `e`는 `unknown`입니다.
}
```

```typescript
// ✅ Result — 타입 안전, 명시적, 놀라움 없음
import { err, isErr, type Result } from '@zipbul/result';

function parseConfig(raw: string): Result<Config, string> {
  if (!raw) return err('empty input');
  if (!valid(raw)) return err('validation failed');
  return JSON.parse(raw);
}

const result = parseConfig(input);

if (isErr(result)) {
  console.error(result.data); // string — TypeScript가 타입을 압니다
} else {
  console.log(result.host);   // Config — 완전히 좁혀짐
}
```

<br>

## 🚀 빠른 시작

```typescript
import { err, isErr, type Result } from '@zipbul/result';

interface User {
  id: number;
  name: string;
}

function findUser(id: number): Result<User, string> {
  if (id <= 0) return err('Invalid ID');

  const user = db.get(id);
  if (!user) return err('User not found');

  return user;
}

const result = findUser(42);

if (isErr(result)) {
  // result는 Err<string>
  console.error(`실패: ${result.data}`);
} else {
  // result는 User
  console.log(`안녕하세요, ${result.name}`);
}
```

<br>

## 📚 API 레퍼런스

### `err()`

불변(immutable) `Err` 값을 생성합니다. 절대 throw하지 않습니다.

```typescript
import { err } from '@zipbul/result';
```

| 오버로드 | 반환 | 설명 |
|:---------|:-----|:-----|
| `err()` | `Err<never>` | 데이터 없는 에러 |
| `err<E>(data: E)` | `Err<E>` | 데이터가 첨부된 에러 |

```typescript
// 데이터 없음 — 단순 신호
const e1 = err();
// e1.data → never (접근 불가)
// e1.stack → 캡처된 스택 트레이스

// 데이터 포함 — 에러 상세 정보 전달
const e2 = err('not found');
// e2.data → 'not found'
// e2.stack → 캡처된 스택 트레이스

// 풍부한 에러 객체
const e3 = err({ code: 'TIMEOUT', retryAfter: 3000 });
// e3.data.code → 'TIMEOUT'
```

반환된 `Err`의 프로퍼티:

| 프로퍼티 | 타입 | 설명 |
|:---------|:-----|:-----|
| `data` | `E` | 첨부된 에러 데이터 |
| `stack` | `string` | `err()` 호출 지점에서 캡처된 스택 트레이스 |

> **불변성** — 모든 `Err`는 `Object.freeze()`됩니다. strict mode에서 프로퍼티를 수정하면 `TypeError`가 발생합니다.

<br>

### `isErr()`

값을 `Err<E>`로 좁히는 타입 가드입니다.

```typescript
import { isErr } from '@zipbul/result';
```

```typescript
function isErr<E = unknown>(value: unknown): value is Err<E>
```

- `value`가 null이 아닌 객체이고, 마커 프로퍼티가 `true`인 경우에만 `true`를 반환합니다.
- **절대 throw하지 않습니다** — `null`, `undefined`, 원시값, 예외를 내부적으로 처리합니다.

```typescript
const result: Result<number, string> = doSomething();

if (isErr(result)) {
  // result: Err<string>
  console.error(result.data);
} else {
  // result: number
  console.log(result + 1);
}
```

> **제네릭 `E` 주의사항** — `isErr<E>()`는 타입 단언만 제공합니다. `data`의 형태를 런타임에서 검증하지 않습니다. 호출자가 제네릭이 실제 에러 타입과 일치하는지 보장해야 합니다.

<br>

### `Result<T, E>`

평범한 유니온 타입 — 래퍼 클래스가 아닙니다.

```typescript
type Result<T, E = never> = T | Err<E>;
```

| 파라미터 | 기본값 | 설명 |
|:---------|:-------|:-----|
| `T` | — | 성공 값 타입 |
| `E` | `never` | 에러 데이터 타입 |

```typescript
// 단순 — 에러 데이터 없음
type MayFail = Result<Config>;

// 에러 데이터 포함
type ParseResult = Result<Config, string>;

// 풍부한 에러 타입
type ApiResult = Result<User, { code: string; message: string }>;
```

<br>

### `Err<E>`

`err()`가 반환하는 에러 타입입니다.

```typescript
type Err<E = never> = {
  stack: string;
  data: E;
};
```

> 식별에 사용되는 마커 프로퍼티는 의도적으로 타입에서 제외됩니다. `err()`가 런타임에 내부적으로 추가하고, `isErr()`를 통해서만 판별합니다 — 이렇게 하면 공개 API 표면이 깔끔해지고, 소비자가 구현 세부사항에 의존하는 것을 방지합니다.

<br>

### 마커 키(Marker Key)

마커 키는 `Err` 객체를 식별하는 데 사용되는 숨겨진 고유 프로퍼티입니다. 충돌에 강한 문자열이 기본값입니다.

```typescript
import { DEFAULT_MARKER_KEY, getMarkerKey, setMarkerKey } from '@zipbul/result';
```

| 내보내기 | 타입 | 설명 |
|:---------|:-----|:-----|
| `DEFAULT_MARKER_KEY` | `string` | `'__$$e_9f4a1c7b__'` — 기본 키 |
| `getMarkerKey()` | `() => string` | 현재 마커 키 반환 |
| `setMarkerKey(key)` | `(key: string) => void` | 마커 키 변경 |

```typescript
// 독립 모듈 간 감지 리셋
import { setMarkerKey, getMarkerKey } from '@zipbul/result';

setMarkerKey('__my_app_err__');
console.log(getMarkerKey()); // '__my_app_err__'
```

> **검증** — `setMarkerKey()`는 키가 빈 문자열이거나 공백만으로 이루어진 경우 `TypeError`를 던집니다.
>
> **주의** — 마커 키를 변경하면 `isErr()`가 이전 키로 생성된 `Err` 객체를 더 이상 인식하지 못합니다. 독립 모듈 간 에러 도메인을 분리해야 할 때만 변경하세요.

<br>

## 🔬 고급 사용법

### Result를 반환하는 함수

`Result`로 함수 시그니처를 정의하면 에러 경로가 타입 시스템에서 명시적으로 드러납니다.

```typescript
import { err, isErr, type Result } from '@zipbul/result';

interface ValidationError {
  field: string;
  message: string;
}

function validate(input: unknown): Result<ValidData, ValidationError> {
  if (!input || typeof input !== 'object') {
    return err({ field: 'root', message: 'Expected an object' });
  }
  // ... 검증 로직
  return input as ValidData;
}

const result = validate(body);
if (isErr(result)) {
  return Response.json({ error: result.data }, { status: 400 });
}
// result는 여기서 ValidData
```

### 결과 체이닝

`Result`는 평범한 유니온이므로 `.map()`이나 `.flatMap()`이 없습니다. 표준 제어 흐름을 사용하세요:

```typescript
function processOrder(orderId: string): Result<Receipt, string> {
  const order = findOrder(orderId);
  if (isErr(order)) return order; // 전파

  const payment = chargePayment(order);
  if (isErr(payment)) return payment; // 전파

  return generateReceipt(order, payment);
}
```

> 이것은 의도된 설계입니다. `.map()` / `.flatMap()`이 있는 클래스는 런타임 비용을 추가하고 특정 합성 스타일을 강요합니다. 평범한 값 + `isErr()`는 표준 `if`, `switch`, early return 등 원하는 패턴을 자유롭게 사용할 수 있게 합니다.

### 비동기 결과

`Promise`와 자연스럽게 작동합니다:

```typescript
async function fetchUser(id: number): Promise<Result<User, ApiError>> {
  try {
    const res = await fetch(`/api/users/${id}`);
    if (!res.ok) return err({ code: res.status, message: res.statusText });
    return await res.json();
  } catch {
    return err({ code: 0, message: 'Network error' });
  }
}
```

### 스택 트레이스

모든 `Err`는 생성 시점에 스택 트레이스를 캡처하여, `throw` 없이 디버깅이 가능합니다:

```typescript
const e = err('something went wrong');
console.log(e.stack);
// Error
//     at err (/.../err.ts:22:18)
//     at validate (/.../validate.ts:15:12)
//     at handleRequest (/.../server.ts:8:20)
```

<br>

## 🔌 프레임워크 연동 예시

<details>
<summary><b>Bun.serve</b></summary>

```typescript
import { err, isErr, type Result } from '@zipbul/result';

interface AppError {
  code: string;
  message: string;
}

function parseBody(request: Request): Promise<Result<Payload, AppError>> {
  // ... Result 반환
}

Bun.serve({
  async fetch(request) {
    const body = await parseBody(request);

    if (isErr(body)) {
      return Response.json(
        { error: body.data.code, message: body.data.message },
        { status: 400 },
      );
    }

    // body는 Payload
    return Response.json({ ok: true, data: process(body) });
  },
  port: 3000,
});
```

</details>

<details>
<summary><b>@zipbul/cors와 함께</b></summary>

```typescript
import { Cors, CorsAction } from '@zipbul/cors';
import { isErr } from '@zipbul/result';

const corsResult = Cors.create({
  origin: 'https://app.example.com',
  credentials: true,
});

// Cors.create()는 Result<Cors, CorsError>를 반환합니다
if (isErr(corsResult)) {
  throw new Error(`CORS 설정 에러: ${corsResult.data.message}`);
}

const cors = corsResult;

// cors.handle()는 Promise<Result<CorsResult, CorsError>>를 반환합니다
const result = await cors.handle(request);

if (isErr(result)) {
  return new Response('Internal Error', { status: 500 });
}
```

</details>

<br>

## 📄 라이선스

MIT
