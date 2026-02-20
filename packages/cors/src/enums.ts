/**
 * Discriminant for {@link CorsResult}.
 * Determines how to handle the response.
 */
export const enum CorsAction {
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
export const enum CorsRejectionReason {
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
export const enum CorsErrorReason {
  /** credentials:true is incompatible with wildcard origin per Fetch Standard. */
  CredentialsWithWildcardOrigin,
  /** maxAge must be non-negative. */
  InvalidMaxAge,
  /** optionsSuccessStatus must be 100–599. */
  InvalidStatusCode,
  /** Origin function threw at runtime. */
  OriginFunctionError,
}
