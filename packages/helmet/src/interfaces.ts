import type { HelmetErrorReason, HelmetWarningReason } from './enums';
import type {
  CoepValue,
  CoopValue,
  CorpValue,
  CspSource,
  Nonce,
  ReferrerPolicyToken,
  SandboxToken,
  TrustedTypesRequireToken,
  TrustedTypesToken,
} from './types';

/**
 * Single validation violation. Aggregated into {@link HelmetError.violations}
 * so a `Helmet.create()` call surfaces every issue in one go.
 *
 * **Security**: `message` MUST NOT echo raw user input — only structural
 * information (path, length, index). Reasons are machine-readable enums.
 */
export interface ViolationDetail {
  reason: HelmetErrorReason;
  /** Structural path, e.g. `'contentSecurityPolicy.directives.scriptSrc[2]'` */
  path: string;
  message: string;
  remedy?: string;
}

/**
 * Thrown by {@link Helmet.create} (and {@link Helmet.derive}) when options
 * fail validation. Inspect {@link violations} for every issue found —
 * validation is batched, never fail-fast.
 */
export class HelmetError extends Error {
  public readonly reason: HelmetErrorReason;
  public readonly violations: readonly ViolationDetail[];

  constructor(violations: readonly ViolationDetail[]) {
    const first = violations[0];
    if (!first) {
      super('HelmetError thrown without violations');
      this.name = 'HelmetError';
      this.reason = 'input_too_large' as HelmetErrorReason;
      this.violations = Object.freeze([]);
      return;
    }
    const summary =
      violations.length === 1
        ? first.message
        : `${first.message} (and ${violations.length - 1} more violation${violations.length === 2 ? '' : 's'})`;
    super(summary);
    this.name = 'HelmetError';
    this.reason = first.reason;
    this.violations = Object.freeze(violations.slice());
  }
}

/**
 * Non-fatal validation warning.
 * Available on {@link Helmet.warnings}.
 */
export interface HelmetWarning {
  readonly reason: HelmetWarningReason;
  readonly path: string;
  readonly message: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-options
// ─────────────────────────────────────────────────────────────────────────────

export interface CspDirectives {
  // Fetch directives
  defaultSrc?: CspSource[];
  childSrc?: CspSource[];
  connectSrc?: CspSource[];
  fencedFrameSrc?: CspSource[];
  fontSrc?: CspSource[];
  frameSrc?: CspSource[];
  imgSrc?: CspSource[];
  manifestSrc?: CspSource[];
  mediaSrc?: CspSource[];
  objectSrc?: CspSource[];
  scriptSrc?: CspSource[];
  scriptSrcAttr?: CspSource[];
  scriptSrcElem?: CspSource[];
  styleSrc?: CspSource[];
  styleSrcAttr?: CspSource[];
  styleSrcElem?: CspSource[];
  workerSrc?: CspSource[];
  // Document
  baseUri?: CspSource[];
  sandbox?: SandboxToken[];
  // Navigation
  formAction?: CspSource[];
  frameAncestors?: CspSource[];
  // Reporting
  reportTo?: string;
  reportUri?: string;
  // WebRTC (CSP3)
  webrtc?: 'allow' | 'block';
  // Other
  upgradeInsecureRequests?: boolean;
  requireTrustedTypesFor?: TrustedTypesRequireToken[];
  trustedTypes?: TrustedTypesToken[];
}

export interface ContentSecurityPolicyOptions {
  directives?: CspDirectives;
}

export interface StrictTransportSecurityOptions {
  /** @defaultValue 63072000 (2 years, Mozilla recommendation) */
  maxAge?: number;
  /** @defaultValue true */
  includeSubDomains?: boolean;
  /** Non-RFC token (hstspreload.org convention). When true, validation enforces preload requirements. */
  preload?: boolean;
}

export type PermissionsPolicyAllowlist = string;

export interface PermissionsPolicyOptions {
  features?: Record<string, PermissionsPolicyAllowlist[]>;
}

export interface ReportingEndpointsOptions {
  endpoints: Record<string, string>;
}

export interface IntegrityPolicyOptions {
  blockedDestinations?: ('script' | 'style')[];
  sources?: 'inline'[];
  endpoints?: string[];
}

export type ClearSiteDataDirective =
  | 'cache'
  | 'cookies'
  | 'storage'
  | 'executionContexts'
  | 'clientHints'
  | 'prefetchCache'
  | 'prerenderCache'
  | '*';

export interface ClearSiteDataOptions {
  directives?: ClearSiteDataDirective[];
}

export interface CacheControlOptions {
  /** Default `'no-store, max-age=0'` */
  value?: string;
  /** Adds `Pragma: no-cache` for HTTP/1.0 compatibility. */
  pragma?: boolean;
  /** Adds `Expires: 0` for HTTP/1.0 compatibility. */
  expires?: boolean;
}

export interface NelOptions {
  reportTo: string;
  maxAge: number;
  includeSubdomains?: boolean;
  successFraction?: number;
  failureFraction?: number;
}

export type DocumentPolicyValue = string | boolean | number | (string | boolean | number)[];

export interface DocumentPolicyOptions {
  policies: Record<string, DocumentPolicyValue>;
}

export interface XRobotsTagOptions {
  directives?: string[];
}

export interface RemoveHeadersOptions {
  /** Headers to remove. Replaces the must-strip default when supplied. */
  headers?: string[];
  /** Headers added on top of the default list. */
  additional?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-level options
// ─────────────────────────────────────────────────────────────────────────────

export interface HelmetOptions {
  // ── Default-ON ──
  contentSecurityPolicy?: boolean | ContentSecurityPolicyOptions;
  crossOriginOpenerPolicy?: boolean | CoopValue;
  crossOriginResourcePolicy?: boolean | CorpValue;
  /** sf-boolean (RFC 9651). `true` → `?1`, `false` → `?0` opt-out. */
  originAgentCluster?: boolean;
  permissionsPolicy?: boolean | PermissionsPolicyOptions;
  referrerPolicy?: boolean | ReferrerPolicyToken | ReferrerPolicyToken[];
  strictTransportSecurity?: boolean | StrictTransportSecurityOptions;
  xContentTypeOptions?: boolean;
  xDnsPrefetchControl?: boolean | 'on' | 'off';
  /** Input case is preserved on emit (WAF compatibility). */
  xFrameOptions?: boolean | 'deny' | 'sameorigin' | 'DENY' | 'SAMEORIGIN';
  xPermittedCrossDomainPolicies?: boolean | 'none' | 'master-only' | 'by-content-type' | 'all';

