# @zipbul/shared

[English](./README.md) | **한국어**

[![npm](https://img.shields.io/npm/v/@zipbul/shared)](https://www.npmjs.com/package/@zipbul/shared)

`@zipbul` 툴킷의 공유 라이브러리입니다.
여러 `@zipbul` 패키지에서 공통으로 사용하는 열거형(enum), 상수, 타입, 유틸리티 등을 제공합니다.

<br>

## 📦 설치

```bash
bun add @zipbul/shared
```

<br>

## 📚 구성 요소

### HTTP 열거형

HTTP 메서드, 헤더, 상태 코드에 대한 타입 안전한 `const enum` 선언으로 매직 스트링을 제거합니다.

```typescript
import { HttpMethod, HttpHeader, HttpStatus } from '@zipbul/shared';

if (request.method === HttpMethod.Get) {
  headers.set(HttpHeader.AccessControlAllowOrigin, '*');
  return new Response('OK', { status: HttpStatus.Ok });
}
```

| Export       | 설명                                  |
|:-------------|:--------------------------------------|
| `HttpMethod` | 표준 HTTP 메서드 (`Get`, `Post`, `Put`, `Patch`, `Delete`, …) |
| `HttpHeader` | CORS 관련 HTTP 헤더 (Fetch Standard, 소문자 값) |
| `HttpStatus` | 공통 HTTP 상태 코드 (`Ok`, `NoContent`, …) |

> 열거형은 `const enum`입니다 — `isolatedModules: false` 환경에서는 컴파일 타임에 값이 **인라인**되어 런타임 비용이 없습니다. 툴체인별 동작은 [`const enum`에 대하여](#-const-enum에-대하여)를 참고하세요.

<br>

## 🔬 `const enum`에 대하여

모든 열거형은 `const enum`으로 선언되어 있으며, 툴체인에 따라 동작이 다릅니다:

| 환경 | 동작 |
|:-----|:-----|
| TypeScript (`isolatedModules: false`) | 컴파일 타임에 값이 **인라인** — 런타임 객체 없음 |
| 번들러 (Bun, esbuild, Vite) | **일반 enum** 취급 — 런타임 객체가 생성됨 |
| `isolatedModules: true` / `verbatimModuleSyntax: true` | import가 보존되며, 번들러가 빌드 타임에 해소 |

이것이 의미하는 바:
- **Bun 소비자**는 열거형을 정상적으로 사용 가능 — `bun build`가 해소를 처리
- **TypeScript 라이브러리 소비자**는 컴파일 타임 인라인의 이점을 누림 (런타임 비용 제로)
- `.d.ts` 파일은 `const enum` 선언을 보존하여 다운스트림 소비자에게 전달

> **참고:** `verbatimModuleSyntax: true`와 `emitDeclarationOnly`로 빌드할 때 TS2748 오류를 방지하려면 `tsconfig.build.json`에서 `verbatimModuleSyntax: false`를 설정해야 합니다. 빌드 설정에 이미 반영되어 있습니다.

<br>

## 📄 라이선스

MIT
