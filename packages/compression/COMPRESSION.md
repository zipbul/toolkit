# Compression Middleware — 심층 분석

## 1. 아키텍처 개요

compression 미들웨어는 Zipbul HTTP 어댑터의 응답 파이프라인에서 동작하는 **동기 버퍼 기반** 압축 모듈이다.

```
[Handler] → body (object/string/Uint8Array/...)
  ↓
[compressionMiddleware]
  ├─ RFC 9110 precondition checks
  ├─ Accept-Encoding negotiation
  ├─ serializeBody()          → Uint8Array
  ├─ BUFFER_COMPRESSORS[enc]  → Uint8Array (동기 압축)
  ├─ injectPadding (optional) → Uint8Array (BREACH 완화)
  └─ response.setBody()       → 압축된 바이너리로 교체
  ↓
[HttpResponse.build()] → Bun Response
```

요청 하나에 최소 **3개의 full-size 버퍼**가 동시에 메모리에 존재한다:

1. 원본 body (object → `JSON.stringify` → string 중간체)
2. `serializeBody` 결과 (`TextEncoder.encode` → `Uint8Array`)
3. 압축 결과 (`Uint8Array`)

BREACH 패딩 적용 시 4번째 할당이 추가된다.

---

## 2. 모듈별 라인 분석

### 2.1 `compressors.ts` — 동기 전용 압축기

```typescript
// compressors.ts:10-23
BUFFER_COMPRESSORS: Record<Encoding, BufferCompressFn> = {
  [Encoding.Gzip]:    (data, level) => Bun.gzipSync(data, { level }),
  [Encoding.Deflate]: (data, level) => deflateSync(data, { level }),
  [Encoding.Brotli]:  (data, level) => brotliCompressSync(data, { params }),
  [Encoding.Zstd]:    (data, level) => Bun.zstdCompressSync(data, { level }),
}
```

**현재 런타임 사용 현황:**

| 인코딩 | 버퍼 압축 API | 런타임 |
|--------|--------------|--------|
| Gzip | `Bun.gzipSync()` | Bun native |
| Deflate | `node:zlib deflateSync()` | Node 호환 레이어 |
| Brotli | `node:zlib brotliCompressSync()` | Node 호환 레이어 |
| Zstd | `Bun.zstdCompressSync()` | Bun native |

Deflate가 `node:zlib`을 사용하는 이유: `Bun.deflateSync()`는 RFC 1951 raw deflate를 생성하지만,
HTTP `Content-Encoding: deflate`는 RFC 1950 zlib-wrapped format을 요구한다. (compressors.ts:13-14 주석)

### 2.2 `middleware.ts` — 핵심 로직

#### 2.2.1 `serializeBody` (line 17-22)

```typescript
function serializeBody(body: string | number | boolean | Uint8Array | ArrayBuffer | object): Uint8Array {
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (typeof body === 'string') return encoder.encode(body);
  return encoder.encode(JSON.stringify(body));  // object 경로
}
```

object body의 직렬화 경로: `object → JSON.stringify() → string → TextEncoder.encode() → Uint8Array`

`JSON.stringify`가 string을 반환하고, 다시 `encode`로 Uint8Array로 변환한다.
대형 JSON body에서 이 string 중간체가 GC 압박을 준다.

`HttpResponse.build()`도 JSON body에 대해 `JSON.stringify()`를 수행하지만, compression 미들웨어가
body를 `Uint8Array`로 교체하므로 build() 단계에서의 재직렬화는 발생하지 않는다.

#### 2.2.2 RFC 9110 프리컨디션 체크 (line 54-68)

```typescript
// RFC 9110 §15: body가 없어야 하는 상태 코드
const status = response.getStatus() as number;
if (status < 200 || status === 204 || status === 205 || status === 304) return;

// RFC 9110 §9.3.2: HEAD는 content 없음
if (request.httpMethod === 'HEAD') return;

// body 없음 또는 이미 인코딩됨
const body = response.getBody();
if (body === undefined || body === null) return;
if (response.getHeader(HttpHeader.ContentEncoding) !== null) return;
```

body가 null이거나 상태 코드가 body 금지인 경우 **Vary 헤더를 설정하지 않고** 즉시 리턴한다.
RFC 9110 §12.5.1에 의해 content negotiation이 발생하지 않는 경우 Vary를 설정하지 않는 것이 올바르다.

#### 2.2.3 Vary 헤더 처리 (line 70-75)

```typescript
const existingVary = response.getHeader(HttpHeader.Vary);
if (existingVary === null || !hasVaryEncoding(existingVary)) {
  response.appendHeader(HttpHeader.Vary, HttpHeader.AcceptEncoding);
}
```

