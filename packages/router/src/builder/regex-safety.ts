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

/**
 * Return the index of the `]` that closes the char-class starting at
 * `start` (which must point at the opening `[`). When the class is
 * unterminated, return the last in-bounds index so callers' `i+1` step
 * lands at `pattern.length` and exits their walk loop cleanly.
 *
 * Backslash-escapes inside `[...]` consume the following byte, so `[\]]`
 * is a class containing a literal `]`.
 */
function skipCharClass(pattern: string, start: number): number {
  let i = start + 1;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '\\') { i += 2; continue; }
    if (ch === ']') return i;
    i++;
  }
  return pattern.length - 1;
}

export function assessRegexSafety(pattern: string): RegexSafetyAssessment {
  // Group construct whitelist (RFC §7.2 line 1123-1125): only `(?:...)`
  // non-capturing groups are allowed. Capturing `(`, named `(?<x>)`,
  // lookaround `(?=)/(?!)/(?<=)/(?<!)`, and inline-flag `(?i)/(?m)/(?s)`
  // groups are all rejected. Run before the structural checks below so
  // unsafe constructs surface a clear reason.
  const groupFault = scanGroupConstructs(pattern);
  if (groupFault !== null) {
    return { safe: false, reason: groupFault };
  }

  if (BACKREFERENCE_PATTERN.test(pattern)) {
    return { safe: false, reason: 'Backreferences are not allowed in route params' };
  }

  if (hasNestedUnlimitedQuantifiers(pattern)) {
    return { safe: false, reason: 'Nested unlimited quantifiers detected' };
  }

  if (hasOverlappingAlternationUnderRepeat(pattern)) {
    return { safe: false, reason: 'Quantifier on alternation group with overlapping branches (polynomial backtracking risk)' };
  }

  return { safe: true };
}

/**
 * Walk the pattern and reject any `(` that is not the start of a
 * non-capturing group `(?:`. Returns `null` when every group is `(?:...)`
 * or when there are no groups.
 */
function scanGroupConstructs(pattern: string): string | null {
  const len = pattern.length;
  let i = 0;
  while (i < len) {
    const ch = pattern[i];
    if (ch === '\\') { i += 2; continue; }
    if (ch === '[') { i = skipCharClass(pattern, i) + 1; continue; }
    if (ch !== '(') { i++; continue; }

    // Got a `(`. Must be followed by `?:` to be allowed.
    if (pattern[i + 1] !== '?') {
      return 'Capturing groups are not allowed; use `(?:...)` instead';
    }
    const c2 = pattern[i + 2];
    if (c2 === ':') { i += 3; continue; }
    if (c2 === '=' || c2 === '!') {
      return 'Lookahead `(?=...)` / `(?!...)` is not allowed';
    }
    if (c2 === '<') {
      const c3 = pattern[i + 3];
      if (c3 === '=' || c3 === '!') {
        return 'Lookbehind `(?<=...)` / `(?<!...)` is not allowed';
      }
      return 'Named capture groups `(?<name>...)` are not allowed; use `(?:...)` instead';
    }
    if (c2 === 'i' || c2 === 'm' || c2 === 's' || c2 === 'x' || c2 === 'u') {
      return 'Inline flag groups `(?i)` / `(?m)` / `(?s)` are not allowed';
    }
    return `Unknown group construct '(?${c2 ?? ''}' is not allowed; only \`(?:...)\` is supported`;
  }
  return null;
}

/**
 * Reject `(a|aa)+`, `(a|a?)+`, `(x|xy)*` and similar shapes where a quantified
 * group's alternatives can match the same prefix. Conservative scan: detect a
 * top-level alternation inside `()` followed by `*`, `+`, or `{m,n}` with
 * `n>1` and check whether any pair of branches share a non-empty literal
 * prefix (or one branch is `\w?`-style optional). Anything ambiguous is
 * rejected — false positives are acceptable; false negatives are not.
 */
function hasOverlappingAlternationUnderRepeat(pattern: string): boolean {
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === '\\') { i += 2; continue; }
    if (pattern[i] === '[') { i = skipCharClass(pattern, i) + 1; continue; }
    if (pattern[i] !== '(') { i++; continue; }

    // Scan to matching close paren at the same nesting level, capturing
    // top-level alternation branches.
    const groupStart = i + 1;
    let depth = 1;
    let j = groupStart;
    const splits: number[] = [];
    while (j < pattern.length && depth > 0) {
      const c = pattern[j];
      if (c === '\\') { j += 2; continue; }
      if (c === '[') { j = skipCharClass(pattern, j) + 1; continue; }
      if (c === '(') { depth++; j++; continue; }
      if (c === ')') { depth--; if (depth === 0) break; j++; continue; }
      if (c === '|' && depth === 1) splits.push(j);
      j++;
    }

    const groupEnd = j; // position of matching ')'
    if (depth !== 0) return false; // unmatched, parser will catch elsewhere

    // Quantifier following the group?
    const after = pattern[groupEnd + 1];
    const quantified =
      after === '*' || after === '+' ||
      (after === '{' && /\{\d*,(?:\d+)?\}/.test(pattern.slice(groupEnd + 1, groupEnd + 8)));

    if (quantified && splits.length >= 1) {
      // Build branches.
      const branches: string[] = [];
      let prev = groupStart;
      for (const s of splits) { branches.push(pattern.slice(prev, s)); prev = s + 1; }
      branches.push(pattern.slice(prev, groupEnd));

      if (branchesOverlap(branches)) return true;
    }

    i = groupEnd + 1;
  }
  return false;
}

function branchesOverlap(branches: string[]): boolean {
  // Strip leading `(?:` group-flag if present (non-capturing) — branch text
  // here is the inner group content, so prefixes are the branch chars.
  for (let a = 0; a < branches.length; a++) {
    for (let b = a + 1; b < branches.length; b++) {
      if (sharePrefix(branches[a]!, branches[b]!)) return true;
    }
  }
  return false;
}

// Two branches "share a prefix" if at least one non-empty starting literal
// (or its prefix) matches the other in a way that lets the matcher take
// either path on the same input. For conservative purposes:
//   - empty branch overlaps with any non-empty branch (`(a|)+`)
//   - identical first literal char overlaps (`a|aa`, `ab|ac`)
//   - branch ending in `?` overlaps if its required prefix is a prefix of the other (`a|a?` shares "a")
function sharePrefix(x: string, y: string): boolean {
  if (x === '' || y === '') return true;
  // Strip non-capturing group prefix if present.
  const xs = x.startsWith('(?:') && x.endsWith(')') ? x.slice(3, -1) : x;
  const ys = y.startsWith('(?:') && y.endsWith(')') ? y.slice(3, -1) : y;
  // If either branch starts with `?` (after a literal), peel until first non-`?` literal.
  const fx = firstLiteralByte(xs);
  const fy = firstLiteralByte(ys);
  if (fx === null || fy === null) return true;
  return fx === fy;
}

function firstLiteralByte(s: string): string | null {
  if (s.length === 0) return null;
  if (s[0] === '\\') return s.slice(0, 2);
  return s[0]!;
}

