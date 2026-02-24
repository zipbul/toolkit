import type { HttpMethod } from '@zipbul/shared';

export interface RouterOptions {
  ignoreTrailingSlash?: boolean;
  collapseSlashes?: boolean;
  caseSensitive?: boolean;
  decodeParams?: boolean;
  encodedSlashBehavior?: EncodedSlashBehavior;
  blockTraversal?: boolean;
  enableCache?: boolean;
  cacheSize?: number;
  maxSegmentLength?: number;
  strictParamNames?: boolean;
  optionalParamBehavior?: OptionalParamBehavior;
  regexSafety?: RegexSafetyOptions;
  regexAnchorPolicy?: 'warn' | 'error' | 'silent';
  failFastOnBadEncoding?: boolean;
}

export type EncodedSlashBehavior = 'decode' | 'preserve' | 'reject';

export type OptionalParamBehavior = 'omit' | 'setUndefined' | 'setEmptyString';

export interface RegexSafetyOptions {
  mode?: 'error' | 'warn';
  maxLength?: number;
  forbidBacktrackingTokens?: boolean;
  forbidBackreferences?: boolean;
  maxExecutionMs?: number;
  validator?: (pattern: string) => void;
}


export type PatternTesterFn = (value: string) => boolean;

export interface MatcherConfig {
  patternTesters: ReadonlyArray<PatternTesterFn | undefined>;
  encodedSlashBehavior: EncodedSlashBehavior;
  failFastOnBadEncoding: boolean;
}

export interface NormalizedPathSegments {
  normalized: string;
  segments: string[];
  segmentOffsets?: Uint32Array;
  segmentDecodeHints?: Uint8Array;
  suffixSource?: string;
  hadTrailingSlash?: boolean;
}


export type RouteParams = Record<string, string | undefined>;

export interface MatchResultMeta {
  readonly source?: 'static-fast' | 'cache' | 'dynamic';
}

export interface DynamicMatchResult {
  handlerIndex: number;
  params: RouteParams;
  snapshot?: Array<[string, string | undefined]>;
}

export type Handler<R = unknown> = (params: RouteParams, meta: MatchResultMeta) => R;