Accept-Encoding을 고려한 이상, 실제 압축 여부와 무관하게 `Vary: Accept-Encoding`을 설정한다.
이는 캐시 무효화를 올바르게 처리하기 위한 것이다.

이 시점 이후의 모든 early return (no-transform, content-type 필터, threshold 미달)에서도 Vary는 이미 설정된 상태다.

#### 2.2.4 negotiation 선행, 직렬화 후행 (line 84-94)

```typescript
// Accept-Encoding과 negotiation을 먼저 수행 (line 84-91)
const acceptHeader = request.headers.get(HttpHeader.AcceptEncoding);
if (acceptHeader === null || acceptHeader === '') return;

const clientPrefs = parseAcceptEncoding(acceptHeader);
const encoding = negotiateEncoding(effectiveEncodings, clientPrefs);
if (encoding === null) return;

// negotiation 성공 후에만 body 직렬화 (line 93-94)
const bytes = serializeBody(body);
if (bytes.byteLength < resolved.threshold) return;
```

encoding negotiation을 body 직렬화 **이전**에 수행하여, 매칭되는 인코딩이 없을 때
불필요한 `JSON.stringify` + `TextEncoder.encode`를 회피한다.

그러나 threshold 체크(line 94)는 직렬화 **이후**에 수행된다.
body가 object일 때 `JSON.stringify` 비용이 이미 발생한 후 threshold 미달로 폐기되는 경로가 존재한다.

#### 2.2.5 압축 실행 및 에러 처리 (line 96-101)

```typescript
let compressed: Uint8Array;
try {
  compressed = BUFFER_COMPRESSORS[encoding](bytes, resolved.level[encoding]);
} catch {
  return;  // silent return — body 변경 없음
}
```

`*Sync` 호출이므로 이벤트 루프를 블로킹한다.
Brotli quality 4 + 100KB body 기준 수 밀리초, 고 트래픽 시 tail latency에 영향.

에러 발생 시 silent return하며, 이미 직렬화된 `bytes`는 response에 반영되지 않는다.
원본 object body가 그대로 유지되어 `HttpResponse.build()`가 재직렬화한다.

#### 2.2.6 Content-Length 처리 (line 112-115)

```typescript
response
  .setBody(compressed)
  .setHeader(HttpHeader.ContentEncoding, encoding)
  .removeHeader(HttpHeader.ContentLength);
```

`Content-Length`를 삭제하지만, 압축 후 `compressed.byteLength`를 알 수 있음에도 재설정하지 않는다.

버퍼 기반 응답에서 `Content-Length`가 없으면:
- HTTP/1.1: `Transfer-Encoding: chunked`로 전송됨 (Bun 자동 처리)
- 클라이언트가 다운로드 진행률을 알 수 없음
- keep-alive 연결 효율이 저하될 수 있음

스트리밍 응답에서는 `Content-Length` 생략이 정당하지만, 버퍼 기반에서는 설정하는 것이 올바르다.

#### 2.2.7 ETag 약화 (line 117-121)

```typescript
const etag = response.getHeader(HttpHeader.ETag);
if (etag !== null) {
  response.setHeader(HttpHeader.ETag, weakenETag(etag));
}
```

RFC 9110 §8.8.1: content transformation 후 strong ETag를 유지하면 바이트 동일성 보장이 깨진다.
`W/` prefix를 붙여 weak ETag로 변환한다. 이미 weak인 경우 그대로 유지.

### 2.3 `encoding.ts` — Accept-Encoding 파싱 및 협상

#### 2.3.1 `parseAcceptEncoding` (line 15-46)

RFC 9110 §12.5.3 준수. `x-gzip` → `gzip`, `x-compress` → `compress` 에일리어스 처리.
quality value 파싱 후 quality 내림차순 정렬.

#### 2.3.2 `negotiateEncoding` (line 55-82)

```typescript
for (const encoding of serverEncodings) {
  const quality = clientMap.get(encoding) ?? wildcardQuality;
  if (quality > 0 && quality > bestQuality) {
    best = encoding;
    bestQuality = quality;
  }
}
```

서버 인코딩 목록을 순회하며 클라이언트 quality가 가장 높은 것을 선택한다.
동일 quality일 때 `quality > bestQuality` (strict greater-than)이므로
첫 번째 매칭이 유지된다. 이는 서버 선호 순서를 tie-breaker로 사용하는 의도된 동작이다.

