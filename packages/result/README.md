# @zipbul/result

**English** | [한국어](./README.ko.md)

[![npm](https://img.shields.io/npm/v/@zipbul/result)](https://www.npmjs.com/package/@zipbul/result)
![coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/parkrevil/3965fb9d1fe2d6fc5c321cb38d88c823/raw/result-coverage.json)

A lightweight Result type for error handling without exceptions.
Returns plain union values (`T | Err<E>`) instead of wrapping in classes — zero runtime overhead, full type safety.

> No throw, no try/catch, no wrapper class. Just values.

<br>

## 📦 Installation

```bash
bun add @zipbul/result
```

<br>

## 💡 Core Concept

Traditional error handling with `throw` breaks control flow, loses type information, and forces callers into a `try/catch` guessing game.

```typescript
// ❌ Throw — caller has no idea what to expect
function parseConfig(raw: string): Config {
  if (!raw) throw new Error('empty input');      // What type? Unknown.
  if (!valid(raw)) throw new ValidationError();  // Silently propagates up.
  return JSON.parse(raw);
}

try {
  const config = parseConfig(input);
} catch (e) {
  // What is `e`? Error? ValidationError? SyntaxError from JSON.parse?
  // TypeScript cannot help you here — `e` is `unknown`.
}
```

```typescript
// ✅ Result — type-safe, explicit, no surprises
import { err, isErr, type Result } from '@zipbul/result';

function parseConfig(raw: string): Result<Config, string> {
  if (!raw) return err('empty input');
  if (!valid(raw)) return err('validation failed');
  return JSON.parse(raw);
}

const result = parseConfig(input);

if (isErr(result)) {
  console.error(result.data); // string — TypeScript knows the type
} else {
  console.log(result.host);   // Config — fully narrowed
}
```

<br>

## 🚀 Quick Start

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
  // result is Err<string>
  console.error(`Failed: ${result.data}`);
} else {
  // result is User
  console.log(`Hello, ${result.name}`);
}
```

<br>

## 📚 API Reference

### `err()`

Creates an immutable `Err` value. Never throws.

```typescript
import { err } from '@zipbul/result';
```

| Overload | Return | Description |
|:---------|:-------|:------------|
| `err()` | `Err<never>` | Error with no data |
| `err<E>(data: E)` | `Err<E>` | Error with attached data |

```typescript
// No data — simple signal
const e1 = err();
// e1.data → never (cannot access)
// e1.stack → captured stack trace

// With data — carry error details
const e2 = err('not found');
// e2.data → 'not found'
// e2.stack → captured stack trace

// Rich error objects
const e3 = err({ code: 'TIMEOUT', retryAfter: 3000 });
// e3.data.code → 'TIMEOUT'
```

Properties of the returned `Err`:

| Property | Type | Description |
|:---------|:-----|:------------|
| `data` | `E` | The attached error data |
| `stack` | `string` | Stack trace captured at `err()` call site |

> **Immutability** — every `Err` is `Object.freeze()`d. Attempting to modify properties in strict mode throws a `TypeError`.

<br>

### `isErr()`

Type guard that narrows a value to `Err<E>`.

```typescript
import { isErr } from '@zipbul/result';
```

```typescript
function isErr<E = unknown>(value: unknown): value is Err<E>
```

- Returns `true` if `value` is a non-null object with the marker property set to `true`.
- **Never throws** — handles `null`, `undefined`, primitives, and exceptions internally.

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

> **Generic `E` caveat** — `isErr<E>()` provides a type assertion only. It does not validate the shape of `data` at runtime. Callers must ensure the generic matches the actual error type.

<br>

### `Result<T, E>`

A plain union type — not a wrapper class.

```typescript
type Result<T, E = never> = T | Err<E>;
```

| Parameter | Default | Description |
|:----------|:--------|:------------|
| `T` | — | Success value type |
| `E` | `never` | Error data type |

```typescript
// Simple — no error data
type MayFail = Result<Config>;

// With error data
type ParseResult = Result<Config, string>;

// Rich error types
type ApiResult = Result<User, { code: string; message: string }>;
```

<br>

### `Err<E>`

The error type returned by `err()`.

```typescript
type Err<E = never> = {
  stack: string;
  data: E;
};
```

> The marker property used for identification is deliberately excluded from the type. It is added internally by `err()` and checked by `isErr()` — this keeps the public API surface clean and prevents consumers from depending on implementation details.

<br>

### Marker Key

The marker key is a unique hidden property used to identify `Err` objects. It defaults to a collision-resistant string.

```typescript
import { DEFAULT_MARKER_KEY, getMarkerKey, setMarkerKey } from '@zipbul/result';
```

| Export | Type | Description |
|:-------|:-----|:------------|
| `DEFAULT_MARKER_KEY` | `string` | `'__$$e_9f4a1c7b__'` — the default key |
| `getMarkerKey()` | `() => string` | Returns the current marker key |
| `setMarkerKey(key)` | `(key: string) => void` | Changes the marker key |

```typescript
// Reset detection across independent modules
import { setMarkerKey, getMarkerKey } from '@zipbul/result';

setMarkerKey('__my_app_err__');
console.log(getMarkerKey()); // '__my_app_err__'
```

> **Validation** — `setMarkerKey()` throws `TypeError` if the key is empty or whitespace-only.
>
> **Warning** — changing the marker key means `isErr()` will no longer recognize `Err` objects created with the previous key. Only change this if you need to isolate error domains across independent modules.

<br>

## 🔬 Advanced Usage

### Result-returning functions

Define function signatures with `Result` to make error paths explicit in the type system.

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
  // ... validation logic
  return input as ValidData;
}

const result = validate(body);
if (isErr(result)) {
  return Response.json({ error: result.data }, { status: 400 });
}
// result is ValidData here
```

### Chaining results

Since `Result` is a plain union, there's no `.map()` or `.flatMap()`. Use standard control flow:

```typescript
function processOrder(orderId: string): Result<Receipt, string> {
  const order = findOrder(orderId);
  if (isErr(order)) return order; // propagate

  const payment = chargePayment(order);
  if (isErr(payment)) return payment; // propagate

  return generateReceipt(order, payment);
}
```

> This is intentional. Classes with `.map()` / `.flatMap()` add runtime cost and force a specific composition style. Plain values + `isErr()` let you use standard `if`, `switch`, early return, and any other pattern you prefer.

### Async results

Works naturally with `Promise`:

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

### Stack traces

Every `Err` captures a stack trace at creation time, enabling debugging without `throw`:

```typescript
const e = err('something went wrong');
console.log(e.stack);
// Error
//     at err (/.../err.ts:22:18)
//     at validate (/.../validate.ts:15:12)
//     at handleRequest (/.../server.ts:8:20)
```

<br>

## 🔌 Framework Integration Examples

<details>
<summary><b>Bun.serve</b></summary>

```typescript
import { err, isErr, type Result } from '@zipbul/result';

interface AppError {
  code: string;
  message: string;
}

function parseBody(request: Request): Promise<Result<Payload, AppError>> {
  // ... returns Result
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

    // body is Payload
    return Response.json({ ok: true, data: process(body) });
  },
  port: 3000,
});
```

</details>

<details>
<summary><b>With @zipbul/cors</b></summary>

```typescript
import { Cors, CorsAction } from '@zipbul/cors';
import { isErr } from '@zipbul/result';

const corsResult = Cors.create({
  origin: 'https://app.example.com',
  credentials: true,
});

// Cors.create() returns Result<Cors, CorsError>
if (isErr(corsResult)) {
  throw new Error(`CORS config error: ${corsResult.data.message}`);
}

const cors = corsResult;

// cors.handle() returns Promise<Result<CorsResult, CorsError>>
const result = await cors.handle(request);

if (isErr(result)) {
  return new Response('Internal Error', { status: 500 });
}
```

</details>

<br>

## 📄 License

MIT
