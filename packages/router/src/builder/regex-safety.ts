import type { QuantifierFrame, RegexSafetyAssessment } from './types';

import { BACKREFERENCE_PATTERN } from './constants';

/**
 * Regex 안전 가드.
 *
 * ReDoS 의 *원인*은 패턴 길이가 아니라 *구조*다 — OWASP ReDoS Cheat Sheet,
 * Snyk safe-regex, Google re2 어디에도 길이 한도는 없다. 길이 가드는 표준
 * 부재의 자의적 휴리스틱이라 제거했다. 본질적 가드 두 개만 남긴다:
 *
 *   1. 중첩 무제한 quantifier (`(a+)+`, `(a*)*`, `(a{1,})+` 등) 거부
 *   2. backreference (`\1`, `\k<name>`) 거부 — 지수 복잡도 매칭 가능
 *
 * 둘 다 보안 디폴트라 사용자 옵션으로 약화 못 하게 의도적으로 하드코딩한다.
 */
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

export function assessRegexSafety(pattern: string): RegexSafetyAssessment {
  if (BACKREFERENCE_PATTERN.test(pattern)) {
    return { safe: false, reason: 'Backreferences are not allowed in route params' };
  }

  if (hasNestedUnlimitedQuantifiers(pattern)) {
    return { safe: false, reason: 'Nested unlimited quantifiers detected' };
  }

  return { safe: true };
}
