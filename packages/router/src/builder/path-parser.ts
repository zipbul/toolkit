import type { Result } from '@zipbul/result';
import type { RouterErrorData } from '../types';

import { err, isErr } from '@zipbul/result';
import {
  CC_COLON,
  CC_LPAREN,
  CC_PLUS,
  CC_QUESTION,
  CC_RPAREN,
  CC_SLASH,
  CC_STAR,
  MAX_PARAMS,
  MAX_SEGMENTS,
} from './constants';
import { normalizeParamPatternSource } from './pattern-utils';
import { assessRegexSafety } from './regex-safety';

// ── Types ──

export type PathPart =
  | { type: 'static'; value: string }
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

  /** Stage 1 — structural sanity. Fails fast on `''`, missing `/`. */
  private validatePath(path: string): Result<never, RouterErrorData> | null {
    if (path.length === 0 || path.charCodeAt(0) !== CC_SLASH) {
      return err({
        kind: 'route-parse',
        message: `Path must start with '/': ${path}`,
        path,
      });
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

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      const firstChar = seg.charCodeAt(0);

      if (firstChar === CC_COLON) {
        if (staticBuf.length > 0) {
          parts.push({ type: 'static', value: staticBuf });
          staticBuf = '';
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
          parts.push({ type: 'static', value: staticBuf });
          staticBuf = '';
        }

        isDynamic = true;

        const wcResult = this.parseWildcard(seg, i, segments.length, path);

        if (isErr(wcResult)) {
          return wcResult;
        }

        parts.push(wcResult);
      } else {
        staticBuf += seg;

        if (i < segments.length - 1) {
          staticBuf += '/';
        }
      }
    }

    if (staticBuf.length > 0) {
      parts.push({ type: 'static', value: staticBuf });
    }

    // Root path `/` with no segments
    if (parts.length === 0) {
      parts.push({ type: 'static', value: '/' });
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

  for (let i = 0; i < name.length; i++) {
    const ch = name.charCodeAt(i);

    if (
      ch === CC_COLON
      || ch === CC_STAR
      || ch === CC_QUESTION
      || ch === CC_PLUS
      || ch === CC_SLASH
      || ch === CC_LPAREN
      || ch === CC_RPAREN
    ) {
      const hint = prefix === ':'
        ? "Use '/:a/:b' for two consecutive params."
        : "Wildcards do not accept regex patterns — use a regex param like ':name(...)' for that.";

      return err({
        kind: 'route-parse',
        message: `Invalid character '${name.charAt(i)}' in ${prefix === ':' ? 'parameter' : 'wildcard'} name '${prefix}${name}'. Names must not contain router metacharacters (':', '*', '?', '+', '/', '(', ')'). ${hint}`,
        path,
        segment: name,
      });
    }
  }

  return null;
}
