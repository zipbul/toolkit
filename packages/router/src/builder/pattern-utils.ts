import type { Result } from '@zipbul/result';
import type { RouterErrData } from '../types';
import type { BuilderConfig } from './types';

import { err } from '@zipbul/result';
import { START_ANCHOR_PATTERN, END_ANCHOR_PATTERN } from './constants';

export class PatternUtils {
  private readonly config: BuilderConfig;

  constructor(config: BuilderConfig) {
    this.config = config;
  }

  /**
   * Strip anchors from a parameter regex source, applying the configured
   * regexAnchorPolicy (silent / warn / error) when anchors were present.
   *
   * Contract: callers must filter out empty / whitespace-only pattern
   * sources before invoking this method. The current sole caller —
   * `PathParser.parseParam` — collapses `:name(   )` to a no-pattern param
   * (`pattern = null`), so this method only runs for non-empty patterns
   * and the empty-trim branch acts as a defensive fallback.
   */
  normalizeParamPatternSource(patternSrc: string): Result<string, RouterErrData> {
    let normalized = patternSrc.trim();

    if (!normalized) {
      // Defensive fallback — should be unreachable per the contract above.
      // `.*` mirrors the anchors-only fallback below so callers never see
      // an empty success value.
      return '.*';
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
        this.config.onWarn?.({ kind: 'regex-anchor', message: msg, segment: patternSrc });
      }
    }

    return normalized;
  }
}
