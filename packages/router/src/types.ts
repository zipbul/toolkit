
export interface RouterOptions {
  ignoreTrailingSlash?: boolean;
  caseSensitive?: boolean;
  decodeParams?: boolean;
  enableCache?: boolean;
  cacheSize?: number;
  maxSegmentLength?: number;
  optionalParamBehavior?: OptionalParamBehavior;
  regexSafety?: RegexSafetyOptions;
  regexAnchorPolicy?: 'warn' | 'error' | 'silent';
  onWarn?: (warning: RouterWarning) => void;
  /** 경로 최대 길이. 기본값 2048. 초과 시 match() 는 null 을 반환한다. */
  maxPathLength?: number;
}

export type OptionalParamBehavior = 'omit' | 'setUndefined' | 'setEmptyString';

export interface RegexSafetyOptions {
  mode?: 'error' | 'warn';
  maxLength?: number;
  forbidBacktrackingTokens?: boolean;
  forbidBackreferences?: boolean;
  maxExecutionMs?: number;
  validator?: (pattern: string) => void;
}


import type { TesterResult } from './matcher/pattern-tester';

export type PatternTesterFn = (value: string) => TesterResult;

export type RouteParams = Record<string, string | undefined>;

// ── Error types ──

/**
 * 라우터 에러 종류 (discriminant).
 * 총 9개 — 상태 전이 1, 빌드타임 8. match() 는 throw 하지 않으므로 매치타임 kind 는 없다.
 */
export type RouterErrKind =
  // 상태 전이
  | 'router-sealed'      // build() 후 add() 시도
  // 빌드타임 — 등록
  | 'route-duplicate'    // 동일 method+path 이미 존재
  | 'route-conflict'     // wildcard/param/static 구조적 충돌
  | 'route-parse'        // 패턴 문법 오류
  | 'param-duplicate'    // 같은 경로 내 동일 이름 파라미터
  | 'regex-unsafe'       // regex safety 검사 실패
  | 'regex-anchor'       // anchor policy=error 시 ^/$ 포함
  | 'method-limit'       // 32개 메서드 초과 (MethodRegistry)
  | 'segment-limit';     // 빌드 시 세그먼트 길이/수/파라미터 수 상한 초과

/**
 * 모든 에러에 공통으로 부착될 수 있는 caller-context 필드.
 *
 * `path` / `method` 는 라우터 상위 레이어 (addOne, addAll) 가 다운스트림
 * 에러에 *컨텍스트* 로 덧붙이는 값이라 어떤 `kind` 에도 합법. `registeredCount`
 * 는 addAll() 의 fail-fast wrapper 가 추가하는 진단 정보.
 *
 * Kind 별 *required* 필드는 본 컨텍스트 *밖* 의 union 멤버에 정의된다
 * (예: `route-conflict.segment`). 즉 narrowing 후엔 kind-필수 필드만
 * 강제되고, 컨텍스트는 항상 optional 로 접근.
 */
export interface RouterErrContext {
  path?: string;
  method?: string;
  /** addAll() fail-fast 시 에러 전까지 성공한 등록 수 */
  registeredCount?: number;
}

/**
 * `Result` 에러에 첨부되는 데이터 — kind 별 discriminated union.
 *
 * 각 `kind` 마다 *해당 케이스에서만 의미가 있는* 필드를 required 로 선언.
 * 유저는 `if (e.kind === 'route-conflict')` 로 좁힌 후 `e.segment` 를 안전
 * 접근. 필수/선택 분류는 모든 에러 생성 사이트의 *실제 채움 패턴* 을 audit
 * 하여 결정한다 — required 필드는 *모든* 호출 사이트가 채우고 있음을
 * TypeScript 가 강제하는 보장.
 */
export type RouterErrData = RouterErrContext & (
  | { kind: 'router-sealed'; message: string; suggestion: string }
  | { kind: 'route-duplicate'; message: string; suggestion?: string }
  | { kind: 'route-conflict'; message: string; segment: string; conflictsWith?: string }
  | { kind: 'route-parse'; message: string; segment?: string }
  | { kind: 'param-duplicate'; message: string; path: string; segment: string }
  | { kind: 'regex-unsafe'; message: string; segment: string }
  | { kind: 'regex-anchor'; message: string; segment: string; suggestion?: string }
  | { kind: 'method-limit'; message: string; method: string }
  | { kind: 'segment-limit'; message: string; segment?: string; suggestion?: string }
);

/**
 * 라이브러리가 발행하는 경고 정보.
 * RouterOptions.onWarn 콜백으로 수신한다.
 */
export interface RouterWarning {
  kind: 'regex-unsafe' | 'regex-anchor';
  message: string;
  segment?: string;
}

// ── Match output types ──

/**
 * 매칭 메타 정보.
 * 디버깅/모니터링 용도로 매칭 소스를 알려준다.
 */
export interface MatchMeta {
  readonly source: 'static' | 'cache' | 'dynamic';
}

/**
 * 매칭 성공 시 반환되는 *공통 페이로드* (value + params).
 *
 * `MatchOutput<T>` 와 `CachedMatchEntry<T>` 모두 이 형태를 공유하며 유일한
 * 차이는 `meta` 필드의 유무다. 본 베이스를 분리해두면 캐시 컨테이너와
 * 외부 반환 사이에서 변환 비용 0 으로 공유할 수 있다.
 */
export interface MatchPayload<T> {
  /** add() 시 등록한 값 그대로 */
  value: T;
  /** 추출된 경로 파라미터 */
  params: RouteParams;
}

/**
 * match() 성공 시 반환되는 결과.
 * add() 시 등록한 값(T)과 파라미터, 메타 정보를 포함한다.
 */
export interface MatchOutput<T> extends MatchPayload<T> {
  /** 매칭 메타 정보 */
  meta: MatchMeta;
}
