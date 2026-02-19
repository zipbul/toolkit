import type { HttpMethod } from '@zipbul/shared';

import type { CorsAction, CorsRejectionReason } from './enums';
import type { OriginOptions } from './types';

export interface CorsContinueResult {
  action: CorsAction.Continue;
  headers: Headers;
}

export interface CorsPreflightResult {
  action: CorsAction.RespondPreflight;
  headers: Headers;
  statusCode: number;
}

export interface CorsRejectResult {
  action: CorsAction.Reject;
  reason: CorsRejectionReason;
}

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
