export const TESTER_FAIL = 0 as const;
export const TESTER_PASS = 1 as const;

type TesterResult = typeof TESTER_FAIL | typeof TESTER_PASS;

/**
 * Pattern tester closure. Hot-path matcher invokes this to validate a
 * captured param against its compiled regex. Lives in tree/ alongside
 * `ParamSegment` (which holds a `tester: PatternTesterFn | null` field)
 * so the data model owns its own value-type, and codegen/matcher import
 * the type from the tree barrel without an upward edge to a dedicated
 * types module.
 */
export type PatternTesterFn = (value: string) => TesterResult;

const DIGIT_PATTERNS = new Set(['\\d+', '\\d{1,}', '[0-9]+', '[0-9]{1,}']);
const ALPHA_PATTERNS = new Set(['[a-zA-Z]+', '[A-Za-z]+']);
// `\w` is `[A-Za-z0-9_]`. `[\w-]+` and `[A-Za-z0-9_-]+` describe the same
// set — keep both source forms here so the user's chosen syntax doesn't
// fall through to the slow `compiled.test` path. Same for the escaped
// variants the path-parser may emit after normalization.
const ALPHANUM_PATTERNS = new Set([
  '[A-Za-z0-9_\\-]+', '[A-Za-z0-9_-]+',
  '\\w+', '\\w{1,}',
  '[\\w-]+', '[\\w\\-]+',
]);

export function buildPatternTester(
  source: string,
  compiled: RegExp,
): PatternTesterFn {
  if (source.length > 0) {
    if (DIGIT_PATTERNS.has(source)) {
      return value => (isAllDigits(value) ? TESTER_PASS : TESTER_FAIL);
    }

    if (ALPHA_PATTERNS.has(source)) {
      return value => (isAlpha(value) ? TESTER_PASS : TESTER_FAIL);
    }

    if (ALPHANUM_PATTERNS.has(source)) {
      return value => (isAlphaNumericDash(value) ? TESTER_PASS : TESTER_FAIL);
    }

    if (source === '[^/]+') {
      return value => (value.length > 0 && !value.includes('/') ? TESTER_PASS : TESTER_FAIL);
    }
  }

  return value => (compiled.test(value) ? TESTER_PASS : TESTER_FAIL);
}

function isAllDigits(value: string): boolean {
  if (value.length === 0) {
    return false;
  }

  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);

    if (code < 48 || code > 57) {
      return false;
    }
  }

  return true;
}

function isAlpha(value: string): boolean {
  if (!value.length) {
    return false;
  }

  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const upper = code >= 65 && code <= 90;
    const lower = code >= 97 && code <= 122;

    if (!upper && !lower) {
      return false;
    }
  }

  return true;
}

function isAlphaNumericDash(value: string): boolean {
  if (!value.length) {
    return false;
  }

  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const upper = code >= 65 && code <= 90;
    const lower = code >= 97 && code <= 122;
    const digit = code >= 48 && code <= 57;

    if (!upper && !lower && !digit && code !== 45 && code !== 95) {
      return false;
    }
  }

  return true;
}