wildcard `*`는 명시적으로 지정되지 않은 인코딩에 대한 fallback quality로 사용된다.
`*;q=0`은 "명시되지 않은 모든 인코딩 거부"를 의미한다.

### 2.4 `htb.ts` — BREACH 완화

#### 2.4.1 Gzip 패딩 (line 40-87)

RFC 1952 §2.3.1의 FEXTRA 필드에 `"ZP"` (0x5a50) 서브필드 식별자로 랜덤 패딩을 주입한다.

두 가지 경로:
- **기존 FEXTRA 있음** (line 45-69): 기존 XLEN을 읽고, 새 서브필드를 뒤에 append
  - XLEN 오버플로우 시 (>0xFFFF) 패딩 없이 원본 복사 반환
- **기존 FEXTRA 없음** (line 72-86): FLG에 FEXTRA 플래그 설정, XLEN + 서브필드 삽입

패딩 데이터는 `Uint8Array` 생성자의 zero-fill에 의존한다 (랜덤 바이트 불필요, 크기만 랜덤이면 됨).

#### 2.4.2 Zstd 패딩 (line 91-113)

RFC 8878 §3.1.2의 Skippable Frame을 압축 데이터 **앞에** prepend한다.

```
[4B magic: 0x184D2A50] [4B frame_size] [padLen bytes padding] [compressed data]
```

RFC 호환 디컴프레서는 Skippable Frame을 무시하므로 투명하다.

#### 2.4.3 CSPRNG (line 21-30)

```typescript
function randomPadLen(maxPadding: number): number {
  const limit = 0x100000000 - (0x100000000 % maxPadding);
  let value: number;
  do {
    crypto.getRandomValues(rngBuf);
    value = rngBuf[0]!;
  } while (value >= limit);
  return 1 + (value % maxPadding);
}
```

rejection sampling으로 [1, maxPadding] 범위의 bias-free 랜덤 정수를 생성한다.
`rngBuf`가 모듈 레벨 `Uint32Array(1)`로 재사용되어 할당을 최소화한다.

### 2.5 `options.ts` — 설정 해석 및 검증

#### 2.5.1 기본값 (constants.ts)

| 설정 | 기본값 |
|------|--------|
| threshold | 1024 bytes |
| encodings | `[Brotli, Gzip]` |
| level (Brotli) | 4 |
| level (Gzip) | 6 |
| level (Deflate) | 6 |
| level (Zstd) | 3 |
| filter | `text/*` (event-stream 제외), `application/json`, `application/xml` 계열, `image/svg+xml` |

#### 2.5.2 레벨 범위

| 인코딩 | 최소 | 최대 |
|--------|------|------|
| Gzip | 1 | 9 |
| Deflate | 1 | 9 |
| Brotli | 0 | 11 |
| Zstd | 1 | 19 |

Zstd max=19는 RFC 9659의 8MB window size 제한을 반영한다 (level 20+은 128MB window 요구).

#### 2.5.3 BREACH 검증

BREACH 패딩은 Gzip과 Zstd만 지원한다 (`BREACH_SAFE_ENCODINGS`).
Brotli/Deflate는 포맷 레벨 패딩을 안전하게 주입할 수 있는 필드가 없다.

BREACH 활성화 시 `effectiveEncodings`에서 non-safe 인코딩을 필터링한다 (middleware.ts:46-48).

### 2.6 `constants.ts` — 필터 패턴

```typescript
const COMPRESSIBLE_PATTERN =
  /^text\/(?!event-stream\b)|^application\/(?:json|javascript|xml|...)|^image\/svg\+xml/i;
```

`text/event-stream`을 negative lookahead로 제외한다.
SSE 스트림은 실시간 전송이므로 버퍼링/압축이 부적절하다.

---

## 3. 스트리밍 압축 — Bun Web API

### 3.1 `CompressionStream` (Bun v1.3.3+)

Bun v1.3.3 (2025-11)부터 Web API 표준 `CompressionStream` / `DecompressionStream`을 네이티브로 지원한다.
내부적으로 zlib 네이티브 바인딩을 사용하며, `node:zlib` 호환 레이어를 거치지 않는다.

**지원 포맷:**

| 포맷 문자열 | 인코딩 | 표준 여부 |
|-------------|--------|-----------|
| `"gzip"` | Gzip (RFC 1952) | Web API 표준 |
| `"deflate"` | Deflate zlib-wrapped (RFC 1950) | Web API 표준 |
| `"deflate-raw"` | Deflate raw (RFC 1951) | Web API 표준 |
| `"brotli"` | Brotli (RFC 7932) | Bun 확장 |
| `"zstd"` | Zstandard (RFC 8878) | Bun 확장 |

