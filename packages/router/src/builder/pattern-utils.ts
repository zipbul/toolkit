import { END_ANCHOR_PATTERN, START_ANCHOR_PATTERN } from './constants';

/**
 * Strip leading `^` / trailing `$` anchors from a parameter regex source.
 * The router wraps every param regex in `^(?:...)$` automatically, so the
 * user-supplied anchors are redundant at best and silently shadow the
 * wrapping at worst. Always strip silently.
 *
 * Contract: callers must filter out empty / whitespace-only pattern sources
 * before invoking this function — `PathParser.parseParam` already collapses
 * `:name(   )` to a no-pattern param (`pattern = null`) so this only runs
 * for non-empty patterns. The empty-trim branch is a defensive fallback.
 */
export function normalizeParamPatternSource(patternSrc: string): string {
  let normalized = patternSrc.trim();

  if (!normalized) {
    return '.*';
  }

  if (START_ANCHOR_PATTERN.test(normalized)) {
    normalized = normalized.replace(START_ANCHOR_PATTERN, '');
  }

  if (END_ANCHOR_PATTERN.test(normalized)) {
    normalized = normalized.replace(END_ANCHOR_PATTERN, '');
  }

  if (!normalized) {
    return '.*';
  }

  return normalized;
}
