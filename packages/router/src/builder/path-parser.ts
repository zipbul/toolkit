import type { Result } from '@zipbul/result';
import type { RouterErrorData } from '../types';

import { err, isErr } from '@zipbul/result';
import {
  CC_COLON,
  CC_PLUS,
  CC_SLASH,
  CC_STAR,
  MAX_PARAMS,
  MAX_SEGMENTS,
} from './constants';
import { normalizeParamPatternSource } from './pattern-utils';
import { assessRegexSafety } from './regex-safety';

// ── Types ──

export type PathPart =
  | { type: 'static'; value: string; segments: string[] }
  | { type: 'param'; name: string; pattern: string | null; optional: boolean }
  | { type: 'wildcard'; name: string; origin: 'star' | 'multi' };

export interface ParseResult {
  parts: PathPart[];
  normalized: string;
  isDynamic: boolean;
}

export interface PathParserConfig {
  caseSensitive: boolean;
  ignoreTrailingSlash: boolean;
  maxSegmentLength: number;
}

// ── PathParser ──

export class PathParser {
  private readonly config: PathParserConfig;
  private readonly activeParams = new Set<string>();

  constructor(config: PathParserConfig) {
    this.config = config;
  }

  /**
   * 3-stage pipeline:
   *   1. validatePath  — cheap structural pre-flight (leading `/`).
   *   2. tokenize      — split + trailing-slash + case-fold + length/count gates.
   *   3. parseTokens   — semantic parse into PathPart[].
   * Each stage is independently testable; failures short-circuit with `Err`.
   */
  parse(path: string): Result<ParseResult, RouterErrorData> {
    const validation = this.validatePath(path);

    if (validation !== null) return validation;

    const tokenizeResult = this.tokenize(path);

    if (isErr(tokenizeResult)) return tokenizeResult;

    const { segments, normalized } = tokenizeResult;

    return this.parseTokens(segments, normalized, path);
  }

