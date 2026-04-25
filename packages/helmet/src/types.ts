/**
 * Branded base64url nonce returned by {@link Helmet.generateNonce}.
 * Distinguished from raw `string` to prevent accidental misuse.
 */
export type Nonce = string & { readonly __brand: 'Nonce' };

/** Branded reporting endpoint name. */
export type EndpointName = string & { readonly __brand: 'EndpointName' };

/** Compile-time HTTPS URL hint. */
export type HttpsUrl = `https://${string}`;

// ── CSP source grammar (CSP3 ED §2.3.1) ──

export type CspKeywordSource =
  | "'self'"
  | "'none'"
  | "'unsafe-inline'"
  | "'unsafe-eval'"
  | "'strict-dynamic'"
  | "'unsafe-hashes'"
  | "'report-sample'"
  | "'wasm-unsafe-eval'"
  | "'inline-speculation-rules'"
  | "'unsafe-webtransport-hashes'"
  | "'report-sha256'"
  | "'report-sha384'"
  | "'report-sha512'";

export type CspNonceSource = `'nonce-${string}'`;
export type CspHashSource =
  | `'sha256-${string}'`
  | `'sha384-${string}'`
  | `'sha512-${string}'`;
export type CspSchemeSource = `${string}:`;
export type CspHostSource =
  | `https://${string}`
  | `http://${string}`
  | `wss://${string}`
  | `ws://${string}`;

/**
 * CSP source expression. The string fallback enables niche schemes / hosts
 * not covered by the literal unions while still providing autocomplete
 * for canonical forms.
 */
export type CspSource =
  | CspKeywordSource
  | CspNonceSource
  | CspHashSource
  | CspSchemeSource
  | CspHostSource
  | '*'
  | (string & {});

export type TrustedTypesRequireToken = "'script'";
export type TrustedTypesToken = "'allow-duplicates'" | "'none'" | '*' | (string & {});

/**
 * HTML iframe sandboxing tokens (13 canonical) plus the Storage Access API
 * extension. CSP3 §6.3.2 references this set unchanged.
 */
export type SandboxToken =
  | 'allow-downloads'
  | 'allow-forms'
  | 'allow-modals'
  | 'allow-orientation-lock'
  | 'allow-pointer-lock'
  | 'allow-popups'
  | 'allow-popups-to-escape-sandbox'
  | 'allow-presentation'
  | 'allow-same-origin'
  | 'allow-scripts'
  | 'allow-storage-access-by-user-activation'
  | 'allow-top-navigation'
  | 'allow-top-navigation-by-user-activation'
  | 'allow-top-navigation-to-custom-protocols';

export type CoopValue =
  | 'same-origin'
  | 'same-origin-allow-popups'
  | 'noopener-allow-popups'
  | 'unsafe-none';

export type CorpValue = 'same-origin' | 'same-site' | 'cross-origin';

export type CoepValue = 'require-corp' | 'credentialless' | 'unsafe-none';

export type ReferrerPolicyToken =
  | 'no-referrer'
  | 'no-referrer-when-downgrade'
  | 'origin'
  | 'origin-when-cross-origin'
  | 'same-origin'
  | 'strict-origin'
  | 'strict-origin-when-cross-origin'
  | 'unsafe-url';

export type XFrameOptionsValue = 'deny' | 'sameorigin' | 'DENY' | 'SAMEORIGIN';

// ── Permissions-Policy feature catalogue (Tier A + B + C) ──

export type PermissionsPolicyFeature =
  // Tier A (universal, 6)
  | 'publickey-credentials-get'
  | 'publickey-credentials-create'
  | 'identity-credentials-get'
  | 'digital-credentials-get'
  | 'digital-credentials-create'
  | 'otp-credentials'
  // Tier B (Chromium + Firefox parsed, 35)
  | 'accelerometer'
  | 'ambient-light-sensor'
  | 'attribution-reporting'
  | 'autoplay'
  | 'battery'
  | 'bluetooth'
  | 'camera'
  | 'compute-pressure'
  | 'cross-origin-isolated'
  | 'direct-sockets'
  | 'display-capture'
  | 'encrypted-media'
  | 'execution-while-not-rendered'
  | 'execution-while-out-of-viewport'
  | 'fullscreen'
  | 'geolocation'
  | 'gyroscope'
  | 'hid'
  | 'idle-detection'
  | 'keyboard-map'
  | 'magnetometer'
  | 'mediasession'
  | 'microphone'
  | 'midi'
  | 'navigation-override'
  | 'payment'
  | 'picture-in-picture'
  | 'screen-wake-lock'
  | 'serial'
  | 'storage-access'
  | 'sync-xhr'
  | 'usb'
  | 'web-share'
  | 'window-management'
  | 'xr-spatial-tracking'
  // Tier C (Chromium-only stable, 18)
  | 'gamepad'
  | 'clipboard-read'
  | 'clipboard-write'
  | 'local-fonts'
  | 'unload'
  | 'browsing-topics'
  | 'captured-surface-control'
  | 'smart-card'
  | 'speaker-selection'
  | 'all-screens-capture'
  | 'deferred-fetch'
  | 'language-model'
  | 'language-detector'
  | 'summarizer'
  | 'translator'
  | 'writer'
  | 'rewriter'
  | 'autofill';

