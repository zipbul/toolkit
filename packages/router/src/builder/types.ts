import type { RegexSafetyOptions, RouterWarning } from '../types';

import { OptionalParamDefaults } from './optional-param-defaults';

export interface BuilderConfig {
  regexSafety?: RegexSafetyOptions;
  regexAnchorPolicy?: 'warn' | 'error' | 'silent';
  optionalParamDefaults?: OptionalParamDefaults;
  onWarn?: (warning: RouterWarning) => void;
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
