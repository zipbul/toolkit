import type { CorsContinueResult, CorsPreflightResult, CorsRejectResult } from './interfaces';

/**
 * Return value of an origin function.
 * `true` to reflect, a string to override, or `false` to reject.
 */
export type OriginResult = boolean | string;

/**
 * Function that dynamically resolves whether an origin is allowed.
 */
export type OriginFn = (origin: string, request: Request) => OriginResult | Promise<OriginResult>;

/**
 * All accepted forms for the `origin` option.
 */
export type OriginOptions = boolean | string | RegExp | Array<string | RegExp> | OriginFn;

/**
 * Discriminated union returned by {@link Cors.handle}.
 * Branch on `action` to determine next step.
 */
export type CorsResult = CorsContinueResult | CorsPreflightResult | CorsRejectResult;

/**
 * Subset of {@link CorsResult} where CORS validation passed.
 * Excludes `Reject`.
 */
export type CorsAllowed = CorsContinueResult | CorsPreflightResult;
