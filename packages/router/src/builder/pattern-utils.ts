import { END_ANCHOR_PATTERN, START_ANCHOR_PATTERN } from './constants';

export interface PatternRejection {
  reason: 'anchor';
  suggestion: string;
}

export function normalizeParamPatternSource(patternSrc: string): string | PatternRejection {
  const trimmed = patternSrc.trim();
  if (START_ANCHOR_PATTERN.test(trimmed) || END_ANCHOR_PATTERN.test(trimmed)) {
    return {
      reason: 'anchor',
      suggestion: 'Remove the leading `^` or trailing `$` — the router wraps every param regex in `^(?:...)$` automatically.',
    };
  }
  return trimmed;
}