**Zstd 포함 전 인코딩이 스트리밍 가능하다.** `node:zlib`이 불필요하다.

### 3.2 사용 패턴

```typescript
// ReadableStream을 CompressionStream으로 파이프
const compressed: ReadableStream = body
  .pipeThrough(new CompressionStream("gzip"));

// Bun.serve()에서 스트리밍 응답
return new Response(compressed, {
  headers: { "Content-Encoding": "gzip" },
});
```

`CompressionStream`은 `TransformStream`을 구현한다:
- `writable`: 비압축 데이터를 쓰는 `WritableStream`
- `readable`: 압축된 데이터를 읽는 `ReadableStream`

청크 단위로 압축하며, 전체 body를 버퍼링하지 않는다.

### 3.3 현재 버퍼 API vs 스트리밍 API 비교

| | 버퍼 모드 (현재) | 스트리밍 모드 (목표) |
|---|---|---|
| **API** | `Bun.gzipSync()` / `Bun.zstdCompressSync()` / `node:zlib *Sync` | `CompressionStream` (Web API) |
| **런타임** | Bun native + node:zlib 혼용 | Bun native 단일 |
| **이벤트 루프** | 블로킹 | 논블로킹 |
| **메모리** | 전체 body 3~4회 할당 | 청크 단위, 상수 메모리 |
| **body 타입** | `Uint8Array` | `ReadableStream` |
| **Content-Length** | 압축 후 알 수 있음 (현재 미설정) | 알 수 없음 (chunked) |
| **BREACH 패딩** | 압축 후 바이너리 조작 | 별도 전략 필요 |
| **최소 Bun** | >=1.2.0 | >=1.3.3 |

### 3.4 `CompressionStream` 포맷 문자열과 `Encoding` enum 매핑

```typescript
// 현재 Encoding enum
enum Encoding {
  Brotli  = 'br',
  Zstd    = 'zstd',
  Gzip    = 'gzip',
  Deflate = 'deflate',
}

// CompressionStream 포맷 문자열 매핑
const STREAM_FORMAT: Record<Encoding, CompressionFormat> = {
  [Encoding.Gzip]:    'gzip',
  [Encoding.Deflate]: 'deflate',   // zlib-wrapped (RFC 1950) — Web API 표준 동작
  [Encoding.Brotli]:  'brotli',    // Bun 확장
  [Encoding.Zstd]:    'zstd',      // Bun 확장
};
```

Deflate: `CompressionStream("deflate")`는 RFC 1950 zlib-wrapped format을 생성한다.
현재 `node:zlib deflateSync()`을 사용하는 것과 동일한 포맷이므로 호환성 문제 없음.

---

## 4. HTTP 어댑터 제약사항 — 스트리밍의 구조적 장벽

### 4.1 현재 타입 시스템

```typescript
// http-adapter/src/types.ts
type ResponseBodyValue = RequestBodyValue | string | Uint8Array | ArrayBuffer | null;
// → ReadableStream이 없다
```

`HttpResponse.setBody()`는 `ResponseBodyValue | undefined`만 수용한다.

### 4.2 응답 정규화

`normalizeWorkerBody()` (http-response.ts)는 다음 타입만 처리한다:
- `string` → passthrough
- `Uint8Array` → passthrough
- `ArrayBuffer` → passthrough
- `number | boolean` → `String()` 변환
- `null | undefined` → null

`ReadableStream`이 들어오면 **처리할 경로가 없다**.

### 4.3 Response 이스케이프 해치의 한계

핸들러가 raw `Response` 객체를 반환할 때:

```typescript
// http-adapter.ts writeSuccessResponse (line 392)
const arrayBuffer = await result.arrayBuffer();
if (arrayBuffer.byteLength > 0) {
  res.setBody(new Uint8Array(arrayBuffer));
}
```

`ReadableStream` body를 가진 `Response`도 **전체를 `arrayBuffer()`로 버퍼링**한다.
스트리밍의 의미가 완전히 무효화된다.

### 4.4 Bun 런타임 수준의 지원

`Bun.serve()`의 `fetch` 핸들러는 `new Response(ReadableStream)`을 네이티브로 지원한다.
**Bun은 스트리밍을 지원하지만, Zipbul의 HttpResponse 추상화가 이를 차단하고 있다.**

어댑터에 필요한 변경 사항은 별도 문서 참고: [HTTP-ADAPTER-REQUEST.md](./HTTP-ADAPTER-REQUEST.md)

---

## 5. 스트리밍 구현을 위한 설계 결정