  // ── Default-OFF ──
  crossOriginEmbedderPolicy?: boolean | CoepValue;
  contentSecurityPolicyReportOnly?: ContentSecurityPolicyOptions;
  crossOriginOpenerPolicyReportOnly?: CoopValue;
  crossOriginEmbedderPolicyReportOnly?: CoepValue;
  permissionsPolicyReportOnly?: PermissionsPolicyOptions;
  reportingEndpoints?: ReportingEndpointsOptions;
  integrityPolicy?: boolean | IntegrityPolicyOptions;
  integrityPolicyReportOnly?: IntegrityPolicyOptions;
  clearSiteData?: boolean | ClearSiteDataOptions;
  cacheControl?: boolean | CacheControlOptions;
  nel?: NelOptions;
  documentPolicy?: DocumentPolicyOptions;
  documentPolicyReportOnly?: DocumentPolicyOptions;
  requireDocumentPolicy?: DocumentPolicyOptions;
  documentIsolationPolicy?: 'isolate-and-require-corp' | 'isolate-and-credentialless' | 'none';
  documentIsolationPolicyReportOnly?: 'isolate-and-require-corp' | 'isolate-and-credentialless' | 'none';
  timingAllowOrigin?: string | string[];
  xRobotsTag?: boolean | XRobotsTagOptions;
  xDownloadOptions?: boolean;
  xXssProtection?: boolean | '0' | '1; mode=block';

  // ── Header removal ──
  removeHeaders?: boolean | 'owasp' | RemoveHeadersOptions;

  // ── i18n ──
  /**
   * Validation message formatter. Wrapped in try/catch — throwing or returning
   * non-string falls back to the English default and emits
   * {@link HelmetWarningReason.MessageFormatterFailed}.
   */
  messageFormatter?: (
    reason: HelmetErrorReason | HelmetWarningReason,
    context: { path: string; meta?: unknown },
  ) => string;
}

/**
 * Per-request options for {@link Helmet.headers}, {@link Helmet.headersRecord},
 * {@link Helmet.apply}, and {@link Helmet.applyHeadersTo}.
 */
export interface HeadersOptions {
  /**
   * Nonce to inject into CSP / CSP-Report-Only `script-src` and `style-src`.
   * Use {@link Helmet.generateNonce} for a 16-byte base64url branded nonce.
   */
  nonce?: Nonce | string;
}

export type ApplyOptions = HeadersOptions;
