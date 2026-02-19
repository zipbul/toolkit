/**
 * Discriminant for {@link CorsResult}.
 * Determines how to handle the response.
 */
export enum CorsAction {
  /** Attach CORS headers to the response and continue processing. */
  Continue         = 'continue',
  /** Return a preflight-only response immediately. */
  RespondPreflight = 'respond-preflight',
  /** Reject the request. See {@link CorsRejectionReason} for details. */
  Reject           = 'reject',
}

/**
 * Reason why a CORS request was rejected.
 */
export enum CorsRejectionReason {
  /** `Origin` header is missing or empty. */
  NoOrigin         = 'no-origin',
  /** Origin is not in the allowed list. */
  OriginNotAllowed = 'origin-not-allowed',
  /** Preflight request method is not allowed. */
  MethodNotAllowed = 'method-not-allowed',
  /** Preflight request header is not allowed. */
  HeaderNotAllowed = 'header-not-allowed',
}
