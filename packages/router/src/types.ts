import type { HttpMethod } from '@zipbul/shared';

export interface RouterOptions {
  ignoreTrailingSlash?: boolean;
  collapseSlashes?: boolean;
  caseSensitive?: boolean;
  decodeParams?: boolean;
  encodedSlashBehavior?: EncodedSlashBehavior;
  blockTraversal?: boolean;
  enableCache?: boolean;
  cacheSize?: number;
  maxSegmentLength?: number;
  strictParamNames?: boolean;
  optionalParamBehavior?: OptionalParamBehavior;
  regexSafety?: RegexSafetyOptions;
  regexAnchorPolicy?: 'warn' | 'error' | 'silent';
  failFastOnBadEncoding?: boolean;
}

export type EncodedSlashBehavior = 'decode' | 'preserve' | 'reject';

export type OptionalParamBehavior = 'omit' | 'setUndefined' | 'setEmptyString';

export interface RegexSafetyOptions {
  mode?: 'error' | 'warn';
  maxLength?: number;
  forbidBacktrackingTokens?: boolean;
  forbidBackreferences?: boolean;
  maxExecutionMs?: number;
  validator?: (pattern: string) => void;
}


export type PatternTesterFn = (value: string) => boolean;

export interface MatcherConfig {
  patternTesters: ReadonlyArray<PatternTesterFn | undefined>;
  encodedSlashBehavior: EncodedSlashBehavior;
  failFastOnBadEncoding: boolean;
  methodCodes?: ReadonlyMap<string, number>;
}

export interface NormalizedPathSegments {
  normalized: string;
  segments: string[];
  segmentDecodeHints?: Uint8Array;
}


export type RouteParams = Record<string, string | undefined>;

// ── Error types ──

/**
 * 라우터 에러 종류 (discriminant).
 * 총 14개 — 상태 전이 2, 빌드타임 8, 매치타임 4.
 */
export type RouterErrKind =
  // 상태 전이
  | 'router-sealed'      // build() 후 add() 시도
  | 'not-built'          // build() 전 match() 시도
  // 빌드타임 — 등록
  | 'route-duplicate'    // 동일 method+path 이미 존재
  | 'route-conflict'     // wildcard/param/static 구조적 충돌
  | 'route-parse'        // 패턴 문법 오류
  | 'param-duplicate'    // 같은 경로 내 동일 이름 파라미터
  | 'param-strict'       // strictParamNames 시 전역 이름 중복
  | 'regex-unsafe'       // regex safety 검사 실패
  | 'regex-anchor'       // anchor policy=error 시 ^/$ 포함
  | 'method-limit'       // 32개 메서드 초과 (MethodRegistry)
  // 매치타임
  | 'segment-limit'      // maxSegmentLength 초과
  | 'encoding'           // percent-encoding 디코딩 실패
  | 'encoded-slash'      // encodedSlashBehavior=reject 시 %2F
  | 'regex-timeout';     // 패턴 매칭 시간 초과

/**
 * Result 에러에 첨부되는 데이터.
 * `err<RouterErrData>({ kind, message, ... })` 형태로 사용.
 */
export interface RouterErrData {
  /** 에러 종류 (discriminant) */
  kind: RouterErrKind;
  /** 사람이 읽을 수 있는 상세 설명 */
  message: string;
  /** 문제가 된 전체 경로 (등록 시점 또는 매치 시점) */
  path?: string;
  /** 문제가 된 HTTP 메서드 */
  method?: string;
  /** 문제가 된 개별 세그먼트 */
  segment?: string;
  /** 충돌 대상 (기존에 등록된 라우트 등) */
  conflictsWith?: string;
  /** 수정 제안 (가능한 경우) */
  suggestion?: string;
  /** addAll() fail-fast 시 에러 전까지 성공한 등록 수 */
  registeredCount?: number;
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
 * match() 성공 시 반환되는 결과.
 * add() 시 등록한 값(T)과 파라미터, 메타 정보를 포함한다.
 */
export interface MatchOutput<T> {
  /** add() 시 등록한 값 그대로 */
  value: T;
  /** 추출된 경로 파라미터 */
  params: Record<string, string | undefined>;
  /** 매칭 메타 정보 */
  meta: MatchMeta;
}

// ── Internal types ──

export interface DynamicMatchResult {
  handlerIndex: number;
  params: RouteParams;
  snapshot?: Array<[string, string | undefined]>;
}
