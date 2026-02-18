import type { HttpMethod } from '@zipbul/shared';

import type { OriginOptions } from './types';

export interface CorsOptions {
  origin?: OriginOptions;
  methods?: HttpMethod[] | string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
  preflightContinue?: boolean;
  optionsSuccessStatus?: number;
}

export interface CorsResult {
  headers: Headers;
  isPreflight: boolean;
  isAllowed: boolean;
  shouldRespond: boolean;
  statusCode: number | null;
}
