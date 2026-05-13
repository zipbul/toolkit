import type { Result } from '@zipbul/result';
import type { RouterErrorData } from '../types';

import { err, isErr } from '@zipbul/result';
import {
  CC_COLON,
  CC_PLUS,
  CC_STAR,
} from './constants';
import { normalizeParamPatternSource } from './pattern-utils';
import { validatePathChars } from './path-policy';
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
  private validatePath(path: string): Result<never, RouterErrorData> | null {
    const result = validatePathChars(path);
    if (isErr(result)) return result;
    return null;
  }

  /**
   * Stage 2 — split + normalize. Returns the segment array consumed by
   * stage 3 alongside the canonical normalized path used by lookup.
   */
  private tokenize(
    path: string,
  ): Result<{ segments: string[]; normalized: string }, RouterErrorData> {
    // Manual charCodeAt scan beats `String.split('/')` 2.7× on typical
    // HTTP paths (bench/split-vs-manual.ts: 60ns vs 164ns) — split's
    // native fast path allocates a fresh internal buffer per call while
    // the manual loop reuses one growable array. Same observable shape:
    // leading '/' is skipped, trailing '/' produces an empty final entry
    // for the ignoreTrailingSlash branch below to pop.
    const segments: string[] = [];
    const len = path.length;
    if (len > 1) {
      let start = 1;
      for (let i = 1; i < len; i++) {
        if (path.charCodeAt(i) === 47) {
          segments.push(path.substring(start, i));
          start = i + 1;
        }
      }
      segments.push(path.substring(start));
    }

    // Handle trailing slash
    if (this.config.ignoreTrailingSlash) {
      if (segments.length > 0 && segments[segments.length - 1] === '') {
        segments.pop();
      }
    }

    // Single-pass walk: empty-segment check + case-fold for static segments.
    const caseSensitive = this.config.caseSensitive;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;

      if (seg === '') {
        return err({
          kind: 'path-empty-segment',
          message: `Path must not contain empty segments: ${path}`,
          path,
          suggestion: 'Collapse repeated slashes or register a single canonical path.',
        });
      }

      const firstChar = seg.charCodeAt(0);
      const isDynamic = firstChar === CC_COLON || firstChar === CC_STAR;

      if (isDynamic) {
        continue;
      }

      if (!caseSensitive) {
        segments[i] = seg.toLowerCase();
      }
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

