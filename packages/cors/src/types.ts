import type { CorsContinueResult, CorsPreflightResult, CorsRejectResult } from './interfaces';

export type OriginResult = boolean | string;

export type OriginFn = (origin: string, request: Request) => OriginResult | Promise<OriginResult>;

export type OriginOptions = boolean | string | RegExp | Array<string | RegExp> | OriginFn;

export type CorsResult = CorsContinueResult | CorsPreflightResult | CorsRejectResult;

export type CorsAllowed = CorsContinueResult | CorsPreflightResult;
