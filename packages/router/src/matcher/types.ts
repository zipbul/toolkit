import type { ROUTE_REGEX_TIMEOUT } from './constants';

export interface PatternTesterOptions {
  readonly maxExecutionMs?: number;
  readonly onTimeout?: (pattern: string, durationMs: number) => boolean | void;
}

export interface RouteRegexTimeoutMarker {
  readonly [ROUTE_REGEX_TIMEOUT]?: true;
}

export type RouteRegexTimeoutError = Error & RouteRegexTimeoutMarker;
