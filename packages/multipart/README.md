# @zipbul/multipart

**English** | [한국어](./README.ko.md)

[![npm](https://img.shields.io/npm/v/@zipbul/multipart)](https://www.npmjs.com/package/@zipbul/multipart)

A streaming multipart/form-data parser built on Bun-native APIs.
Uses a zero-copy FSM with `Buffer.indexOf()` for boundary detection and `TransformStream` for true backpressure on file uploads.

> Zero external runtime dependencies. Designed for Bun.

<br>

## 📦 Installation

```bash
bun add @zipbul/multipart
```

<br>

## 💡 Core Concept

Two parsing modes for different use cases:

```
Multipart.create(options?)
│
├── parse(request)     → AsyncGenerator<MultipartPart>
│                        Stream parts one by one with backpressure.
│                        File bodies stay on disk-level memory (O(chunk)).
│
└── parseAll(request)  → { fields, files }
                         Buffer everything in memory at once.
                         Simpler API for small payloads.
```

Each part is a **discriminated union** — use `part.isFile` to narrow the type:

```
MultipartPart
├── MultipartField  (isFile: false)  → text(), bytes()           — sync
└── MultipartFile   (isFile: true)   → stream(), bytes(), text() — async
```

<br>

## 🚀 Quick Start

```typescript
import { Multipart, sanitizeFilename } from '@zipbul/multipart';

const mp = Multipart.create({ maxFileSize: 10 * 1024 * 1024 });

// Streaming — one part at a time
for await (const part of mp.parse(request)) {
  if (part.isFile) {
    const safeName = sanitizeFilename(part.filename) ?? 'unnamed';
    await part.saveTo(`./uploads/${safeName}`);
  } else {
    console.log(part.name, part.text());
  }
}

// Buffered — collect all at once
const { fields, files } = await mp.parseAll(request);
```

<br>

## ⚙️ Options

```typescript
interface MultipartOptions {
  maxFileSize?: number;              // Default: 10 MiB
  maxFiles?: number;                 // Default: 10
  maxFieldSize?: number;             // Default: 1 MiB
  maxFields?: number;                // Default: 100
  maxHeaderSize?: number;            // Default: 8 KiB
  maxTotalSize?: number | null;      // Default: 50 MiB (null = unlimited)
  maxParts?: number;                 // Default: Infinity
  allowedMimeTypes?: AllowedMimeTypes; // Default: undefined (no restriction)
}
```

| Option | Default | Description |
|:-------|:--------|:------------|
| `maxFileSize` | `10 * 1024 * 1024` | Maximum size of a single file part in bytes |
| `maxFiles` | `10` | Maximum number of file parts allowed |
| `maxFieldSize` | `1 * 1024 * 1024` | Maximum size of a single field part in bytes |
| `maxFields` | `100` | Maximum number of field parts allowed |
| `maxHeaderSize` | `8 * 1024` | Maximum size of part headers in bytes |
| `maxTotalSize` | `50 * 1024 * 1024` | Maximum total body size in bytes. Set to `null` to disable |
| `maxParts` | `Infinity` | Maximum total number of parts (fields + files) |
| `allowedMimeTypes` | `undefined` | Per-field MIME type allowlist for file parts |

### `allowedMimeTypes`

Restrict file uploads by MIME type on a per-field basis. Keys are field names, values are arrays of allowed MIME types.

```typescript
Multipart.create({
  allowedMimeTypes: {
    avatar: ['image/jpeg', 'image/png', 'image/webp'],
    document: ['application/pdf'],
  },
});
```

MIME type comparison ignores parameters — `image/jpeg; charset=utf-8` matches `image/jpeg`.

<br>

## 📋 API

### `Multipart.create(options?)`

Creates a new parser instance. Throws `MultipartError` with `reason: InvalidOptions` on invalid options.

```typescript
const mp = Multipart.create({ maxFileSize: 5 * 1024 * 1024, maxFiles: 3 });
```

### `mp.parse(request)`

Parses a multipart request body as an `AsyncGenerator<MultipartPart>`, yielding parts one by one. File parts are streamed via `TransformStream` with native backpressure — memory usage stays at `O(chunk_size)` regardless of file size.

Unconsumed file streams are automatically drained between yields, so skipping a file part never causes a deadlock.

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

Parses all parts at once, collecting fields and files into Maps. Uses an optimized buffering path that avoids `TransformStream` overhead entirely.

> **Note:** Buffers all part bodies in memory simultaneously. For large uploads with many files, prefer `parse()`.

```typescript
const { fields, files } = await mp.parseAll(request);

// fields: Map<string, string[]>
// files:  Map<string, MultipartFile[]>

const username = fields.get('username')?.[0];
const avatars = files.get('avatar') ?? [];
```

Both Maps use arrays as values to support multiple parts with the same field name (e.g. `<input type="file" name="docs" multiple>`).

### `MultipartPart`

A discriminated union of `MultipartField` and `MultipartFile`. Use `part.isFile` to narrow.

#### Common properties

| Property | Type | Description |
|:---------|:-----|:------------|
| `name` | `string` | Field name from `Content-Disposition` |
| `filename` | `string \| undefined` | Original filename (only on file parts) |
| `contentType` | `string` | Content-Type of the part |
| `isFile` | `boolean` | `true` for file parts, `false` for field parts |

#### `MultipartField` (isFile: false)

| Method | Return Type | Description |
|:-------|:------------|:------------|
| `text()` | `string` | Body decoded as UTF-8 (sync) |
| `bytes()` | `Uint8Array` | Body as raw bytes (sync) |

#### `MultipartFile` (isFile: true)

| Method | Return Type | Description |
|:-------|:------------|:------------|
| `stream()` | `ReadableStream<Uint8Array>` | Body as a readable stream with backpressure |
| `bytes()` | `Promise<Uint8Array>` | Read entire stream into bytes |
| `text()` | `Promise<string>` | Read entire stream and decode as UTF-8 |
| `arrayBuffer()` | `Promise<ArrayBuffer>` | Read entire stream into an ArrayBuffer |
| `saveTo(path)` | `Promise<number>` | Write to disk via `Bun.write`. Returns bytes written |

> `stream()` can only be called once per file part. Calling it a second time, or calling `bytes()`/`text()` after `stream()`, throws an error.

### `sanitizeFilename(filename, options?)`

Sanitizes a user-provided filename for safe filesystem use. Returns `undefined` for empty or invalid filenames.

```typescript
sanitizeFilename('../../etc/passwd')     // 'passwd'
sanitizeFilename('C:\\Users\\file.txt')  // 'file.txt'
sanitizeFilename('photo<1>.jpg')         // 'photo_1_.jpg'
sanitizeFilename('.hidden')              // 'hidden'
sanitizeFilename('')                     // undefined
sanitizeFilename('CON.txt')             // undefined (Windows reserved)
```

What it does:
- Strips directory components (path traversal prevention)
- Removes null bytes and control characters
- Replaces unsafe special characters (`<>:"/\|?*`)
- Removes leading dots (hidden files on Unix)
- Rejects Windows reserved names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
- Enforces maximum filename length (preserving extension)

| Option | Default | Description |
|:-------|:--------|:------------|
| `maxLength` | `255` | Maximum length of the sanitized filename |
| `replacement` | `'_'` | Character to replace unsafe characters with |

> **Security note on `filename`:** The `filename` property on file parts is returned as-is from the `Content-Disposition` header. It may contain path traversal sequences like `../../etc/passwd` or Windows paths like `C:\Users\file.txt`. Always use `sanitizeFilename()` before using in any filesystem operation. The `filename*=` parameter (RFC 5987) is intentionally ignored per RFC 7578 Section 4.2.

<br>

## 🚨 Error Handling

All errors thrown by `parse()`, `parseAll()`, and `create()` are `MultipartError` instances.

```typescript
import { MultipartError, MultipartErrorReason } from '@zipbul/multipart';

try {
  for await (const part of mp.parse(request)) { /* ... */ }
} catch (e) {
  if (e instanceof MultipartError) {
    e.reason;   // MultipartErrorReason enum value
    e.message;  // Human-readable description
    e.context;  // { partIndex?, fieldName?, bytesRead? }
    e.cause;    // Original error (for stream failures)
  }
}
```

### `MultipartErrorReason`

| Reason | Thrown by | Description |
|:-------|:---------|:------------|
| `InvalidOptions` | `create()` | Invalid options provided |
| `MissingBody` | `parse()` / `parseAll()` | Request body is missing or null |
| `InvalidContentType` | `parse()` / `parseAll()` | Content-Type is missing or not `multipart/form-data` |
| `MissingBoundary` | `parse()` / `parseAll()` | Boundary parameter is missing or too long (max 70 chars) |
| `MalformedHeader` | `parse()` / `parseAll()` | Malformed part headers (missing Content-Disposition, etc.) |
| `HeaderTooLarge` | `parse()` / `parseAll()` | Part headers exceed `maxHeaderSize` |
| `FileTooLarge` | `parse()` / `parseAll()` | A file part exceeds `maxFileSize` |
| `FieldTooLarge` | `parse()` / `parseAll()` | A field part exceeds `maxFieldSize` |
| `TooManyFiles` | `parse()` / `parseAll()` | Number of file parts exceeds `maxFiles` |
| `TooManyFields` | `parse()` / `parseAll()` | Number of field parts exceeds `maxFields` |
| `TooManyParts` | `parse()` / `parseAll()` | Total parts (fields + files) exceeds `maxParts` |
| `TotalSizeLimitExceeded` | `parse()` / `parseAll()` | Total body size exceeds `maxTotalSize` |
| `MimeTypeNotAllowed` | `parse()` / `parseAll()` | File MIME type not in `allowedMimeTypes` for its field |
| `UnexpectedEnd` | `parse()` / `parseAll()` | Stream ended before the final boundary |

### `MultipartErrorContext`

Errors include an optional `context` object with additional information:

| Property | Type | Description |
|:---------|:-----|:------------|
| `partIndex` | `number?` | Zero-based index of the part where the error occurred |
| `fieldName` | `string?` | The field name of the part, if known |
| `bytesRead` | `number?` | Total bytes read from the stream at the time of the error |

<br>

## 🔌 Framework Integration Examples

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
<summary><b>Streaming large file uploads</b></summary>

```typescript
import { Multipart, sanitizeFilename } from '@zipbul/multipart';

const mp = Multipart.create({
  maxFileSize: 100 * 1024 * 1024, // 100 MiB per file
  maxTotalSize: null,             // no total limit
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
<summary><b>Middleware pattern</b></summary>

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

## 📄 License

MIT