  // Single-pass char-code scan covering the structural-sanity check (leading
  // `/`, non-empty) plus the secure-profile rejects: raw `?`/`#`, C0/DEL,
  // non-ASCII, malformed percent, dot segments. Router grammar tokens
  // (`:`, `*`, `(`, `)`, `+`) are intentionally accepted here so that
  // tokenize/parseTokens can resolve them. The `?` byte is permitted only
  // when it directly follows an identifier char and ends the segment, which
  // is the `:name?` optional decorator.
  private validatePath(path: string): Result<never, RouterErrorData> | null {
    if (path.length === 0 || path.charCodeAt(0) !== CC_SLASH) {
      return err({
        kind: 'route-parse',
        message: `Path must start with '/': ${path}`,
        path,
      });
    }

    // Single-pass scan for control / non-ASCII / fragment / malformed-percent / dot-segment.
    // Track segment boundaries via slash position tracking for dot-segment detection.
    let segStart = 1; // skip leading `/`
    const len = path.length;
    for (let i = 0; i < len; i++) {
      const c = path.charCodeAt(i);

      // Raw fragment `#` (0x23) — never valid in registered path
      if (c === 0x23) {
        return err({
          kind: 'route-parse',
          message: `Path must not contain raw fragment '#': ${path}`,
          path,
          suggestion: 'Use percent-encoded form `%23` for literal `#`.',
        });
      }

      // Raw query `?` (0x3f) — only valid as `:name?` decorator suffix.
      // After `?`, next char must be `/` or end-of-path.
      if (c === 0x3f) {
        // Acceptable when preceded by an identifier-like name and at segment-end.
        // Conservative: require previous char alnum or `_` and next char `/` or end.
        const prev = i > 0 ? path.charCodeAt(i - 1) : 0;
        const isIdentChar = (prev >= 0x30 && prev <= 0x39) || (prev >= 0x41 && prev <= 0x5a) ||
                            (prev >= 0x61 && prev <= 0x7a) || prev === 0x5f;
        const next = i + 1 < len ? path.charCodeAt(i + 1) : 0;
        const isSegEnd = next === 0 || next === CC_SLASH;
        if (!isIdentChar || !isSegEnd) {
          return err({
            kind: 'route-parse',
            message: `Path must not contain raw query '?' (use \`:name?\` decorator only): ${path}`,
            path,
            suggestion: 'Optional param decorator `?` must follow a param name and end the segment.',
          });
        }
      }

      // C0 control (0x00-0x1f) and DEL (0x7f)
      if ((c >= 0x00 && c <= 0x1f) || c === 0x7f) {
        return err({
          kind: 'route-parse',
          message: `Path must not contain control characters (charCode 0x${c.toString(16).padStart(2, '0')}): ${path}`,
          path,
          suggestion: 'Remove control characters from the route pattern.',
        });
      }

      // Raw non-ASCII (0x80+)
      if (c >= 0x80) {
        return err({
          kind: 'route-parse',
          message: `Path must not contain raw non-ASCII bytes (charCode 0x${c.toString(16)}): ${path}`,
          path,
          suggestion: 'Represent non-ASCII characters as percent-encoded UTF-8 (e.g. `%ED%95%9C` for `한`).',
        });
      }

      // Malformed percent (`%` not followed by 2 hex)
      if (c === 0x25) {
        if (i + 2 >= len || !isHex(path.charCodeAt(i + 1)) || !isHex(path.charCodeAt(i + 2))) {
          return err({
            kind: 'route-parse',
            message: `Path contains malformed percent-escape: ${path}`,
            path,
            suggestion: 'Every `%` must be followed by exactly two hex digits (0-9, A-F, a-f).',
          });
        }
      }

      // Segment boundary check for dot segment detection
      if (c === CC_SLASH || i === len - 1) {
        const segEnd = c === CC_SLASH ? i : i + 1;
        if (segEnd > segStart) {
          if (isDotSegment(path, segStart, segEnd)) {
            return err({
              kind: 'route-parse',
              message: `Path must not contain dot segments '.' or '..' (literal or percent-encoded): ${path}`,
              path,
              suggestion: 'Remove dot segments. Encoded forms `%2e`, `%2E`, `%2e%2e` are also rejected.',
            });
          }
        }
        segStart = i + 1;
      }
    }

    return null;
  }

