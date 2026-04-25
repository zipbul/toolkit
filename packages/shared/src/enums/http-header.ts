/**
 * Common HTTP header names used internally by `@zipbul` packages.
 *
 * All values follow lowercase HTTP/2 canonical header casing.
 */
export enum HttpHeader {
  // ── Request / general ──
  Origin = 'origin',
  Vary = 'vary',

  // ── CORS ──
  AccessControlAllowOrigin = 'access-control-allow-origin',
  AccessControlAllowMethods = 'access-control-allow-methods',
  AccessControlAllowHeaders = 'access-control-allow-headers',
  AccessControlAllowCredentials = 'access-control-allow-credentials',
  AccessControlExposeHeaders = 'access-control-expose-headers',
  AccessControlMaxAge = 'access-control-max-age',
  AccessControlRequestMethod = 'access-control-request-method',
  AccessControlRequestHeaders = 'access-control-request-headers',

  // ── Helmet: CSP family ──
  ContentSecurityPolicy = 'content-security-policy',
  ContentSecurityPolicyReportOnly = 'content-security-policy-report-only',

  // ── Helmet: Cross-origin isolation ──
  CrossOriginOpenerPolicy = 'cross-origin-opener-policy',
  CrossOriginOpenerPolicyReportOnly = 'cross-origin-opener-policy-report-only',
  CrossOriginEmbedderPolicy = 'cross-origin-embedder-policy',
  CrossOriginEmbedderPolicyReportOnly = 'cross-origin-embedder-policy-report-only',
  CrossOriginResourcePolicy = 'cross-origin-resource-policy',

  // ── Helmet: Origin agent cluster ──
  OriginAgentCluster = 'origin-agent-cluster',

  // ── Helmet: Permissions Policy ──
  PermissionsPolicy = 'permissions-policy',
  PermissionsPolicyReportOnly = 'permissions-policy-report-only',

  // ── Helmet: Transport / referrer ──
  ReferrerPolicy = 'referrer-policy',
  StrictTransportSecurity = 'strict-transport-security',

  // ── Helmet: Legacy / hardening ──
  XContentTypeOptions = 'x-content-type-options',
  XDnsPrefetchControl = 'x-dns-prefetch-control',
  XFrameOptions = 'x-frame-options',
  XPermittedCrossDomainPolicies = 'x-permitted-cross-domain-policies',
  XXssProtection = 'x-xss-protection',
  XDownloadOptions = 'x-download-options',

  // ── Helmet: Information disclosure (typically removed) ──
  XPoweredBy = 'x-powered-by',
  Server = 'server',
  XRobotsTag = 'x-robots-tag',
  ServerTiming = 'server-timing',

  // ── Helmet: Reporting API + NEL ──
  ReportingEndpoints = 'reporting-endpoints',
  ReportTo = 'report-to',
  Nel = 'nel',

  // ── Helmet: Subresource integrity ──
  IntegrityPolicy = 'integrity-policy',
  IntegrityPolicyReportOnly = 'integrity-policy-report-only',

  // ── Helmet: Document policy ──
  DocumentPolicy = 'document-policy',
  DocumentPolicyReportOnly = 'document-policy-report-only',
  RequireDocumentPolicy = 'require-document-policy',
  DocumentIsolationPolicy = 'document-isolation-policy',
  DocumentIsolationPolicyReportOnly = 'document-isolation-policy-report-only',

  // ── Helmet: Cache / clear-site-data ──
  ClearSiteData = 'clear-site-data',
  CacheControl = 'cache-control',
  Pragma = 'pragma',
  Expires = 'expires',

  // ── Helmet: Resource Timing ──
  TimingAllowOrigin = 'timing-allow-origin',
}
