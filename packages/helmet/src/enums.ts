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
  InvalidCspScheme = 'invalid_csp_scheme',
  InvalidCspHost = 'invalid_csp_host',
  InvalidCspNonceCharset = 'invalid_csp_nonce_charset',
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

  // ── Document-Policy ──
  InvalidDocumentPolicyValue = 'invalid_document_policy_value',

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

  // ── Headers Options ──
  InvalidNonceCharset = 'invalid_nonce_charset',
  NonceCallbackUnsupported = 'nonce_callback_unsupported',

  // ── apply() ──
  ResponseBodyConsumed = 'response_body_consumed',
  OpaqueResponseUnsupported = 'opaque_response_unsupported',

  // ── Input limits / hardening ──
  InputTooLarge = 'input_too_large',
  ReservedKeyDenied = 'reserved_key_denied',
  ControlCharRejected = 'control_char_rejected',
  TooManyViolations = 'too_many_violations',

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
  UnsafeEvalWithWasm = 'unsafe_eval_with_wasm',
  CoopWithoutCoep = 'coop_without_coep',
  CoopBreaksOauthPopup = 'coop_breaks_oauth_popup',
  ReportingDefaultEndpointMissing = 'reporting_default_endpoint_missing',
  UnknownPermissionsPolicyFeature = 'unknown_permissions_policy_feature',
  NonStandardClearSiteDataToken = 'non_standard_clear_site_data_token',
  SandboxInReportOnly = 'sandbox_in_report_only',
  UnsafeAllowRedirectsDeadGrammar = 'unsafe_allow_redirects_dead_grammar',
  TrustedTypesDefaultPolicy = 'trusted_types_default_policy',
  ManifestSrcNoFallback = 'manifest_src_no_fallback',
  SelfDoesNotMatchWebSocketScheme = 'self_does_not_match_websocket_scheme',
  ApplyOnSwitchingProtocols = 'apply_on_switching_protocols',

  // ── Migration from helmet.js ──
  HelmetUseDefaultsIgnored = 'helmet_use_defaults_ignored',
  HelmetXFrameOptionsDefaultTightened = 'helmet_x_frame_options_default_tightened',
  HelmetXssFilterHarmful = 'helmet_xss_filter_harmful',
  HelmetAliasRedundant = 'helmet_alias_redundant',
  HelmetReportOnlyLifted = 'helmet_report_only_lifted',
  HelmetNonceCallbackUnsupported = 'helmet_nonce_callback_unsupported',

  // ── i18n / user callback fallback ──
  MessageFormatterFailed = 'message_formatter_failed',
  RemoveHeadersForcedByLegacy = 'remove_headers_forced_by_legacy',

  // ── Input limit sentinel ──
  TooManyWarnings = 'too_many_warnings',
}
