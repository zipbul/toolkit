import type { HttpMethod } from '@zipbul/shared';

import type { CorsAction, CorsErrorReason, CorsRejectionReason } from './enums';
import type { OriginOptions } from './types';

/**
 * Normal request or `preflightContinue` preflight.
 * Merge `headers` into your response.
 */
export interface CorsContinueResult {
  action: CorsAction.Continue;
  headers: Headers;
}

/**
 * Preflight response.
 * Use `headers` and `statusCode` to build a response.
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
 * Error data payload used internally with the Result pattern.
 * @internal
 */
export interface CorsErrorData {
  reason: CorsErrorReason;
  message: string;
}

/**
 * Thrown by {@link Cors.create} on invalid options, or by {@link Cors.handle}
 * when the origin function throws.
 *
 * Inspect {@link reason} to programmatically distinguish error kinds.
 */
export class CorsError extends Error {
  public readonly reason: CorsErrorReason;

  constructor(data: CorsErrorData) {
    super(data.message);
    this.name = 'CorsError';
    this.reason = data.reason;
  }
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
   * Standard methods are autocompleted; any RFC 9110 §5.6.2 token is accepted.
   * Values are normalized to uppercase internally.
   *
   * @defaultValue `['GET','HEAD','PUT','PATCH','POST','DELETE']`
   * @example ['GET', 'POST', 'DELETE']
   * @example ['*']  // allow all methods
   * @example ['GET', 'PROPFIND']  // custom token
   */
  methods?: HttpMethod[];

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
