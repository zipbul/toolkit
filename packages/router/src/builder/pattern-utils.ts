import { END_ANCHOR_PATTERN, START_ANCHOR_PATTERN } from './constants';

/**
 * Carries the rejection reason for an anchored param regex. The pattern
 * shape `^...` / `...$` is rejected at parse time because the router
 * already wraps every user pattern in `^(?:...)$` — accepting the user
 * anchors would silently double-anchor and obscure the user's intent.
 */
export interface PatternRejection {
  reason: 'anchor';
  suggestion: string;
}

/**
 * Validate and normalize a parameter regex source. Returns the source
 * unchanged when acceptable, or a `PatternRejection` carrier when the
 * user supplied a leading `^` / trailing `$` anchor.
 *
 * Contract: `PathParser.parseParam` collapses `:name(   )` to a parse
 * error before reaching this function, so `patternSrc` is guaranteed
 * non-empty here.
 */
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
