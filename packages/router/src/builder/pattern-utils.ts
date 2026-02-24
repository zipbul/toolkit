import type { Result } from '@zipbul/result';
import type { RouterErrData } from '../types';
import type { BuilderConfig } from './types';

import { err } from '@zipbul/result';
import { START_ANCHOR_PATTERN, END_ANCHOR_PATTERN } from './constants';

export class PatternUtils {
  private readonly compiledPatternCache = new Map<string, RegExp>();
  private readonly config: BuilderConfig;

  constructor(config: BuilderConfig) {
    this.config = config;
  }

  acquireCompiledPattern(source: string, flags: string): RegExp {
    const key = `${flags}|${source}`;
    const cached = this.compiledPatternCache.get(key);

    if (cached) {
      return cached;
    }

    const compiled = new RegExp(`^(?:${source})$`, flags);

    this.compiledPatternCache.set(key, compiled);

    return compiled;
  }

  normalizeParamPatternSource(patternSrc: string): Result<string, RouterErrData> {
    let normalized = patternSrc.trim();

    if (!normalized) {
      return normalized;
    }

    let removed = false;

    if (START_ANCHOR_PATTERN.test(normalized)) {
      removed = true;
      normalized = normalized.replace(START_ANCHOR_PATTERN, '');
    }

    if (END_ANCHOR_PATTERN.test(normalized)) {
      removed = true;
      normalized = normalized.replace(END_ANCHOR_PATTERN, '');
    }

    if (!normalized) {
      normalized = '.*';
      removed = true;
    }

    if (removed) {
      const policy = this.config.regexAnchorPolicy;
      const msg = `[Router] Parameter regex '${patternSrc}' contained anchors which were stripped.`;

      if (policy === 'error') {
        return err<RouterErrData>({
          kind: 'regex-anchor',
          message: msg,
          segment: patternSrc,
          suggestion: `Remove anchor characters ('^', '$') from parameter regex — the router wraps patterns automatically`,
        });
      }

      if (policy === 'warn') {
        console.warn(msg);
      }
    }

    return normalized;
  }
}
