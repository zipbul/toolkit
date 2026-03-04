# @zipbul/multipart

[English](./README.md) | **한국어**

[![npm](https://img.shields.io/npm/v/@zipbul/multipart)](https://www.npmjs.com/package/@zipbul/multipart)

Bun 네이티브 API 기반의 스트리밍 multipart/form-data 파서.
`Buffer.indexOf()`를 활용한 제로카피 FSM으로 바운더리를 탐색하고, `TransformStream`으로 파일 업로드 시 네이티브 배압(backpressure)을 지원합니다.

> 외부 런타임 의존성 없음. Bun 전용.

<br>

## 📦 설치

```bash
bun add @zipbul/multipart
```

<br>

## 💡 핵심 개념

용도에 따라 두 가지 파싱 모드를 제공합니다:

```
Multipart.create(options?)
│
├── parse(request)     → AsyncGenerator<MultipartPart>
│                        파트를 하나씩 스트리밍. 배압 지원.
│                        파일 본문의 메모리 사용량은 O(chunk).
│
└── parseAll(request)  → { fields, files }
│                        모든 파트를 메모리에 버퍼링.
                         작은 페이로드에 적합한 간결한 API.
```

각 파트는 **판별 유니온(discriminated union)** 입니다 — `part.isFile`로 타입을 좁힐 수 있습니다:

```
MultipartPart
├── MultipartField  (isFile: false)  → text(), bytes()           — 동기
└── MultipartFile   (isFile: true)   → stream(), bytes(), text() — 비동기
```

<br>

## 🚀 빠른 시작

```typescript
import { Multipart, sanitizeFilename } from '@zipbul/multipart';

const mp = Multipart.create({ maxFileSize: 10 * 1024 * 1024 });

// 스트리밍 — 파트 하나씩 처리
for await (const part of mp.parse(request)) {
  if (part.isFile) {
    const safeName = sanitizeFilename(part.filename) ?? 'unnamed';
    await part.saveTo(`./uploads/${safeName}`);
  } else {
    console.log(part.name, part.text());
  }
}

// 버퍼링 — 전체 수집
const { fields, files } = await mp.parseAll(request);
```

<br>

## ⚙️ 옵션

```typescript
interface MultipartOptions {
  maxFileSize?: number;              // 기본값: 10 MiB
  maxFiles?: number;                 // 기본값: 10
  maxFieldSize?: number;             // 기본값: 1 MiB
  maxFields?: number;                // 기본값: 100
  maxHeaderSize?: number;            // 기본값: 8 KiB
  maxTotalSize?: number | null;      // 기본값: 50 MiB (null = 무제한)
  maxParts?: number;                 // 기본값: Infinity
  allowedMimeTypes?: AllowedMimeTypes; // 기본값: undefined (제한 없음)
}
```

| 옵션 | 기본값 | 설명 |
|:-----|:-------|:-----|
| `maxFileSize` | `10 * 1024 * 1024` | 단일 파일 파트의 최대 크기 (바이트) |
| `maxFiles` | `10` | 최대 파일 파트 수 |
| `maxFieldSize` | `1 * 1024 * 1024` | 단일 필드 파트의 최대 크기 (바이트) |
| `maxFields` | `100` | 최대 필드 파트 수 |
| `maxHeaderSize` | `8 * 1024` | 파트 헤더의 최대 크기 (바이트) |
| `maxTotalSize` | `50 * 1024 * 1024` | 전체 본문의 최대 크기. `null`이면 무제한 |
| `maxParts` | `Infinity` | 전체 파트 수 최대값 (필드 + 파일) |
| `allowedMimeTypes` | `undefined` | 필드별 파일 MIME 타입 허용 목록 |

### `allowedMimeTypes`

필드 이름 기준으로 파일 업로드의 MIME 타입을 제한합니다. 키는 필드 이름, 값은 허용할 MIME 타입 배열입니다.

```typescript
Multipart.create({
  allowedMimeTypes: {
    avatar: ['image/jpeg', 'image/png', 'image/webp'],
    document: ['application/pdf'],
  },
});
```

MIME 타입 비교 시 파라미터는 무시됩니다 — `image/jpeg; charset=utf-8`은 `image/jpeg`과 일치합니다.

<br>

## 📋 API

### `Multipart.create(options?)`

새 파서 인스턴스를 생성합니다. 잘못된 옵션이면 `reason: InvalidOptions`와 함께 `MultipartError`를 throw합니다.

```typescript
const mp = Multipart.create({ maxFileSize: 5 * 1024 * 1024, maxFiles: 3 });
```

### `mp.parse(request)`

multipart 요청 본문을 `AsyncGenerator<MultipartPart>`로 파싱하여 파트를 하나씩 yield합니다. 파일 파트는 `TransformStream`을 통해 네이티브 배압으로 스트리밍되며, 파일 크기와 무관하게 메모리 사용량이 `O(chunk_size)`로 유지됩니다.

소비되지 않은 파일 스트림은 yield 사이에 자동으로 드레인되므로, 파일 파트를 건너뛰어도 데드락이 발생하지 않습니다.

```typescript
for await (const part of mp.parse(request)) {
  if (part.isFile) {
    const safeName = sanitizeFilename(part.filename) ?? 'unnamed';
    await part.saveTo(`./uploads/${safeName}`);
  } else {
    console.log(part.name, part.text());
  }
}
```

### `mp.parseAll(request)`

모든 파트를 한 번에 파싱하여 필드와 파일을 Map으로 수집합니다. `TransformStream` 오버헤드를 완전히 우회하는 최적화된 버퍼링 경로를 사용합니다.

> **주의:** 모든 파트 본문이 메모리에 동시에 버퍼링됩니다. 대용량 업로드에는 `parse()`를 사용하세요.

```typescript
const { fields, files } = await mp.parseAll(request);

// fields: Map<string, string[]>
// files:  Map<string, MultipartFile[]>

const username = fields.get('username')?.[0];
const avatars = files.get('avatar') ?? [];
```

두 Map 모두 배열을 값으로 사용하여 동일한 필드 이름의 복수 파트를 지원합니다 (예: `<input type="file" name="docs" multiple>`).

### `MultipartPart`

`MultipartField`와 `MultipartFile`의 판별 유니온입니다. `part.isFile`로 타입을 좁힙니다.

#### 공통 속성

| 속성 | 타입 | 설명 |
|:----|:-----|:-----|
| `name` | `string` | `Content-Disposition`의 필드 이름 |
| `filename` | `string \| undefined` | 원본 파일명 (파일 파트에만 존재) |
| `contentType` | `string` | 파트의 Content-Type |
| `isFile` | `boolean` | 파일 파트이면 `true`, 필드 파트이면 `false` |

#### `MultipartField` (isFile: false)

| 메서드 | 반환 타입 | 설명 |
|:------|:---------|:-----|
| `text()` | `string` | UTF-8로 디코딩한 본문 (동기) |
| `bytes()` | `Uint8Array` | 원본 바이트 (동기) |

#### `MultipartFile` (isFile: true)

| 메서드 | 반환 타입 | 설명 |
|:------|:---------|:-----|
| `stream()` | `ReadableStream<Uint8Array>` | 배압을 지원하는 읽기 스트림 |
| `bytes()` | `Promise<Uint8Array>` | 전체 스트림을 바이트로 읽기 |
| `text()` | `Promise<string>` | 전체 스트림을 UTF-8 문자열로 읽기 |
| `arrayBuffer()` | `Promise<ArrayBuffer>` | 전체 스트림을 ArrayBuffer로 읽기 |
| `saveTo(path)` | `Promise<number>` | `Bun.write`로 디스크에 저장. 기록한 바이트 수 반환 |

> `stream()`은 파일 파트당 한 번만 호출할 수 있습니다. 두 번째 호출이나 `stream()` 이후 `bytes()`/`text()` 호출은 에러를 throw합니다.

### `sanitizeFilename(filename, options?)`

사용자가 제공한 파일명을 안전한 파일 시스템용으로 변환합니다. 빈 문자열이나 유효하지 않은 파일명은 `undefined`를 반환합니다.

```typescript
sanitizeFilename('../../etc/passwd')     // 'passwd'
sanitizeFilename('C:\\Users\\file.txt')  // 'file.txt'
sanitizeFilename('photo<1>.jpg')         // 'photo_1_.jpg'
sanitizeFilename('.hidden')              // 'hidden'
sanitizeFilename('')                     // undefined
sanitizeFilename('CON.txt')             // undefined (Windows 예약 이름)
```

수행하는 작업:
- 디렉터리 구성 요소 제거 (경로 탐색 방지)
- 널 바이트 및 제어 문자 제거
- 안전하지 않은 특수 문자 치환 (`<>:"/\|?*`)
- 선행 점 제거 (Unix 숨김 파일 방지)
- Windows 예약 이름 거부 (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
- 최대 파일명 길이 적용 (확장자 보존)

| 옵션 | 기본값 | 설명 |
|:----|:-------|:-----|
| `maxLength` | `255` | 변환 후 파일명의 최대 길이 |
| `replacement` | `'_'` | 안전하지 않은 문자를 대체할 문자 |

> **`filename` 보안 주의:** 파일 파트의 `filename` 속성은 `Content-Disposition` 헤더의 값을 그대로 반환합니다. `../../etc/passwd`와 같은 경로 탐색 시퀀스나 `C:\Users\file.txt`과 같은 Windows 경로를 포함할 수 있습니다. 파일 시스템 작업에 사용하기 전에 반드시 `sanitizeFilename()`으로 변환하세요. `filename*=` 파라미터(RFC 5987)는 RFC 7578 Section 4.2에 따라 의도적으로 무시됩니다.

<br>

## 🚨 에러 처리

`parse()`, `parseAll()`, `create()`가 throw하는 모든 에러는 `MultipartError` 인스턴스입니다.

```typescript
import { MultipartError, MultipartErrorReason } from '@zipbul/multipart';

try {
  for await (const part of mp.parse(request)) { /* ... */ }
} catch (e) {
  if (e instanceof MultipartError) {
    e.reason;   // MultipartErrorReason 열거형 값
    e.message;  // 사람이 읽을 수 있는 설명
    e.context;  // { partIndex?, fieldName?, bytesRead? }
    e.cause;    // 원본 에러 (스트림 실패 시)
  }
}
```

### `MultipartErrorReason`

| 사유 | 발생 위치 | 설명 |
|:----|:---------|:-----|
| `InvalidOptions` | `create()` | 잘못된 옵션 |
| `MissingBody` | `parse()` / `parseAll()` | 요청 본문이 없거나 null |
| `InvalidContentType` | `parse()` / `parseAll()` | Content-Type이 없거나 `multipart/form-data`가 아님 |
| `MissingBoundary` | `parse()` / `parseAll()` | 바운더리 파라미터가 없거나 너무 긴 경우 (최대 70자) |
| `MalformedHeader` | `parse()` / `parseAll()` | 잘못된 파트 헤더 (Content-Disposition 누락 등) |
| `HeaderTooLarge` | `parse()` / `parseAll()` | 파트 헤더가 `maxHeaderSize` 초과 |
| `FileTooLarge` | `parse()` / `parseAll()` | 파일 파트가 `maxFileSize` 초과 |
| `FieldTooLarge` | `parse()` / `parseAll()` | 필드 파트가 `maxFieldSize` 초과 |
| `TooManyFiles` | `parse()` / `parseAll()` | 파일 수가 `maxFiles` 초과 |
| `TooManyFields` | `parse()` / `parseAll()` | 필드 수가 `maxFields` 초과 |
| `TooManyParts` | `parse()` / `parseAll()` | 전체 파트 수 (필드 + 파일)가 `maxParts` 초과 |
| `TotalSizeLimitExceeded` | `parse()` / `parseAll()` | 전체 본문 크기가 `maxTotalSize` 초과 |
| `MimeTypeNotAllowed` | `parse()` / `parseAll()` | 파일 MIME 타입이 해당 필드의 `allowedMimeTypes`에 없음 |
| `UnexpectedEnd` | `parse()` / `parseAll()` | 최종 바운더리 전에 스트림 종료 |

### `MultipartErrorContext`

에러에는 추가 정보를 담은 선택적 `context` 객체가 포함됩니다:

| 속성 | 타입 | 설명 |
|:----|:-----|:-----|
| `partIndex` | `number?` | 에러가 발생한 파트의 0-기반 인덱스 |
| `fieldName` | `string?` | 해당 파트의 필드 이름 (알 수 있는 경우) |
| `bytesRead` | `number?` | 에러 시점까지 스트림에서 읽은 총 바이트 수 |

<br>

## 🔌 프레임워크 통합 예시

<details>
<summary><b>Bun.serve</b></summary>

```typescript
import { Multipart, MultipartError, sanitizeFilename } from '@zipbul/multipart';

const mp = Multipart.create({
  maxFileSize: 10 * 1024 * 1024,
  maxFiles: 5,
  allowedMimeTypes: {
    avatar: ['image/jpeg', 'image/png', 'image/webp'],
  },
});

Bun.serve({
  async fetch(request) {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    try {
      const { fields, files } = await mp.parseAll(request);

      return Response.json({
        username: fields.get('username')?.[0],
        fileCount: files.size,
      });
    } catch (e) {
      if (e instanceof MultipartError) {
        return Response.json({ error: e.reason }, { status: 400 });
      }

      return Response.json({ error: 'unknown' }, { status: 500 });
    }
  },
  port: 3000,
});
```

</details>

<details>
<summary><b>대용량 파일 스트리밍 업로드</b></summary>

```typescript
import { Multipart, sanitizeFilename } from '@zipbul/multipart';

const mp = Multipart.create({
  maxFileSize: 100 * 1024 * 1024, // 파일당 100 MiB
  maxTotalSize: null,             // 전체 제한 없음
});

Bun.serve({
  async fetch(request) {
    for await (const part of mp.parse(request)) {
      if (part.isFile) {
        const safeName = sanitizeFilename(part.filename) ?? 'unnamed';
        const bytesWritten = await part.saveTo(`./uploads/${safeName}`);
        console.log(`Saved ${safeName} (${bytesWritten} bytes)`);
      }
    }

    return new Response('OK');
  },
});
```

</details>

<details>
<summary><b>미들웨어 패턴</b></summary>

```typescript
import { Multipart, MultipartError } from '@zipbul/multipart';
import type { MultipartOptions } from '@zipbul/multipart';

function multipartMiddleware(options?: MultipartOptions) {
  const mp = Multipart.create(options);

  return async (ctx: Context, next: () => Promise<void>) => {
    try {
      const { fields, files } = await mp.parseAll(ctx.request);

      ctx.fields = fields;
      ctx.files = files;

      await next();
    } catch (e) {
      if (e instanceof MultipartError) {
        ctx.status = 400;
        ctx.body = { error: e.reason, message: e.message };
        return;
      }

      throw e;
    }
  };
}
```

</details>

<br>

## 📄 라이선스

MIT
