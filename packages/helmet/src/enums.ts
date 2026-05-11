/**
 * Reasons why Helmet options validation may fail.
 *
 * Each enum value is a stable, machine-readable string suitable as an
 * i18n key for {@link HelmetOptions.messageFormatter}.
 */
export enum HelmetErrorReason {
  // ── CSP ──
  InvalidCspKeyword = 'invalid_csp_keyword',
  UnquotedCspKeyword = 'unquoted_csp_keyword',
  InvalidCspHost = 'invalid_csp_host',
  InvalidCspHashLength = 'invalid_csp_hash_length',
  EmptyFetchDirective = 'empty_fetch_directive',
  DeprecatedCspDirective = 'deprecated_csp_directive',
  InvalidFrameAncestorsKeyword = 'invalid_frame_ancestors_keyword',
  InvalidSandboxToken = 'invalid_sandbox_token',
  InvalidTrustedTypesPolicyName = 'invalid_trusted_types_policy_name',
  InvalidRequireTrustedTypesToken = 'invalid_require_trusted_types_token',
  InvalidReportToGroupName = 'invalid_report_to_group_name',
  InvalidReportUri = 'invalid_report_uri',
  InvalidWebRtcDirective = 'invalid_webrtc_directive',

  // ── Cross-Origin policy values ──
  InvalidCorpValue = 'invalid_corp_value',
  InvalidCoopCoepValue = 'invalid_coop_coep_value',
  InvalidDocumentIsolationPolicyValue = 'invalid_document_isolation_policy_value',

  // ── Permissions-Policy ──
  InvalidPermissionsPolicyOrigin = 'invalid_permissions_policy_origin',
  InvalidPermissionsPolicyToken = 'invalid_permissions_policy_token',

  // ── HSTS ──
  HstsPreloadRequirementMissing = 'hsts_preload_requirement_missing',
  HstsMaxAgeInvalid = 'hsts_max_age_invalid',

  // ── Reporting ──
  UnknownReportingEndpoint = 'unknown_reporting_endpoint',
  ReportingEndpointNotHttps = 'reporting_endpoint_not_https',
  ReportingEndpointInvalidUrl = 'reporting_endpoint_invalid_url',
  InvalidReportingEndpointName = 'invalid_reporting_endpoint_name',

  // ── Integrity-Policy ──
  IntegrityPolicyEmpty = 'integrity_policy_empty',
  InvalidIntegrityDestination = 'invalid_integrity_destination',
  InvalidIntegritySource = 'invalid_integrity_source',

  // ── Clear-Site-Data ──
  InvalidClearSiteDataDirective = 'invalid_clear_site_data_directive',

  // ── NEL ──
  NelMissingReportingEndpoint = 'nel_missing_reporting_endpoint',
  NelInvalidMaxAge = 'nel_invalid_max_age',
  NelInvalidFraction = 'nel_invalid_fraction',

  // ── Cache-Control ──
  InvalidCacheControlValue = 'invalid_cache_control_value',

  // ── Simple headers ──
  InvalidReferrerPolicyToken = 'invalid_referrer_policy_token',
  InvalidXFrameOptionsValue = 'invalid_x_frame_options_value',
  InvalidXDnsPrefetchValue = 'invalid_x_dns_prefetch_value',
  InvalidXPermittedCrossDomainValue = 'invalid_x_permitted_cross_domain_value',
  InvalidXXssProtectionValue = 'invalid_x_xss_protection_value',
  InvalidTimingAllowOrigin = 'invalid_timing_allow_origin',
  InvalidXRobotsTagDirective = 'invalid_x_robots_tag_directive',

  // ── Input limits / hardening ──
  InputTooLarge = 'input_too_large',
  ReservedKeyDenied = 'reserved_key_denied',
  ControlCharRejected = 'control_char_rejected',
  TooManyViolations = 'too_many_violations',
  HeaderValueTooLarge = 'header_value_too_large',
  InvalidNonceCharset = 'invalid_nonce_charset',

  // ── apply() / Response ──
  ResponseBodyConsumed = 'response_body_consumed',
  OpaqueResponseUnsupported = 'opaque_response_unsupported',

  // ── CSP report parsing ──
  UnsupportedCspReportContentType = 'unsupported_csp_report_content_type',
  CspReportTooLarge = 'csp_report_too_large',
  InvalidCspReport = 'invalid_csp_report',
  CspReportTimeout = 'csp_report_timeout',
}

/**
 * Non-fatal warnings produced during validation or migration.
 * Stored on {@link Helmet.warnings} after `Helmet.create()`.
 */
export enum HelmetWarningReason {
  // ── CSP semantics ──
  UnsafeInlineWithNonce = 'unsafe_inline_with_nonce',
  CoopWithoutCoep = 'coop_without_coep',
  UnknownPermissionsPolicyFeature = 'unknown_permissions_policy_feature',
  NonStandardClearSiteDataToken = 'non_standard_clear_site_data_token',
  TrustedTypesDefaultPolicy = 'trusted_types_default_policy',
  ManifestSrcNoFallback = 'manifest_src_no_fallback',
  CspReportOnlyWeakerThanEnforcing = 'csp_report_only_weaker_than_enforcing',

  // ── i18n / user callback fallback ──
  MessageFormatterFailed = 'message_formatter_failed',
}
