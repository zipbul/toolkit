/**
 * How a successful {@link MatchOutput} was resolved. Surfaced via
 * {@link MatchMeta.source} so the caller can reason about object
 * identity and cache semantics.
 */
export enum MatchSource {
  /**
   * Literal-path route (no params). The returned {@link MatchOutput}
   * is shared across calls and frozen — do not mutate. `===` identity
   * holds across identical hits.
   */
  Static = 'static',
  /**
   * Dynamic match served from the per-method hit cache. The cached
   * `params` object is frozen and reused across hits — do not mutate,
   * and do not rely on per-call identity.
   */
  Cache = 'cache',
  /**
   * First-time resolution for a dynamic route. Each call returns a
   * fresh {@link MatchOutput} with its own `params` object.
   */
  Dynamic = 'dynamic',
}

/**
 * Discriminant for {@link RouterErrorData}. One value per failure mode
 * the router can throw: 1 state-transition kind, 18 registration /
 * validation kinds, and 2 options / batch kinds. There are no
 * match-time kinds because `match()` does not throw `RouterError` —
 * it returns `null` on misses. A built-in `URIError` from
 * `decodeURIComponent` may still propagate on a captured `:param`
 * slot that contains malformed percent-encoding.
 */
export enum RouterErrorKind {
  /** `add()` / `addAll()` called after `build()`. */
  RouterSealed = 'router-sealed',
  /** Two routes register the same `(method, normalized-path)` pair. */
  RouteDuplicate = 'route-duplicate',
  /** Two routes collide at the same tree position with different shapes. */
  RouteConflict = 'route-conflict',
  /** A route is shadowed and can never be reached at match time. */
  RouteUnreachable = 'route-unreachable',
  /** Path or inline regex body failed to parse. */
  RouteParse = 'route-parse',
  /** Same `:name` appears twice in one route path. */
  ParamDuplicate = 'param-duplicate',
  /** More than 32 distinct HTTP methods registered. */
  MethodLimit = 'method-limit',
  /** Method string is empty. */
  MethodEmpty = 'method-empty',
  /** Method contains characters outside the RFC 7230 `token` grammar. */
  MethodInvalidToken = 'method-invalid-token',
  /** Path does not start with `/`. */
  PathMissingLeadingSlash = 'path-missing-leading-slash',
  /** Path contains `?` (query is the boundary's responsibility, not the router's). */
  PathQuery = 'path-query',
  /** Path contains `#` (fragment is client-side). */
  PathFragment = 'path-fragment',
  /** Path contains an ASCII control character. */
  PathControlChar = 'path-control-char',
  /** Path segment contains a character outside the RFC 3986 `pchar` set. */
  PathInvalidPchar = 'path-invalid-pchar',
  /** Path contains a malformed `%xx` percent-encoding. */
  PathMalformedPercent = 'path-malformed-percent',
  /** Path's percent-encoded bytes are not valid UTF-8. */
  PathInvalidUtf8 = 'path-invalid-utf8',
  /** Path contains `%2F` / `%2f` (encoded slash inside a segment). */
  PathEncodedSlash = 'path-encoded-slash',
  /** Path contains a `.` or `..` segment. */
  PathDotSegment = 'path-dot-segment',
  /** Path contains an empty segment (`//`), excluding the leading slash. */
  PathEmptySegment = 'path-empty-segment',
  /** A {@link RouterOptions} value was invalid (e.g. negative `cacheSize`). */
  RouterOptionsInvalid = 'router-options-invalid',
  /** `build()` aggregated multiple per-route failures; see `.errors`. */
  RouteValidation = 'route-validation',
}

/** Options accepted by the `Router` constructor. All optional. */
export interface RouterOptions {
  /**
   * Trailing-slash policy. Default `true` — collapses one trailing
   * slash on registration and at match time, so `/a` and `/a/` resolve
   * to the same route. Set `false` for strict matching where `/a` and
   * `/a/` are distinct.
   */
  ignoreTrailingSlash?: boolean;
  /**
   * Path case-sensitivity. Default `true` — `/Users` and `/users`
   * are different routes. Set `false` to lowercase both registered
   * paths and incoming match inputs before comparison.
   */
  pathCaseSensitive?: boolean;
  /**
   * Per-method hit-cache capacity. Default `1000`. Rounded up to the
   * next power of two; bounded approximate-LRU eviction. Must be a
   * positive integer in `[1, 2^30]`. Empty routers allocate no cache
   * memory; caches are lazy per active method.
   */
  cacheSize?: number;
  /**
   * Shape of `params` when an optional `:name?` segment is missing.
   * Default `true` — the key is omitted from `params`. Set `false` to
   * write `params[name] = undefined` instead.
   */
  omitMissingOptional?: boolean;
}

