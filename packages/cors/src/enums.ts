/**
 * Discriminant for {@link CorsResult}.
 * Determines how to handle the response.
 */
export enum CorsAction {
  /** Attach CORS headers to the response and continue processing. */
  Continue,
  /** Return a preflight-only response immediately. */
  RespondPreflight,
  /** Reject the request. See {@link CorsRejectionReason} for details. */
  Reject,
}

/**
 * Reason why a CORS request was rejected.
 */
export enum CorsRejectionReason {
  /** `Origin` header is missing or empty. */
  NoOrigin,
  /** Origin is not in the allowed list. */
  OriginNotAllowed,
  /** Preflight request method is not allowed. */
  MethodNotAllowed,
  /** Preflight request header is not allowed. */
  HeaderNotAllowed,
}

/**
 * Reason why CORS options validation failed.
 */
export enum CorsErrorReason {
  /** credentials:true is incompatible with wildcard origin per Fetch Standard. */
  CredentialsWithWildcardOrigin,
  /** maxAge must be non-negative. */
  InvalidMaxAge,
  /** optionsSuccessStatus must be 200–299 (ok status). */
  InvalidStatusCode,
  /** Origin function threw at runtime. */
  OriginFunctionError,
  /** origin is an empty/blank string, empty array, or array containing empty/blank string entries (RFC 6454). */
  InvalidOrigin,
  /** methods is an empty array or contains empty/blank string entries (RFC 9110 §5.6.2 token). */
  InvalidMethods,
  /** allowedHeaders contains empty/blank string entries (RFC 9110 §5.6.2 token). */
  InvalidAllowedHeaders,
  /** exposedHeaders contains empty/blank string entries (RFC 9110 §5.6.2 token). */
  InvalidExposedHeaders,
  /** origin RegExp is potentially unsafe (exponential backtracking / ReDoS). */
  UnsafeRegExp,
}
