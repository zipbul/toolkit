import type { OriginOptions } from './types';

import { HttpMethod } from '../../enums';

/**
 * Configuration options for CORS Middleware.
 */
export interface CorsOptions {
  /**
   * Configures the `Access-Control-Allow-Origin` CORS header.
   * @default '*' (allow all)
   */
  origin?: OriginOptions;

  /**
   * Configures the `Access-Control-Allow-Methods` CORS header.
   * @default 'GET,HEAD,PUT,PATCH,POST,DELETE'
   */
  methods?: string | string[] | HttpMethod[];

  /**
   * Configures the `Access-Control-Allow-Headers` CORS header.
   * If not specified, defaults to reflecting the headers specified in the
   * `Access-Control-Request-Headers` request header.
   */
  allowedHeaders?: string | string[];

  /**
   * Configures the `Access-Control-Expose-Headers` CORS header.
   * Set this to pass the header, otherwise it is omitted.
   */
  exposedHeaders?: string | string[];

  /**
   * Configures the `Access-Control-Allow-Credentials` CORS header.
   * Set to true to pass the header, otherwise it is omitted.
   * @default false
   */
  credentials?: boolean;

  /**
   * Configures the `Access-Control-Max-Age` CORS header.
   * Set to an integer to pass the header, otherwise it is omitted.
   */
  maxAge?: number;

  /**
   * Pass the CORS preflight response to the next handler.
   */
  preflightContinue?: boolean;

  /**
   * Provides a status code to use for successful OPTIONS requests, since some
   * legacy browsers (IE11, various SmartTVs) choke on 204.
   * @default 204
   */
  optionsSuccessStatus?: number;
}
