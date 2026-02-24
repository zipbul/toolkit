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
 * Fully resolved CORS options with all defaults applied.
 * `null` indicates "use default behavior" (e.g., echo mode for headers).
 */
export type ResolvedCorsOptions = {
  origin: OriginOptions;
  methods: string[];
  allowedHeaders: string[] | null;
  exposedHeaders: string[] | null;
  credentials: boolean;
  maxAge: number | null;
  preflightContinue: boolean;
  optionsSuccessStatus: number;
};
