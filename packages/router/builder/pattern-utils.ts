import { Logger } from '@bunner/logger';

import type { BuilderConfig } from './types';

import { START_ANCHOR_PATTERN, END_ANCHOR_PATTERN } from './constants';

export class PatternUtils {
  private readonly compiledPatternCache = new Map<string, RegExp>();
  private readonly config: BuilderConfig;
  private readonly logger = new Logger(PatternUtils.name);

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

  normalizeParamPatternSource(patternSrc: string): string {
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
        throw new Error(msg);
      }

      if (policy === 'warn') {
        this.logger.warn(msg);
      }
    }

    return normalized;
  }
}
