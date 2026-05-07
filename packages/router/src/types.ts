
export type RouterProfile = 'secure' | 'compat' | 'unsafe';

export interface RouterOptions {
  /**
   * Validation/runtime strictness profile. `secure` rejects malformed
   * percent escapes, control bytes, dot segments, and the unsafe regex
   * subset. `compat` softens those checks. `unsafe` additionally allows
   * unbounded limits via {@link unsafeAllowUnboundedLimits}.
   */
  profile?: RouterProfile;
  /**
   * Trailing-slash policy. `'strict'` keeps `/a` and `/a/` distinct.
   * `'ignore'` collapses one trailing slash on registration and at match
   * time. Takes precedence over the legacy `ignoreTrailingSlash` boolean
   * when both are supplied.
   */
  trailingSlash?: 'strict' | 'ignore';
  /** Path case-sensitivity. `false` requires the `compat` profile. */
  pathCaseSensitive?: boolean;
  /** @deprecated Use `trailingSlash`. */
  ignoreTrailingSlash?: boolean;
  /** @deprecated Use `pathCaseSensitive`. */
  caseSensitive?: boolean;
  /** HTTP method token max length (ASCII bytes). Default 64. */
  maxMethodLength?: number;
  /** Full path max length. Default 8192. Runtime path over the limit returns null. */
  maxPathLength?: number;
  /** Single segment max length. Default 1024. */
  maxSegmentLength?: number;
  /** Max segments per registered path. Default 256. */
  maxSegmentCount?: number;
  /** Max parameters per registered path. Default 64. */
  maxParams?: number;
  /** Max optional-segment expansions per registered route. Default 1024. */
  maxOptionalExpansions?: number;
  /** Max total expanded routes across one build. Default 200_000. */
  maxExpandedRoutes?: number;
  /** Max regex sibling param children at the same segment position. Default 32. */
  maxRegexSiblingsPerSegment?: number;
  /**
   * 메서드별 매치 캐시 최대 엔트리 수. 기본값 1000. 캐시는 항상 켜져 있고
   * 비활성화 옵션은 없다 — 빈 라우터는 빈 캐시(메모리 0)이며 lazy 할당이라
   * 토글의 가치가 없다. 1000 이 모자란 고-카디널리티 워크로드는 늘리면 된다.
   */
  cacheSize?: number;
  /**
   * Opt-in to disable numeric limit caps (allow `Infinity`). Setting this
   * to `true` invalidates secure/enterprise profile guarantees.
   */
  unsafeAllowUnboundedLimits?: boolean;
  optionalParamBehavior?: OptionalParamBehavior;
  /**
   * Opt out of build-time JIT warmup. Drops the codegen node ceiling from
   * 256 to 64 (no-warmup p95-only regime) so first-call latency stays bounded
   * without the warmup pass. Use only when warmup invocations interfere
   * with the workload's IC characteristics.
   */
  codegenStrictNoWarmup?: boolean;
}

export type OptionalParamBehavior = 'omit' | 'set-undefined';

export type RouteParams = Record<string, string | undefined>;

// ── Error types ──

/**
 * 라우터 에러 종류 (discriminant).
 * 총 8개 — 상태 전이 1, 빌드타임 7. match() 는 throw 하지 않으므로 매치타임 kind 는 없다.
 */