/** Captured path parameters keyed by name. Decoded `string` values. */
export type RouteParams = Record<string, string | undefined>;

/**
 * One failing route inside a {@link RouterErrorKind.RouteValidation}
 * aggregate. `index` is the position in the original `addAll()` batch
 * (or `add()` call sequence).
 */
export interface RouteValidationIssue {
  index: number;
  method: string;
  path: string;
  error: RouterErrorData;
}

/**
 * Structured payload carried by `RouterError.data`. Discriminated union
 * over {@link RouterErrorKind} — narrow on `kind` to access
 * kind-specific fields. `path`, `method`, and `registeredCount` are
 * context fields the router attaches on a best-effort basis and are
 * optional on every variant.
 */
export type RouterErrorData = {
  path?: string;
  method?: string;
  registeredCount?: number;
} & (
  | { kind: RouterErrorKind.RouterSealed; message: string; suggestion: string }
  | { kind: RouterErrorKind.RouterOptionsInvalid; message: string; suggestion: string }
  | { kind: RouterErrorKind.RouteValidation; message: string; errors: RouteValidationIssue[] }
  | { kind: RouterErrorKind.RouteDuplicate; message: string; suggestion: string }
  | { kind: RouterErrorKind.RouteConflict; message: string; segment: string; conflictsWith: string; suggestion: string }
  | { kind: RouterErrorKind.RouteUnreachable; message: string; segment: string; conflictsWith: string; suggestion: string }
  | { kind: RouterErrorKind.RouteParse; message: string; segment?: string; suggestion: string }
  | { kind: RouterErrorKind.ParamDuplicate; message: string; segment: string; suggestion: string }
  | { kind: RouterErrorKind.PathQuery; message: string; suggestion: string }
  | { kind: RouterErrorKind.PathFragment; message: string; suggestion: string }
  | { kind: RouterErrorKind.PathEncodedSlash; message: string; suggestion: string }
  | { kind: RouterErrorKind.PathDotSegment; message: string; suggestion: string }
  | { kind: RouterErrorKind.PathEmptySegment; message: string; suggestion: string }
  | { kind: RouterErrorKind.MethodLimit; message: string; method: string; suggestion: string }
  | { kind: RouterErrorKind.MethodEmpty; message: string; suggestion: string }
  | { kind: RouterErrorKind.MethodInvalidToken; message: string; method: string; suggestion: string }
  | { kind: RouterErrorKind.PathMissingLeadingSlash; message: string; suggestion: string }
  | { kind: RouterErrorKind.PathMalformedPercent; message: string; suggestion: string }
  | { kind: RouterErrorKind.PathInvalidPchar; message: string; segment: string; suggestion: string }
  | { kind: RouterErrorKind.PathControlChar; message: string; suggestion: string }
  | { kind: RouterErrorKind.PathInvalidUtf8; message: string; suggestion: string }
);

/**
 * Structural surface of a built router. `Router` implements this
 * interface, and the type is exported so consumers can hold a router
 * reference without nailing down the concrete class.
 */
export interface RouterPublicApi<T> {
  /** See `Router.add`. */
  add(method: string | readonly string[], path: string, value: T): void;
  /** See `Router.addAll`. */
  addAll(entries: ReadonlyArray<readonly [string, string, T]>): void;
  /** See `Router.build`. */
  build(): RouterPublicApi<T>;
  /** See `Router.match`. */
  match(method: string, path: string): MatchOutput<T> | null;
  /** See `Router.allowedMethods`. */
  allowedMethods(path: string): readonly string[];
}

/** Metadata attached to every {@link MatchOutput}. */
export interface MatchMeta {
  /** How the match was resolved; see {@link MatchSource}. */
  readonly source: MatchSource;
}

/** Successful match result returned by {@link RouterPublicApi.match}. */
export interface MatchOutput<T> {
  /** Value the matched route was registered with. */
  value: T;
  /**
   * Captured path parameters. Param values are percent-decoded;
   * wildcard captures are returned raw (slash-preserving). The object
   * has a `null` prototype.
   *
   * For {@link MatchSource.Static} and {@link MatchSource.Cache}
   * results, this object is frozen and shared across calls — do not
   * mutate.
   */
  params: RouteParams;
  /** How the match was resolved; see {@link MatchMeta}. */
  meta: MatchMeta;
}

export interface MatchState {
  handlerIndex: number;
  paramCount: number;
  paramOffsets: Int32Array;
}

export type MatchFn = (url: string, state: MatchState) => boolean;
export type DecoderFn = (raw: string) => string;
