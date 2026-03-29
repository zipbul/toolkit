# HTTP Adapter 스트리밍 지원 요청서

> **From**: `@zipbul/compression`
> **To**: `@zipbul/http-adapter`
> **목적**: 응답 스트리밍 압축을 위한 `ReadableStream` body 지원

---

## 배경

`@zipbul/compression`은 현재 동기 버퍼 기반으로 동작한다.
모든 body를 `Uint8Array`로 직렬화한 뒤 `*Sync` API로 압축한다.

Bun v1.3.3+는 `CompressionStream` Web API를 네이티브로 제공하며,
gzip, deflate, brotli, zstd 전 인코딩에 대한 **스트리밍 압축**을 지원한다.

```typescript
const compressed = readableStream.pipeThrough(new CompressionStream("gzip"));
return new Response(compressed); // Bun.serve()가 네이티브로 스트리밍 전송
```

그러나 현재 `@zipbul/http-adapter`의 `HttpResponse` 추상화가
`ReadableStream`을 body 타입으로 수용하지 않아 **스트리밍 경로 자체가 존재하지 않는다**.

---

## 현재 문제점

### 1. `ResponseBodyValue`에 `ReadableStream` 없음

```typescript
// http-adapter/src/types.ts (현재)
type ResponseBodyValue = RequestBodyValue | string | Uint8Array | ArrayBuffer | null;
```

`HttpResponse.setBody()`가 `ReadableStream`을 받을 수 없다.
미들웨어가 body를 `ReadableStream`으로 교체할 방법이 없다.

### 2. `normalizeWorkerBody()`에 `ReadableStream` 경로 없음

```typescript
// http-response.ts normalizeWorkerBody (현재)
// string, Uint8Array, ArrayBuffer, number, boolean, null만 처리
// ReadableStream이 들어오면 처리 불가
```

### 3. `writeSuccessResponse()`가 `Response` body를 전체 버퍼링

```typescript
// http-adapter.ts (현재)
const arrayBuffer = await result.arrayBuffer();
if (arrayBuffer.byteLength > 0) {
  res.setBody(new Uint8Array(arrayBuffer));
}
```

핸들러가 `new Response(ReadableStream)`을 반환해도,
어댑터가 `arrayBuffer()`로 전체를 메모리에 읽어들인다.
스트리밍의 의미가 완전히 무효화된다.

### 4. `HttpResponse.build()`의 JSON 직렬화가 스트림과 충돌

`build()`는 body가 object면 `JSON.stringify()`를 수행한다.
`ReadableStream`은 object이므로, build()가 이를 JSON으로 직렬화하려 시도할 수 있다.

---

## 요청 사항

### R1. `ResponseBodyValue`에 `ReadableStream<Uint8Array>` 추가

```typescript
// 변경 요청
type ResponseBodyValue =
  | RequestBodyValue
  | string
  | Uint8Array
  | ArrayBuffer
  | ReadableStream<Uint8Array>  // 추가
  | null;
```

### R2. `HttpResponse.setBody()` / `getBody()`가 `ReadableStream` 수용

`setBody()`가 `ReadableStream<Uint8Array>`를 저장할 수 있어야 한다.
`getBody()`가 `ReadableStream<Uint8Array>`를 반환할 수 있어야 한다.

### R3. `normalizeWorkerBody()`에 `ReadableStream` passthrough 추가

```typescript
// 변경 요청
function normalizeWorkerBody(body: ResponseBodyValue | undefined): BodyInit | null {
  // ... 기존 로직 ...
  if (body instanceof ReadableStream) return body;  // passthrough
  // ...
}
```

`ReadableStream`은 Bun의 `new Response()` 생성자가 네이티브로 수용하는 `BodyInit` 타입이다.
변환 없이 그대로 전달하면 된다.

### R4. `HttpResponse.build()`에서 스트림 body 분기

`build()` 내부에서 body가 `ReadableStream`인 경우:
- `JSON.stringify()` 직렬화를 **스킵**해야 한다 (스트림은 이미 직렬화된 바이트 청크)
- `Content-Type` 자동 추론을 **스킵**해야 한다 (미들웨어가 이미 설정)
- `Content-Length`를 **설정하지 않아야** 한다 (크기를 알 수 없음, chunked 전송)

### R5. `writeSuccessResponse()`에서 `Response(ReadableStream)` 보존

핸들러가 `Response` 객체를 반환했을 때, body가 `ReadableStream`이면
`arrayBuffer()`로 버퍼링하지 않고 스트림 자체를 `HttpResponse`에 전달해야 한다.

```typescript
// 변경 요청
if (result instanceof Response) {
  res.setStatus(result.status);
  for (const [key, value] of result.headers.entries()) {
    res.setHeader(key, value);
  }

  if (result.body instanceof ReadableStream) {
    // 스트림은 버퍼링하지 않고 그대로 전달
    res.setBody(result.body);
  } else {
    const arrayBuffer = await result.arrayBuffer();
    if (arrayBuffer.byteLength > 0) {
      res.setBody(new Uint8Array(arrayBuffer));
    }
  }
  return;
}
```

### R6. 스트림 body에 대한 `isSent()` 의미론 정의

버퍼 body는 `end()` 호출 시점에 전송이 완료되지만,
스트림 body는 `end()` 호출 후에도 청크가 계속 전송된다.

`isSent()`가 "응답 헤더가 전송 시작되었는가"를 의미하는지,
"body 전체가 전송 완료되었는가"를 의미하는지 정의가 필요하다.

---

## 영향 범위

### 변경이 필요한 파일

| 파일 | 변경 내용 |
|------|-----------|
| `types.ts` | `ResponseBodyValue`에 `ReadableStream<Uint8Array>` 추가 |
| `http-response.ts` | `setBody`, `normalizeWorkerBody`, `build`에 스트림 분기 |
| `http-adapter.ts` | `writeSuccessResponse`에서 스트림 body 보존 |

### 하위 호환성

- `ResponseBodyValue` 유니온 타입 확장은 **하위 호환**이다 (기존 코드는 새 타입을 사용하지 않으면 영향 없음)
- `getBody()` 반환 타입이 확장되므로, 반환값을 타입 가드 없이 `Uint8Array`로 가정하는 코드는 수정 필요
- `normalizeWorkerBody()`의 passthrough 추가는 기존 경로에 영향 없음

### 미들웨어 영향

이 변경이 완료되면 `@zipbul/compression`이 다음과 같이 동작할 수 있다:

```typescript
// 미들웨어 내부 (스트리밍 경로)
const body = response.getBody();

if (body instanceof ReadableStream) {
  const compressed = body.pipeThrough(new CompressionStream(encoding));
  response
    .setBody(compressed)
    .setHeader(HttpHeader.ContentEncoding, encoding)
    .removeHeader(HttpHeader.ContentLength);
  return;
}

// 기존 버퍼 경로 유지
```

---

## Bun 런타임 근거

`Bun.serve()`의 `fetch` 핸들러는 이미 `new Response(ReadableStream)`을 네이티브로 지원한다.

```typescript
Bun.serve({
  fetch() {
    const stream = new ReadableStream({ /* ... */ });
    return new Response(stream); // 네이티브 스트리밍 전송
  },
});
```

Bun은 `ReadableStream` body에 대해:
- `Transfer-Encoding: chunked`를 자동 적용 (HTTP/1.1)
- HTTP/2에서는 프레임 단위 전송
- 소켓 write buffer 기반 backpressure 관리
- 클라이언트 disconnect 시 abort signal 전파

**어댑터가 할 일은 `ReadableStream`을 `new Response()`에 그대로 넘기는 것뿐이다.**
