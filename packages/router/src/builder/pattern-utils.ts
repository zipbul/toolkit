import { END_ANCHOR_PATTERN, START_ANCHOR_PATTERN } from './constants';

/**
 * Strip leading `^` / trailing `$` anchors from a parameter regex source.
 * The router wraps every param regex in `^(?:...)$` automatically, so the
 * user-supplied anchors are redundant at best and silently shadow the
 * wrapping at worst. Always strip silently.
 *
 * Contract: `PathParser.parseParam` collapses `:name(   )` to a no-pattern
 * param (`pattern = null`) before reaching this function, so `patternSrc`
 * is always non-empty. The post-strip empty check (e.g. user wrote `^$`)
 * still falls back to `.*` so we don't pass an empty pattern downstream.
 */
export function normalizeParamPatternSource(patternSrc: string): string {
  let normalized = patternSrc.trim().replace(START_ANCHOR_PATTERN, '').replace(END_ANCHOR_PATTERN, '');
  if (normalized === '') return '.*';
  return normalized;
}
