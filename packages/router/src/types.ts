// ── Public enums ──

export enum TrailingSlash {
  Strict = 'strict',
  Ignore = 'ignore',
}

export enum OptionalParamBehavior {
  Omit = 'omit',
  SetUndefined = 'set-undefined',
}

export enum MatchSource {
  Static = 'static',
  Cache = 'cache',
  Dynamic = 'dynamic',
}

/**
 * 라우터 에러 종류 (discriminant).
 * 상태 전이 1 + 빌드 타임 28 + 옵션/일괄검증 2. match() 는 throw 하지 않으므로
 * 매치 타임 kind 는 없다.
 */
export enum RouterErrorKind {
  // 상태 전이
  RouterSealed = 'router-sealed',
  // 빌드타임 — 등록
  RouteDuplicate = 'route-duplicate',
  RouteConflict = 'route-conflict',
  RouteUnreachable = 'route-unreachable',
  RouteParse = 'route-parse',
  ParamDuplicate = 'param-duplicate',
  MethodLimit = 'method-limit',
  MethodEmpty = 'method-empty',
  MethodInvalidToken = 'method-invalid-token',
  PathMissingLeadingSlash = 'path-missing-leading-slash',
  PathQuery = 'path-query',
  PathFragment = 'path-fragment',
  PathControlChar = 'path-control-char',
  PathInvalidPchar = 'path-invalid-pchar',
  PathMalformedPercent = 'path-malformed-percent',
  PathInvalidUtf8 = 'path-invalid-utf8',
  PathEncodedSlash = 'path-encoded-slash',
  PathDotSegment = 'path-dot-segment',
  PathEmptySegment = 'path-empty-segment',
  RouterOptionsInvalid = 'router-options-invalid',
  RouteValidation = 'route-validation',
}

// ── RouterOptions ──

export interface RouterOptions {
  /**
   * Trailing-slash policy. `Strict` keeps `/a` and `/a/` distinct.
   * `Ignore` collapses one trailing slash on registration and at match
   * time.
   */
  trailingSlash?: TrailingSlash;
  /** Path case-sensitivity. Default true. */
  pathCaseSensitive?: boolean;
  /**
   * 메서드별 매치 캐시 최대 엔트리 수. 기본값 1000. 캐시는 항상 켜져 있고
   * 비활성화 옵션은 없다 — 빈 라우터는 빈 캐시(메모리 0)이며 lazy 할당이라
   * 토글의 가치가 없다. 1000 이 모자란 고-카디널리티 워크로드는 늘리면 된다.
   */
  cacheSize?: number;
  optionalParamBehavior?: OptionalParamBehavior;
}

export type RouteParams = Record<string, string | undefined>;

// ── Error types ──

export interface RouteValidationIssue {
  index: number;
  method: string;
  path: string;
  error: RouterErrorData;
}

/**
 * `RouterError.data` 에 첨부되는 데이터 — kind 별 discriminated union.
 *
 * 각 `kind` 마다 *해당 케이스에서만 의미가 있는* 필드를 required 로 선언.
 * 유저는 `if (e.kind === RouterErrorKind.RouteConflict)` 로 좁힌 후
 * `e.conflictsWith` 를 안전 접근.
 *
 * `path` / `method` / `registeredCount` 는 라우터 상위 레이어가 다운스트림
 * 에러에 컨텍스트로 덧붙이는 값이라 모든 kind 에서 optional.
 */
export type RouterErrorData = {
  path?: string;
  method?: string;
  registeredCount?: number;
} &
  // ── State / options ─────────────────────────────────────────────────
  (
    | { kind: RouterErrorKind.RouterSealed; message: string; suggestion: string }
    | { kind: RouterErrorKind.RouterOptionsInvalid; message: string; suggestion: string }
    // ── Routes interaction (build) ──────────────────────────────────────
    | { kind: RouterErrorKind.RouteValidation; message: string; errors: RouteValidationIssue[] }
    | { kind: RouterErrorKind.RouteDuplicate; message: string; suggestion: string }
    | { kind: RouterErrorKind.RouteConflict; message: string; segment: string; conflictsWith: string; suggestion: string }
    | { kind: RouterErrorKind.RouteUnreachable; message: string; segment: string; conflictsWith: string; suggestion: string }
    | { kind: RouterErrorKind.RouteParse; message: string; segment?: string; suggestion: string }
    // ── add() — param / path grammar ────────────────────────────────────
    | { kind: RouterErrorKind.ParamDuplicate; message: string; segment: string; suggestion: string }
    | { kind: RouterErrorKind.PathQuery; message: string; suggestion: string }
    | { kind: RouterErrorKind.PathFragment; message: string; suggestion: string }
    | { kind: RouterErrorKind.PathEncodedSlash; message: string; suggestion: string }
    | { kind: RouterErrorKind.PathDotSegment; message: string; suggestion: string }
    | { kind: RouterErrorKind.PathEmptySegment; message: string; suggestion: string }
    // ── add() — method / path RFC conformance ───────────────────────────
    | { kind: RouterErrorKind.MethodLimit; message: string; method: string; suggestion: string }
    | { kind: RouterErrorKind.MethodEmpty; message: string; suggestion: string }
    | { kind: RouterErrorKind.MethodInvalidToken; message: string; method: string; suggestion: string }
    | { kind: RouterErrorKind.PathMissingLeadingSlash; message: string; suggestion: string }
    | { kind: RouterErrorKind.PathMalformedPercent; message: string; suggestion: string }
    | { kind: RouterErrorKind.PathInvalidPchar; message: string; segment: string; suggestion: string }
    | { kind: RouterErrorKind.PathControlChar; message: string; suggestion: string }
    | { kind: RouterErrorKind.PathInvalidUtf8; message: string; suggestion: string }
  );

// ── Match output ──

export interface RouterPublicApi<T> {
  add(method: string | readonly string[], path: string, value: T): void;
  addAll(entries: ReadonlyArray<readonly [string, string, T]>): void;
  build(): RouterPublicApi<T>;
  match(method: string, path: string): MatchOutput<T> | null;
  allowedMethods(path: string): readonly string[];
}

export interface MatchMeta {
  readonly source: MatchSource;
}

export interface MatchOutput<T> {
  value: T;
  params: RouteParams;
  meta: MatchMeta;
}

export interface MatchState {
  handlerIndex: number;
  paramCount: number;
  paramOffsets: Int32Array;
}

export type MatchFn = (url: string, state: MatchState) => boolean;
export type DecoderFn = (raw: string) => string;