  /**
   * Stage 2 — split + normalize + enforce hard limits. Returns the segment
   * array consumed by stage 3 alongside the canonical normalized path used
   * by lookup. Limits enforced here (segment count ≤ 64, length ≤ maxLen,
   * param count ≤ MAX_PARAMS) are token-level constraints, so they belong
   * with tokenization rather than semantic parse.
   */
  private tokenize(
    path: string,
  ): Result<{ segments: string[]; normalized: string }, RouterErrorData> {
    // Split by '/' (skip leading '/')
    const body = path.length > 1 ? path.slice(1) : '';
    const segments = body === '' ? [] : body.split('/');

    // Handle trailing slash
    if (this.config.ignoreTrailingSlash) {
      if (segments.length > 0 && segments[segments.length - 1] === '') {
        segments.pop();
      }
    }

    for (const seg of segments) {
      if (seg === '') {
        return err({
          kind: 'route-parse',
          message: `Path must not contain empty segments: ${path}`,
          path,
          suggestion: 'Collapse repeated slashes or register a single canonical path.',
        });
      }
    }

    // Case fold (static segments only — dynamic ones keep original case for param names)
    if (!this.config.caseSensitive) {
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i]!;
        const firstChar = seg.charCodeAt(0);

        if (firstChar !== CC_COLON && firstChar !== CC_STAR) {
          segments[i] = seg.toLowerCase();
        }
      }
    }

    // Validate segment lengths (static segments only)
    const maxLen = this.config.maxSegmentLength;

    for (const seg of segments) {
      const firstChar = seg.charCodeAt(0);

      if (firstChar !== CC_COLON && firstChar !== CC_STAR && seg.length > maxLen) {
        return err({
          kind: 'segment-limit',
          message: `Segment length exceeds limit: ${seg.substring(0, 20)}...`,
          segment: seg.substring(0, 40),
          suggestion: `Shorten the path segment to ${maxLen} characters or fewer.`,
        });
      }
    }

    // Validate segment count
    if (segments.length > MAX_SEGMENTS) {
      return err({
        kind: 'segment-limit',
        message: `Path has ${segments.length} segments, exceeding the maximum of ${MAX_SEGMENTS}: ${path}`,
        path,
        suggestion: `Split deeply nested routes into shorter sub-paths (limit is ${MAX_SEGMENTS}).`,
      });
    }

    // Validate param count
    let paramCount = 0;

    for (const seg of segments) {
      const fc = seg.charCodeAt(0);

      if (fc === CC_COLON || fc === CC_STAR) {
        paramCount++;
      }
    }

    if (paramCount > MAX_PARAMS) {
      return err({
        kind: 'segment-limit',
        message: `Path has ${paramCount} parameters, exceeding the maximum of ${MAX_PARAMS}: ${path}`,
        path,
        suggestion: `Reduce the number of named parameters in this path (limit is ${MAX_PARAMS}).`,
      });
    }

    const normalized = segments.length > 0 ? '/' + segments.join('/') : '/';

    return { segments, normalized };
  }

  /**
   * Stage 3 — walk the tokenized segments and emit `PathPart[]`. Static
   * segments are accumulated into a buffer and flushed when a dynamic one
   * appears; consecutive statics share a single PathPart so the matcher can
   * compare prefixes in one go.
   */
  private parseTokens(
    segments: string[],
    normalized: string,
    path: string,
  ): Result<ParseResult, RouterErrorData> {
    this.activeParams.clear();

    const parts: PathPart[] = [];
    let isDynamic = false;
    let staticBuf = '/';
    let currentStaticSegments: string[] = [];

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      const firstChar = seg.charCodeAt(0);

      if (firstChar === CC_COLON) {
        if (staticBuf.length > 0) {
          parts.push({ type: 'static', value: staticBuf, segments: currentStaticSegments });
          staticBuf = '';
          currentStaticSegments = [];
        }

        isDynamic = true;

        const paramResult = this.parseParam(seg, path);

        if (isErr(paramResult)) {
          return paramResult;
        }

        // If parseParam returned a wildcard (from :name+ or :name* syntax)
        if (paramResult.type === 'wildcard') {
          if (i !== segments.length - 1) {
            return err({
              kind: 'route-parse',
              message: `Wildcard ':${paramResult.name}+' must be the last segment: ${path}`,
              path,
            });
          }

          parts.push(paramResult);
          break;
        }

        parts.push(paramResult);

        if (i < segments.length - 1) {
          staticBuf = '/';
        }
      } else if (firstChar === CC_STAR) {
        if (staticBuf.length > 0) {
          parts.push({ type: 'static', value: staticBuf, segments: currentStaticSegments });
          staticBuf = '';
          currentStaticSegments = [];
        }

        isDynamic = true;

        const wcResult = this.parseWildcard(seg, i, segments.length, path);

        if (isErr(wcResult)) {
          return wcResult;
        }

        parts.push(wcResult);
      } else {
        staticBuf += seg;
        currentStaticSegments.push(seg);

        if (i < segments.length - 1) {
          staticBuf += '/';
        }
      }
    }

    if (staticBuf.length > 0) {
      parts.push({ type: 'static', value: staticBuf, segments: currentStaticSegments });
    }

    // Root path `/` with no segments
    if (parts.length === 0) {
      parts.push({ type: 'static', value: '/', segments: [] });
    }

    return { parts, normalized, isDynamic };
  }

  private parseParam(seg: string, path: string): Result<PathPart, RouterErrorData> {
    let core = seg;
    let isOptional = false;

    // Check trailing decorators
    if (core.endsWith('?')) {
      const beforeOptional = core.charCodeAt(core.length - 2);

      if (beforeOptional === CC_PLUS || beforeOptional === CC_STAR) {
        return err({
          kind: 'route-parse',
          message: `Invalid decorator combination in parameter '${seg}': ${path}`,
          path,
          segment: seg,
          suggestion: 'Use either optional params (:name?) or wildcard params (:name+ / :name*), not both.',
        });
      }

      isOptional = true;
      core = core.slice(0, -1);
    }

    // Multi/zero-or-more → convert to wildcard (only if no '(' pattern)
    if (core.endsWith('+') && !core.includes('(')) {
      const name = core.slice(1, -1); // skip ':' and '+'
      const validation = validateParamName(name, ':', path);

      if (validation !== null) return validation;

      const dup = this.registerParam(name, ':', path);

      if (dup !== null) return dup;

      return { type: 'wildcard', name, origin: 'multi' };
    }

    if (core.endsWith('*') && !core.includes('(')) {
      const name = core.slice(1, -1); // skip ':' and '*'
      const validation = validateParamName(name, ':', path);

      if (validation !== null) return validation;

      const dup = this.registerParam(name, ':', path);

      if (dup !== null) return dup;

      return { type: 'wildcard', name, origin: 'star' };
    }

    // Extract name and pattern
    let name: string;
    let pattern: string | null = null;
    const parenIdx = core.indexOf('(');

    if (parenIdx === -1) {
      name = core.slice(1); // skip ':'
    } else {
      name = core.slice(1, parenIdx);

      if (!core.endsWith(')')) {
        return err({
          kind: 'route-parse',
          message: `Unclosed regex pattern in parameter ':${name}': ${path}`,
          path,
        });
      }

      // Whitespace-only `(   )` collapses to no-pattern, matching the empty
      // `()` shape — the matcher would otherwise compile a literal-whitespace
      // regex which is almost certainly a typo.
      const rawPattern = core.slice(parenIdx + 1, -1);
      pattern = rawPattern.trim() === '' ? null : normalizeParamPatternSource(rawPattern);
    }

    const nameValidation = validateParamName(name, ':', path);

    if (nameValidation !== null) return nameValidation;

    const dup = this.registerParam(name, ':', path);

    if (dup !== null) return dup;

    // Validate regex pattern
    if (pattern !== null) {
      const safetyResult = this.validatePattern(pattern);

      if (isErr(safetyResult)) {
        return safetyResult;
      }
    }

    return { type: 'param', name, pattern, optional: isOptional };
  }

  private parseWildcard(
    seg: string,
    index: number,
    totalSegments: number,
    path: string,
  ): Result<PathPart, RouterErrorData> {
    // Determine origin
    let core = seg.slice(1); // skip '*'
    let origin: 'star' | 'multi' = 'star';

    if (core.endsWith('+')) {
      origin = 'multi';
      core = core.slice(0, -1);
    }

    const name = core || '*';

    if (name !== '*') {
      const validation = validateParamName(name, '*', path);

      if (validation !== null) return validation;
    }

    // Wildcard must be the last segment
    if (index !== totalSegments - 1) {
      return err({
        kind: 'route-parse',
        message: `Wildcard '*${name}' must be the last segment: ${path}`,
        path,
      });
    }

    const dup = this.registerParam(name, '*', path);

    if (dup !== null) return dup;

    return { type: 'wildcard', name, origin };
  }

  /**
   * Reject duplicate `:name` / `*name` within the same path. Returns null on
   * success (and registers the name), or an `Err` carrying the duplicate
   * diagnostic. Caller must run `validateParamName` first — this helper
   * trusts the name shape and only enforces uniqueness.
   */
  private registerParam(
    name: string,
    prefix: ':' | '*',
    path: string,
  ): Result<never, RouterErrorData> | null {
    if (this.activeParams.has(name)) {
      return err({
        kind: 'param-duplicate',
        message: `Duplicate parameter name '${prefix}${name}' in path: ${path}`,
        path,
        segment: name,
        suggestion: `Rename one of the '${prefix}${name}' parameters so each name is unique within the path.`,
      });
    }

    this.activeParams.add(name);

    return null;
  }

  /**
   * Strip anchors and apply hardcoded ReDoS guards (length cap, nested
   * unlimited quantifiers, backreferences). The guards are not user-tunable —
   * weakening them is a security regression. Failure is reported as
   * `regex-unsafe` with the specific reason.
   */
  private validatePattern(pattern: string): Result<void, RouterErrorData> {
    const assessment = assessRegexSafety(pattern);

    if (!assessment.safe) {
      return err<RouterErrorData>({
        kind: 'regex-unsafe',
        message: `Unsafe regex pattern: ${assessment.reason}`,
        segment: pattern,
        suggestion: 'Simplify the regex (avoid nested unlimited quantifiers and backreferences) or shorten its source.',
      });
    }
  }
}

