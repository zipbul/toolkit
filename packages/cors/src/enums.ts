/**
 * Discriminant for {@link CorsResult}.
 * Determines how to handle the response.
 */
export enum CorsAction {
  /** Attach CORS headers to the response and continue processing. */
  Continue = 'continue',
  /** Return a preflight-only response immediately. */
  RespondPreflight = 'respond_preflight',
  /** Reject the request. See {@link CorsRejectionReason} for details. */
  Reject = 'reject',
}

/**
 * Reason why a CORS request was rejected.
 */
export enum CorsRejectionReason {
  /** `Origin` header is missing or empty. */
  NoOrigin = 'no_origin',
  /** Origin is not in the allowed list. */
  OriginNotAllowed = 'origin_not_allowed',
  /** Preflight request method is not allowed. */
  MethodNotAllowed = 'method_not_allowed',
  /** Preflight request header is not allowed. */
  HeaderNotAllowed = 'header_not_allowed',
}

/**
 * Reason why CORS options validation failed.
 */
export enum CorsErrorReason {
  /** credentials:true is incompatible with wildcard origin per Fetch Standard. */
  CredentialsWithWildcardOrigin = 'credentials_with_wildcard_origin',
  /** maxAge must be non-negative. */
  InvalidMaxAge = 'invalid_max_age',
  /** optionsSuccessStatus must be 200–299 (ok status). */
  InvalidStatusCode = 'invalid_status_code',
  /** Origin function threw at runtime. */
  OriginFunctionError = 'origin_function_error',
  /** origin is an empty/blank string, empty array, or array containing empty/blank string entries (RFC 6454). */
  InvalidOrigin = 'invalid_origin',
  /** methods is an empty array or contains empty/blank string entries (RFC 9110 §5.6.2 token). */
  InvalidMethods = 'invalid_methods',
  /** allowedHeaders contains empty/blank string entries (RFC 9110 §5.6.2 token). */
  InvalidAllowedHeaders = 'invalid_allowed_headers',
  /** exposedHeaders contains empty/blank string entries (RFC 9110 §5.6.2 token). */
  InvalidExposedHeaders = 'invalid_exposed_headers',
  /** origin RegExp is potentially unsafe (exponential backtracking / ReDoS). */
  UnsafeRegExp = 'unsafe_regexp',
}