export type RouterErrorKind =
  // 상태 전이
  | 'router-sealed'      // build() 후 add() 시도
  // 빌드타임 — 등록
  | 'route-duplicate'    // 동일 method+path 이미 존재
  | 'route-conflict'     // wildcard/param/static 구조적 충돌
  | 'route-unreachable'  // 선행 wildcard/terminal 때문에 도달 불가능한 등록
  | 'route-parse'        // 패턴 문법 오류
  | 'param-duplicate'    // 같은 경로 내 동일 이름 파라미터
  | 'regex-unsafe'       // regex safety 검사 실패 (length / nested-quantifier / backreference / alternation overlap)
  | 'method-limit'       // 32개 메서드 초과 (MethodRegistry)
  | 'method-empty'       // 빈 method 토큰
  | 'method-invalid-token' // method 가 HTTP token 문법을 위반
  | 'method-too-long'    // maxMethodLength 초과
  | 'path-missing-leading-slash'
  | 'path-query'         // 등록 path에 raw `?`
  | 'path-fragment'      // 등록 path에 raw `#`
  | 'path-control-char'  // 등록 path에 C0/DEL
  | 'path-non-ascii'     // 등록 path에 raw non-ASCII
  | 'path-invalid-pchar' // 라우터 grammar token 외 pchar 위반
  | 'path-malformed-percent' // `%` 뒤 hex 2자리 미충족
  | 'path-invalid-utf8'  // 디코딩 후 UTF-8 invalid (overlong 등)
  | 'path-encoded-slash' // `%2F` 디코드 시 `/`
  | 'path-encoded-control' // 인코드된 C0/DEL
  | 'path-dot-segment'   // 디코드 시 `.` 또는 `..`
  | 'path-empty-segment' // interior empty `/a//b`
  | 'path-too-long'      // maxPathLength 초과
  | 'segment-limit'      // 빌드 시 세그먼트 길이/수/파라미터 수 상한 초과
  | 'expansion-total-limit'   // maxExpandedRoutes 초과
  | 'regex-sibling-limit'     // maxRegexSiblingsPerSegment 초과
  | 'option-invalid'     // 옵션 numeric/조합 violation
  | 'route-validation';  // build()/seal() 일괄 검증 실패

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
 * 유저는 `if (e.kind === 'route-conflict')` 로 좁힌 후 `e.conflictsWith` 를
 * 안전 접근. required/optional 분류는 모든 에러 생성 사이트의 *실제 채움
 * 패턴* 을 audit 하여 결정한다 — required 필드는 *모든* 호출 사이트가
 * 채우고 있음을 TypeScript 가 강제하는 보장이다.
 *
 * `path` / `method` / `registeredCount` 는 라우터 상위 레이어 (addOne,
 * addAll) 가 다운스트림 에러에 컨텍스트로 덧붙이는 값이라 모든 kind 에서
 * optional 로 접근 가능.
 */
export type RouterErrorData = {
  path?: string;
  method?: string;
  /** addAll() fail-fast 시 에러 전까지 성공한 등록 수 */
  registeredCount?: number;
} & (
  | { kind: 'router-sealed'; message: string; suggestion: string }
  | { kind: 'route-duplicate'; message: string; suggestion: string }
  | { kind: 'route-conflict'; message: string; segment: string; conflictsWith: string }
  | { kind: 'route-unreachable'; message: string; segment?: string; conflictsWith?: string; suggestion?: string }
  | { kind: 'route-parse'; message: string; segment?: string; suggestion?: string }
  | { kind: 'param-duplicate'; message: string; path: string; segment: string; suggestion: string }
  | { kind: 'regex-unsafe'; message: string; segment: string; suggestion: string }
  | { kind: 'method-limit'; message: string; method: string; suggestion: string }
  | { kind: 'method-empty'; message: string; suggestion?: string }
  | { kind: 'method-invalid-token'; message: string; method: string; suggestion?: string }
  | { kind: 'method-too-long'; message: string; method: string; suggestion?: string }
  | { kind: 'path-missing-leading-slash'; message: string; suggestion?: string }
  | { kind: 'path-query'; message: string; suggestion?: string }
  | { kind: 'path-fragment'; message: string; suggestion?: string }
  | { kind: 'path-control-char'; message: string; suggestion?: string }
  | { kind: 'path-non-ascii'; message: string; suggestion?: string }
  | { kind: 'path-invalid-pchar'; message: string; segment?: string; suggestion?: string }
  | { kind: 'path-malformed-percent'; message: string; suggestion?: string }
  | { kind: 'path-invalid-utf8'; message: string; suggestion?: string }
  | { kind: 'path-encoded-slash'; message: string; suggestion?: string }
  | { kind: 'path-encoded-control'; message: string; suggestion?: string }
  | { kind: 'path-dot-segment'; message: string; suggestion?: string }
  | { kind: 'path-empty-segment'; message: string; suggestion?: string }
  | { kind: 'path-too-long'; message: string; suggestion?: string }
  | { kind: 'segment-limit'; message: string; segment?: string; suggestion?: string }
  | { kind: 'expansion-total-limit'; message: string; suggestion?: string }
  | { kind: 'regex-sibling-limit'; message: string; segment?: string; suggestion?: string }
  | { kind: 'option-invalid'; message: string; option?: string; suggestion?: string }
  | { kind: 'route-validation'; message: string; errors: RouteValidationIssue[] }
);

// ── Match output types ──

// Public API surface a built router exposes. Match/allowedMethods accept any
// HTTP method token as the method argument; the runtime token gate handles
// validation.
export interface RouterPublicApi<T> {
  add(method: string | readonly string[], path: string, value: T): void;
  addAll(entries: ReadonlyArray<readonly [string, string, T]>): void;
  build(): RouterPublicApi<T>;
  match(method: string, path: string): MatchOutput<T> | null;
  allowedMethods(path: string): readonly string[];
}

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
  params: RouteParams;
  /** 매칭 메타 정보 */
  meta: MatchMeta;
}
