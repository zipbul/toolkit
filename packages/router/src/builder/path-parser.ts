import type { Result } from '@zipbul/result';
import type { RegexSafetyOptions, RouterErrData, RouterWarning } from '../types';

import { err, isErr } from '@zipbul/result';
import { PatternUtils } from './pattern-utils';
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
  regexSafety?: RegexSafetyOptions;
  regexAnchorPolicy?: 'warn' | 'error' | 'silent';
  onWarn?: (warning: RouterWarning) => void;
}

// ── PathParser ──

export class PathParser {
  private readonly config: PathParserConfig;
  private readonly patternUtils: PatternUtils;
  private readonly activeParams = new Set<string>();

  constructor(config: PathParserConfig) {
    this.config = config;
    this.patternUtils = new PatternUtils({
      regexSafety: config.regexSafety,
      regexAnchorPolicy: config.regexAnchorPolicy,
      onWarn: config.onWarn,
    });
  }

  parse(path: string): Result<ParseResult, RouterErrData> {
    // 1. Basic validation
    if (path.length === 0 || path.charCodeAt(0) !== 47) {
      return err({
        kind: 'route-parse',
        message: `Path must start with '/': ${path}`,
        path,
      });
    }

    // 2. Normalize segments
    const normResult = this.normalizeSegments(path);

    if (isErr(normResult)) {
      return normResult;
    }

    const { segments, normalized } = normResult;

    // 2b. Validate segment count
    if (segments.length > 64) {
      return err({
        kind: 'segment-limit',
        message: `Path has ${segments.length} segments, exceeding the maximum of 64: ${path}`,
        path,
      });
    }

    // 2c. Validate param count
    let paramCount = 0;

    for (const seg of segments) {
      const fc = seg.charCodeAt(0);

      if (fc === 58 || fc === 42) { // ':' or '*'
        paramCount++;
      }
    }

    if (paramCount > 32) {
      return err({
        kind: 'segment-limit',
        message: `Path has ${paramCount} parameters, exceeding the maximum of 32: ${path}`,
        path,
      });
    }

    // 3. Parse segments into PathParts
    this.activeParams.clear();

    const parts: PathPart[] = [];
    let isDynamic = false;
    let staticBuf = '/';

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      const firstChar = seg.charCodeAt(0);

      if (firstChar === 58) { // ':'
        // Flush static buffer
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

        // Add '/' separator after param (if not last segment)
        if (i < segments.length - 1) {
          staticBuf = '/';
        }
      } else if (firstChar === 42) { // '*'
        // Flush static buffer
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
        // Static segment
        staticBuf += seg;

        // Add '/' separator after static segment (if not last segment)
        if (i < segments.length - 1) {
          staticBuf += '/';
        }
      }
    }

    // Flush remaining static buffer
    if (staticBuf.length > 0) {
      parts.push({ type: 'static', value: staticBuf });
    }

    // Handle root path '/' with no segments
    if (parts.length === 0) {
      parts.push({ type: 'static', value: '/' });
    }

