import type { PatternTesterOptions, RouteRegexTimeoutError } from './types';

import { ROUTE_REGEX_TIMEOUT } from './constants';

const DIGIT_PATTERNS = new Set(['\\d+', '\\d{1,}', '[0-9]+', '[0-9]{1,}']);
const ALPHA_PATTERNS = new Set(['[a-zA-Z]+', '[A-Za-z]+']);
const ALPHANUM_PATTERNS = new Set(['[A-Za-z0-9_\\-]+', '[A-Za-z0-9_-]+', '\\w+', '\\w{1,}']);

const now = (): number => Number(Bun.nanoseconds()) / 1e6;

function buildPatternTester(
  source: string | undefined,
  compiled: RegExp,
  options?: PatternTesterOptions,
): (value: string) => boolean {
  const raw = source ?? '<anonymous>';

  const wrap = (tester: (value: string) => boolean): ((value: string) => boolean) => {
    const maxExecutionMs = options?.maxExecutionMs;

    if (maxExecutionMs === undefined || maxExecutionMs <= 0) {
      return tester;
    }

    const limit = maxExecutionMs;

    return value => {
      const start = now();
      const result = tester(value);
      const duration = now() - start;

      if (duration > limit) {
        const shouldThrow = options?.onTimeout?.(raw, duration);

        if (shouldThrow === false) {
          return false;
        }

        const timeoutError = new Error(
          `Route parameter regex '${raw}' exceeded ${limit} ms(took ${duration.toFixed(3)}ms)`,
        ) as RouteRegexTimeoutError;

        Object.defineProperty(timeoutError, ROUTE_REGEX_TIMEOUT, {
          value: true,
          configurable: true,
        });

        throw timeoutError;
      }

      return result;
    };
  };

  if (source === undefined || source.length === 0) {
    return wrap(value => compiled.test(value));
  }

  if (DIGIT_PATTERNS.has(source)) {
    return isAllDigits;
  }

  if (ALPHA_PATTERNS.has(source)) {
    return isAlpha;
  }

  if (ALPHANUM_PATTERNS.has(source)) {
    return isAlphaNumericDash;
  }

  if (source === '[^/]+') {
    return value => value.length > 0 && !value.includes('/');
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

export { buildPatternTester, ROUTE_REGEX_TIMEOUT };
export type { PatternTesterOptions, RouteRegexTimeoutError };
