import type { QuantifierFrame, RegexSafetyAssessment, RegexSafetyConfig } from './types';

import { BACKREFERENCE_PATTERN } from './constants';

function hasNestedUnlimitedQuantifiers(pattern: string): boolean {
  const stack: QuantifierFrame[] = [];
  let lastAtomUnlimited = false;

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];

    if (char === '\\') {
      i++;

      lastAtomUnlimited = false;

      continue;
    }

    if (char === '[') {
      i = skipCharClass(pattern, i);
      lastAtomUnlimited = false;

      continue;
    }

    if (char === '(') {
      stack.push({ hadUnlimited: false });

      lastAtomUnlimited = false;

      continue;
    }

    if (char === ')') {
      const frame = stack.pop();
      const groupUnlimited = Boolean(frame?.hadUnlimited);

      if (groupUnlimited && stack.length) {
        const frame = stack[stack.length - 1];

        if (frame) {
          frame.hadUnlimited = true;
        }
      }

      lastAtomUnlimited = groupUnlimited;

      continue;
    }

    if (char === '*' || char === '+') {
      if (lastAtomUnlimited) {
        return true;
      }

      lastAtomUnlimited = true;

      if (stack.length) {
        const frame = stack[stack.length - 1];

        if (frame) {
          frame.hadUnlimited = true;
        }
      }

      continue;
    }

    if (char === '{') {
      const close = pattern.indexOf('}', i + 1);

      if (close === -1) {
        lastAtomUnlimited = false;

        continue;
      }

      const slice = pattern.slice(i + 1, close);
      const unlimited = slice.includes(',');

      if (unlimited) {
        if (lastAtomUnlimited) {
          return true;
        }

        lastAtomUnlimited = true;

        if (stack.length) {
          const frame = stack[stack.length - 1];

          if (frame) {
            frame.hadUnlimited = true;
          }
        }
      } else {
        lastAtomUnlimited = false;
      }

      i = close;

      continue;
    }

    lastAtomUnlimited = false;
  }

  return false;
}

function skipCharClass(pattern: string, start: number): number {
  let i = start + 1;

  while (i < pattern.length) {
    const char = pattern[i];

    if (char === '\\') {
      i += 2;

      continue;
    }

    if (char === ']') {
      return i;
    }

    i++;
  }

  return pattern.length - 1;
}

export function assessRegexSafety(pattern: string, options: RegexSafetyConfig): RegexSafetyAssessment {
  if (pattern.length > options.maxLength) {
    return { safe: false, reason: `Regex length ${pattern.length} exceeds limit ${options.maxLength}` };
  }

  if (options.forbidBackreferences && BACKREFERENCE_PATTERN.test(pattern)) {
    return { safe: false, reason: 'Backreferences are not allowed in route params' };
  }

  if (options.forbidBacktrackingTokens && hasNestedUnlimitedQuantifiers(pattern)) {
    return { safe: false, reason: 'Nested unlimited quantifiers detected' };
  }

  return { safe: true };
}