// ── Resolved options (snapshot returned by Helmet.toJSON) ──

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends ReadonlyMap<infer K, infer V>
    ? ReadonlyMap<K, DeepReadonly<V>>
    : T extends Map<infer K, infer V>
      ? ReadonlyMap<K, DeepReadonly<V>>
      : T extends ReadonlyArray<infer U>
        ? ReadonlyArray<DeepReadonly<U>>
        : T extends Array<infer U>
          ? ReadonlyArray<DeepReadonly<U>>
          : T extends object
            ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
            : T;

export interface ResolvedCspOptions {
  directives: ReadonlyMap<string, readonly string[] | string | boolean>;
}

export interface ResolvedHstsOptions {
  maxAge: number;
  includeSubDomains: boolean;
  preload: boolean;
}

export interface ResolvedPermissionsPolicyOptions {
  features: ReadonlyMap<string, readonly string[]>;
}

export interface ResolvedReportingEndpointsOptions {
  endpoints: ReadonlyMap<string, string>;
}

export interface ResolvedIntegrityPolicyOptions {
  blockedDestinations: readonly ('script' | 'style')[];
  sources: readonly 'inline'[];
  endpoints: readonly string[];
}

export interface ResolvedClearSiteDataOptions {
  directives: readonly string[];
}

export interface ResolvedCacheControlOptions {
  value: string;
  pragma: boolean;
  expires: boolean;
}

export interface ResolvedNelOptions {
  reportTo: string;
  maxAge: number;
  includeSubdomains: boolean;
  successFraction: number | undefined;
  failureFraction: number | undefined;
}

export interface ResolvedDocumentPolicyOptions {
  policies: ReadonlyMap<string, string | boolean | number | readonly (string | boolean | number)[]>;
}

export interface ResolvedXRobotsTagOptions {
  directives: readonly string[];
}

export interface ResolvedRemoveHeadersOptions {
  headers: readonly string[];
}

export interface ResolvedHelmetOptions {
  contentSecurityPolicy: ResolvedCspOptions | false;
  contentSecurityPolicyReportOnly: ResolvedCspOptions | undefined;
  crossOriginOpenerPolicy: CoopValue | false;
  crossOriginOpenerPolicyReportOnly: CoopValue | undefined;
  crossOriginEmbedderPolicy: CoepValue | false;
  crossOriginEmbedderPolicyReportOnly: CoepValue | undefined;
  crossOriginResourcePolicy: CorpValue | false;
  originAgentCluster: boolean;
  permissionsPolicy: ResolvedPermissionsPolicyOptions | false;
  permissionsPolicyReportOnly: ResolvedPermissionsPolicyOptions | undefined;
  referrerPolicy: readonly ReferrerPolicyToken[] | false;
  strictTransportSecurity: ResolvedHstsOptions | false;
  xContentTypeOptions: boolean;
  xDnsPrefetchControl: 'on' | 'off' | false;
  xFrameOptions: XFrameOptionsValue | false;
  xPermittedCrossDomainPolicies: 'none' | 'master-only' | 'by-content-type' | 'all' | false;
  reportingEndpoints: ResolvedReportingEndpointsOptions | undefined;
  integrityPolicy: ResolvedIntegrityPolicyOptions | false | undefined;
  integrityPolicyReportOnly: ResolvedIntegrityPolicyOptions | undefined;
  clearSiteData: ResolvedClearSiteDataOptions | false | undefined;
  cacheControl: ResolvedCacheControlOptions | false | undefined;
  nel: ResolvedNelOptions | undefined;
  documentPolicy: ResolvedDocumentPolicyOptions | undefined;
  documentPolicyReportOnly: ResolvedDocumentPolicyOptions | undefined;
  requireDocumentPolicy: ResolvedDocumentPolicyOptions | undefined;
  documentIsolationPolicy: 'isolate-and-require-corp' | 'isolate-and-credentialless' | 'none' | undefined;
  documentIsolationPolicyReportOnly:
    | 'isolate-and-require-corp'
    | 'isolate-and-credentialless'
    | 'none'
    | undefined;
  timingAllowOrigin: readonly string[] | undefined;
  xRobotsTag: ResolvedXRobotsTagOptions | false | undefined;
  xDownloadOptions: boolean;
  xXssProtection: '0' | '1; mode=block' | false;
  removeHeaders: ResolvedRemoveHeadersOptions;
}