### 5.1 Threshold 전략

버퍼 모드에서는 `bytes.byteLength < threshold`로 판단한다.
스트리밍에서는 전체 크기를 사전에 알 수 없다.

선택지:
- **A**: `Content-Length` 헤더가 있으면 그것으로 판단, 없으면 항상 압축
- **B**: 첫 N bytes를 내부 버퍼에 모아 threshold 도달 여부 확인 후 결정
  - 도달하면 버퍼 + 이후 청크를 압축 스트림으로 전달
  - 미달하면 버퍼를 그대로 flush (압축 없이)
- **C**: 스트리밍 모드에서는 threshold를 무시 (body가 스트림이면 항상 압축 대상으로 간주)

### 5.2 BREACH 패딩과 스트리밍

**Gzip**: `CompressionStream("gzip")`이 gzip 헤더를 자동 생성한다.
패딩을 주입하려면:
- **방법 A**: 첫 청크를 가로채서 gzip 헤더의 FLG/XLEN/FEXTRA를 수정
- **방법 B**: `CompressionStream("deflate-raw")` + 직접 gzip 헤더 생성 (FEXTRA 포함) + trailer 생성
- **방법 C**: 스트리밍 모드에서는 BREACH 패딩을 비활성화

**Zstd**: Skippable Frame을 첫 번째 청크로 전송하고, 이후 `CompressionStream("zstd")` 출력을 이으면 된다.
`ReadableStream` 두 개를 concat하는 방식으로 구현 가능하다.

### 5.3 Content-Length 처리

버퍼 모드: 압축 후 `compressed.byteLength`를 `Content-Length`로 설정해야 한다. (현재 미설정)
스트리밍 모드: `Content-Length`를 설정할 수 없다 (`Transfer-Encoding: chunked` 사용).

### 5.4 `CompressionStream`의 레벨 설정

Web API `CompressionStream`은 **압축 레벨 파라미터를 받지 않는다**.
생성자 시그니처: `new CompressionStream(format: string)`

현재 `options.level`에서 인코딩별 레벨을 설정하는 기능이 있지만,
`CompressionStream`에서는 런타임 기본 레벨이 사용된다.

선택지:
- **A**: 스트리밍 모드에서는 레벨 설정을 무시 (런타임 기본값 사용)
- **B**: `node:zlib` Transform stream을 사용하여 레벨 설정 유지 (Bun-first 원칙 위반)
- **C**: 레벨 설정이 필요한 경우 버퍼 모드로 fallback

---

## 6. 스트리밍 가용 런타임 요약

| 인코딩 | 버퍼 압축 | 스트리밍 압축 | 비고 |
|--------|-----------|---------------|------|
| Gzip | `Bun.gzipSync()` | `CompressionStream("gzip")` | Bun native |
| Deflate | `node:zlib deflateSync()` | `CompressionStream("deflate")` | 스트리밍은 Bun native로 전환 가능 |
| Brotli | `node:zlib brotliCompressSync()` | `CompressionStream("brotli")` | 스트리밍은 Bun native로 전환 가능 |
| Zstd | `Bun.zstdCompressSync()` | `CompressionStream("zstd")` | Bun native |

**Bun v1.3.3+ 기준 전 인코딩이 스트리밍 가능. `node:zlib` 의존 없이 Web API 단일 경로.**

---

## 7. 구현 우선순위

| 순위 | 항목 | 위치 | 영향 |
|------|------|------|------|
| P0 | HTTP 어댑터 스트리밍 지원 (별도 요청서 참고) | http-adapter | 스트리밍 자체가 불가능 |
| P1 | `CompressionStream` 기반 스트림 압축기 | compression | Bun native 스트리밍 |
| P1 | 미들웨어 `ReadableStream` body 분기 | compression/middleware.ts | 스트림 body 감지 → 스트림 압축 경로 |
| P2 | 버퍼 모드 `Content-Length` 재설정 | compression/middleware.ts:115 | HTTP/1.1 효율 |
| P2 | `serializeBody` 중간 string 할당 최적화 | compression/middleware.ts:21 | 대형 JSON GC 압박 |
| P2 | `engines.bun` 버전 범프 `>=1.2.0` → `>=1.3.3` | compression/package.json | `CompressionStream` 최소 요구 |
| P3 | 스트리밍 threshold 전략 결정 | compression | 설계 결정 |
| P3 | 스트리밍 BREACH 패딩 전략 결정 | compression/htb.ts | 구현 복잡도 |
| P3 | `CompressionStream` 레벨 미지원 대응 전략 | compression | 설계 결정 |
