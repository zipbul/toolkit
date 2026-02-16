import type { HttpMethod } from '../../types';
import type { RegexSafetyOptions } from '../types';
import type { Node } from './node';

import { OptionalParamDefaults } from './optional-param-defaults';

export interface BuilderConfig {
  regexSafety?: RegexSafetyOptions;
  regexAnchorPolicy?: 'warn' | 'error' | 'silent';
  optionalParamDefaults?: OptionalParamDefaults;
  strictParamNames?: boolean;
}

export interface RouteMethods {
  byMethod: Map<HttpMethod, number>;
}

export interface MethodEntry {
  code: number;
  key: number;
}

export type StaticChildEntry = [string, Node];

export interface StaticChildEntryFingerprint {
  segment: string;
  node: Node;
  fingerprint: number;
}

export interface SortedChildArrays {
  segments: string[];
  nodes: Node[];
  fingerprints: number[];
}

export interface QuantifierFrame {
  hadUnlimited: boolean;
}

export interface RegexSafetyConfig {
  maxLength: number;
  forbidBacktrackingTokens: boolean;
  forbidBackreferences: boolean;
}

export interface RegexSafetyAssessment {
  safe: boolean;
  reason?: string;
}
