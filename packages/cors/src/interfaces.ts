import type { CorsAction, CorsErrorReason, CorsRejectionReason } from './enums';
import type { CorsHttpMethod, OriginOptions } from './types';

/**
 * Normal request or `preflightContinue` preflight.
 * Attach headers via {@link Cors.applyHeaders}.
 */
export interface CorsContinueResult {
  action: CorsAction.Continue;
  headers: Headers;
}

/**
 * Preflight response.
 * Generate via {@link Cors.createPreflightResponse}.
 */
export interface CorsPreflightResult {
  action: CorsAction.RespondPreflight;
  headers: Headers;
  statusCode: number;
}

/**
 * CORS validation failed.
 * Inspect `reason` to build an error response.
 */
export interface CorsRejectResult {
  action: CorsAction.Reject;
  reason: CorsRejectionReason;
}

/**
 * Error data returned when CORS validation fails.
 */
export interface CorsError {
  reason: CorsErrorReason;
  message: string;
}

/**
 * Configuration for the {@link Cors} handler.
 * All fields are optional.
 */
export interface CorsOptions {
  /**
   * Allowed origin(s).
   * Accepts `'*'`, `false`, `true`, string, RegExp, array, or async function.
   *
   * @defaultValue `'*'`
   */
  origin?: OriginOptions;

  /**
   * HTTP methods allowed in preflight.
   *
   * @defaultValue `['GET','HEAD','PUT','PATCH','POST','DELETE']`
   */
  methods?: (CorsHttpMethod | '*')[];

  /**
   * Request headers allowed in preflight.
   * When omitted, echoes `Access-Control-Request-Headers`.
   */
  allowedHeaders?: string[];

  /**
   * Response headers exposed to browser JavaScript.
   */
  exposedHeaders?: string[];

  /**
   * Whether to send `Access-Control-Allow-Credentials: true`.
   *
   * @defaultValue `false`
   */
  credentials?: boolean;

  /**
   * Preflight cache duration in seconds.
   * When omitted, the header is not sent.
   */
  maxAge?: number;

  /**
   * When `true`, preflight returns `Continue` instead of `RespondPreflight`.
   *
   * @defaultValue `false`
   */
  preflightContinue?: boolean;

  /**
   * HTTP status for the preflight response.
   *
   * @defaultValue `204`
   */
  optionsSuccessStatus?: number;
}
