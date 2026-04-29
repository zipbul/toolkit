export const TESTER_FAIL = 0 as const;
export const TESTER_PASS = 1 as const;
export const TESTER_TIMEOUT = 2 as const;

export type TesterResult = typeof TESTER_FAIL | typeof TESTER_PASS | typeof TESTER_TIMEOUT;

/**
 * Pattern tester closure. Hot-path matcher invokes this to validate a
 * captured param against its compiled regex.
 *
 * Lives in matcher/ rather than src/types.ts so the types module
 * stays at the *bottom* of the dependency graph (no `types →
 * matcher` edge).
 */
export type PatternTesterFn = (value: string) => TesterResult;

export interface PatternTesterOptions {
  readonly maxExecutionMs?: number;
}

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

const now = (): number => Number(Bun.nanoseconds()) / 1e6;

function buildPatternTester(
  source: string | undefined,
  compiled: RegExp,
  options?: PatternTesterOptions,
): (value: string) => TesterResult {
  const wrap = (tester: (value: string) => boolean): ((value: string) => TesterResult) => {
    const maxExecutionMs = options?.maxExecutionMs;

    if (maxExecutionMs === undefined || maxExecutionMs <= 0) {
      return value => (tester(value) ? TESTER_PASS : TESTER_FAIL);
    }

    const limit = maxExecutionMs;

    return value => {
      const start = now();
      const result = tester(value);
      const duration = now() - start;

      if (duration > limit) return TESTER_TIMEOUT;

      return result ? TESTER_PASS : TESTER_FAIL;
    };
  };

  if (source === undefined || source.length === 0) {
    return wrap(value => compiled.test(value));
  }

  if (DIGIT_PATTERNS.has(source)) {
    return wrap(isAllDigits);
  }

  if (ALPHA_PATTERNS.has(source)) {
    return wrap(isAlpha);
  }

  if (ALPHANUM_PATTERNS.has(source)) {
    return wrap(isAlphaNumericDash);
  }

  if (source === '[^/]+') {
    return wrap(value => value.length > 0 && !value.includes('/'));
  }

  return wrap(value => compiled.test(value));
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

export { buildPatternTester };