    return { parts, normalized, isDynamic };
  }

  private normalizeSegments(path: string): Result<{ segments: string[]; normalized: string }, RouterErrData> {
    // Split by '/' (skip leading '/')
    const body = path.length > 1 ? path.slice(1) : '';
    let segments = body === '' ? [] : body.split('/');

    // Handle trailing slash
    if (this.config.ignoreTrailingSlash) {
      if (segments.length > 0 && segments[segments.length - 1] === '') {
        segments.pop();
      }
    }

    // Case fold (static segments only — dynamic ones keep original case for param names)
    if (!this.config.caseSensitive) {
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i]!;
        const firstChar = seg.charCodeAt(0);

        // Don't lowercase :param or *wildcard segments
        if (firstChar !== 58 && firstChar !== 42) {
          segments[i] = seg.toLowerCase();
        }
      }
    }

    // Validate segment lengths (static segments only)
    const maxLen = this.config.maxSegmentLength;

    for (const seg of segments) {
      const firstChar = seg.charCodeAt(0);

      if (firstChar !== 58 && firstChar !== 42 && seg.length > maxLen) {
        return err({
          kind: 'segment-limit',
          message: `Segment length exceeds limit: ${seg.substring(0, 20)}...`,
          segment: seg.substring(0, 40),
          suggestion: `Shorten the path segment to ${maxLen} characters or fewer.`,
        });
      }
    }

    const normalized = segments.length > 0 ? '/' + segments.join('/') : '/';

    return { segments, normalized };
  }

  private parseParam(seg: string, path: string): Result<PathPart, RouterErrData> {
    let core = seg;
    let isOptional = false;

    // Check trailing decorators
    if (core.endsWith('?')) {
      isOptional = true;
      core = core.slice(0, -1);
    }

    // Multi/zero-or-more → convert to wildcard (only if no '{' pattern)
    if (core.endsWith('+') && !core.includes('{')) {
      const name = core.slice(1, -1); // skip ':' and '+'

      if (name === '') {
        return err({
          kind: 'route-parse',
          message: `Empty parameter name in path: ${path}`,
          path,
        });
      }

      if (this.activeParams.has(name)) {
        return err({
          kind: 'param-duplicate',
          message: `Duplicate parameter name ':${name}' in path: ${path}`,
          path,
          segment: name,
        });
      }

      this.activeParams.add(name);
      return { type: 'wildcard', name, origin: 'multi' };
    }

    if (core.endsWith('*') && !core.includes('{')) {
      const name = core.slice(1, -1); // skip ':' and '*'

      if (name === '') {
        return err({
          kind: 'route-parse',
          message: `Empty parameter name in path: ${path}`,
          path,
        });
      }

      if (this.activeParams.has(name)) {
        return err({
          kind: 'param-duplicate',
          message: `Duplicate parameter name ':${name}' in path: ${path}`,
          path,
          segment: name,
        });
      }

      this.activeParams.add(name);
      return { type: 'wildcard', name, origin: 'star' };
    }

    // Extract name and pattern
    let name: string;
    let pattern: string | null = null;
    const braceIdx = core.indexOf('{');

    if (braceIdx === -1) {
      name = core.slice(1); // skip ':'
    } else {
      name = core.slice(1, braceIdx);

      if (!core.endsWith('}')) {
        return err({
          kind: 'route-parse',
          message: `Unclosed regex pattern in parameter ':${name}': ${path}`,
          path,
        });
      }

      pattern = core.slice(braceIdx + 1, -1) || null;
    }

    if (name === '') {
      return err({
        kind: 'route-parse',
        message: `Empty parameter name in path: ${path}`,
        path,
      });
    }

    // Check duplicate param names
    if (this.activeParams.has(name)) {
      return err({
        kind: 'param-duplicate',
        message: `Duplicate parameter name ':${name}' in path: ${path}`,
        path,
        segment: name,
      });
    }

    this.activeParams.add(name);

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
  ): Result<PathPart, RouterErrData> {
    // Determine origin
    let core = seg.slice(1); // skip '*'
    let origin: 'star' | 'multi' = 'star';

    if (core.endsWith('+')) {
      origin = 'multi';
      core = core.slice(0, -1);
    }

    const name = core || '*';

    // Wildcard must be the last segment
    if (index !== totalSegments - 1) {
      return err({
        kind: 'route-parse',
        message: `Wildcard '*${name}' must be the last segment: ${path}`,
        path,
      });
    }

    // Check duplicate
    if (this.activeParams.has(name)) {
      return err({
        kind: 'param-duplicate',
        message: `Duplicate parameter name '*${name}' in path: ${path}`,
        path,
        segment: name,
      });
    }

    this.activeParams.add(name);

    return { type: 'wildcard', name, origin };
  }

  private validatePattern(pattern: string): Result<void, RouterErrData> {
    const safety = this.config.regexSafety;

    if (!safety) {
      return;
    }

    // Normalize pattern (strip anchors)
    const normResult = this.patternUtils.normalizeParamPatternSource(pattern);

    if (isErr(normResult)) {
      return normResult;
    }

    // Safety assessment
    const assessment = assessRegexSafety(normResult, {
      maxLength: safety.maxLength ?? 256,
      forbidBacktrackingTokens: safety.forbidBacktrackingTokens ?? true,
      forbidBackreferences: safety.forbidBackreferences ?? true,
    });

    if (!assessment.safe) {
      const mode = safety.mode ?? 'error';

      if (mode === 'error') {
        return err({
          kind: 'regex-unsafe',
          message: `Unsafe regex pattern: ${assessment.reason}`,
          segment: pattern,
        });
      }

      if (mode === 'warn' && this.config.onWarn) {
        this.config.onWarn({
          kind: 'regex-unsafe',
          message: `Unsafe regex pattern: ${assessment.reason}`,
          segment: pattern,
        });
      }
    }

    // Custom validator — exception propagates to caller
    if (safety.validator) {
      safety.validator(pattern);
    }
  }
}