/**
 * Reject router-metacharacters inside a param/wildcard name. Without this,
 * `/:a:b` silently parses as a single param named "a:b" and `/*p(\w+)`
 * registers a wildcard with the literal name `p(\w+)` — both surprising
 * non-matches at runtime. We allow letters, digits, underscore, hyphen,
 * and any non-metacharacter Unicode chars.
 *
 * Returns null when the name is acceptable, or a parse error otherwise.
 * `prefix` is `:` for params and `*` for wildcards — used in the error
 * message so the user sees the exact form they wrote.
 */
function validateParamName(
  name: string,
  prefix: ':' | '*',
  path: string,
): Result<never, RouterErrorData> | null {
  if (name === '') {
    return err({
      kind: 'route-parse',
      message: `Empty parameter name in path: ${path}`,
      path,
    });
  }

  // Strict check: Only snake_case and camelCase allowed.
  // Pattern: ^[a-zA-Z][a-zA-Z0-9_]*$
  const firstCode = name.charCodeAt(0);
  const isFirstLetter = (firstCode >= 65 && firstCode <= 90) || (firstCode >= 97 && firstCode <= 122);

  if (!isFirstLetter) {
    return err({
      kind: 'route-parse',
      message: `Invalid parameter name '${prefix}${name}' in path: ${path}. Parameter names must start with a letter.`,
      path,
      segment: name,
    });
  }

  for (let i = 1; i < name.length; i++) {
    const ch = name.charCodeAt(i);
    const isLetter = (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122);
    const isDigit = ch >= 48 && ch <= 57;
    const isUnderscore = ch === 95;

    if (!isLetter && !isDigit && !isUnderscore) {
      return err({
        kind: 'route-parse',
        message: `Invalid character '${name.charAt(i)}' in parameter name '${prefix}${name}'. Only alphanumeric characters and underscores are allowed (snake_case or camelCase).`,
        path,
        segment: name,
      });
    }
  }

  return null;
}

function isHex(c: number): boolean {
  return (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
}

// True only when the segment, after decoding `%2e`/`%2E` to `.`, is exactly
// `.` or `..`. `.well-known`, `a..`, `...`, `%2e%2e%2e` are not dot segments.
function isDotSegment(path: string, segStart: number, segEnd: number): boolean {
  let dotCount = 0;
  let nonDot = false;
  let i = segStart;
  while (i < segEnd) {
    const c = path.charCodeAt(i);
    if (c === 0x2e) { // '.'
      dotCount++;
      i++;
      continue;
    }
    if (c === 0x25 && i + 2 < segEnd) { // '%' + 2 hex
      const h1 = path.charCodeAt(i + 1);
      const h2 = path.charCodeAt(i + 2);
      if ((h1 === 0x32) && (h2 === 0x65 || h2 === 0x45)) { // '%2e' or '%2E'
        dotCount++;
        i += 3;
        continue;
      }
    }
    nonDot = true;
    break;
  }
  if (nonDot) return false;
  return dotCount === 1 || dotCount === 2;
}
