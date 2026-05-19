import type { Result } from '@zipbul/result';

import { err, isErr } from '@zipbul/result';

import type { PathPart } from '../tree';
import type { RouterErrorData } from '../types';

import { PathPartType, WildcardOrigin } from '../tree';
import { RouterErrorKind } from '../types';
import { CC_COLON, CC_PLUS, CC_STAR } from './constants';
import { validatePathChars } from './path-policy';
import { normalizeParamPatternSource } from './pattern-utils';

interface ParseResult {
  parts: PathPart[];
  normalized: string;
  isDynamic: boolean;
}

interface PathParserConfig {
  caseSensitive: boolean;
  ignoreTrailingSlash: boolean;
}

class PathParser {
  private readonly config: PathParserConfig;
  private readonly activeParams = new Set<string>();

  constructor(config: PathParserConfig) {
    this.config = config;
  }

  parse(path: string): Result<ParseResult, RouterErrorData> {
    const validation = this.validatePath(path);

    if (validation !== null) {
      return validation;
    }

    const tokenizeResult = this.tokenize(path);

    if (isErr(tokenizeResult)) {
      return tokenizeResult;
    }

    const { segments, normalized } = tokenizeResult;

    return this.parseTokens(segments, normalized, path);
  }

  private validatePath(path: string): Result<never, RouterErrorData> | null {
    const result = validatePathChars(path);
    if (isErr(result)) {
      return result;
    }
    return null;
  }

  private tokenize(path: string): Result<{ segments: string[]; normalized: string }, RouterErrorData> {
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

    let trimmedTrailingSlash = false;
    if (this.config.ignoreTrailingSlash) {
      if (segments.length > 0 && segments[segments.length - 1] === '') {
        segments.pop();
        trimmedTrailingSlash = true;
      }
    }

    const caseSensitive = this.config.caseSensitive;
    let caseChanged = false;
    let iriChanged = false;

    for (let i = 0; i < segments.length; i++) {
      let seg = segments[i]!;

      if (seg === '') {
        return err({
          kind: RouterErrorKind.PathEmptySegment,
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

      let hasNonAscii = false;
      for (let j = 0; j < seg.length; j++) {
        if (seg.charCodeAt(j) >= 0x80) {
          hasNonAscii = true;
          break;
        }
      }
      if (hasNonAscii) {
        seg = normalizeIriSegment(seg);
        segments[i] = seg;
        iriChanged = true;
      }

      if (!caseSensitive) {
        const lowered = seg.toLowerCase();
        if (lowered !== seg) {
          caseChanged = true;
        }
        segments[i] = lowered;
      }
    }

    let normalized: string;
    if (segments.length === 0) {
      normalized = '/';
    } else if (caseChanged || iriChanged) {
      normalized = '/' + segments.join('/');
    } else if (trimmedTrailingSlash) {
      normalized = path.substring(0, path.length - 1);
    } else {
      normalized = path;
    }

    return { segments, normalized };
  }

  private parseTokens(segments: string[], normalized: string, path: string): Result<ParseResult, RouterErrorData> {
    this.activeParams.clear();

    const parts: PathPart[] = [];
    const acc: StaticAccumulator = { buf: '/', segments: [] };
    let isDynamic = false;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      const firstChar = seg.charCodeAt(0);
      const isLast = i === segments.length - 1;

      if (firstChar === CC_COLON) {
        flushStaticBuffer(acc, parts);
        isDynamic = true;
        const paramResult = this.parseParam(seg, path);
        if (isErr(paramResult)) {
          return paramResult;
        }
        parts.push(paramResult);
        if (!isLast) {
          acc.buf = '/';
        }
      } else if (firstChar === CC_STAR) {
        flushStaticBuffer(acc, parts);
        isDynamic = true;
        const wcResult = this.parseWildcard(seg, i, segments.length, path);
        if (isErr(wcResult)) {
          return wcResult;
        }
        parts.push(wcResult);
      } else {
        appendStaticSegment(acc, seg, !isLast);
      }
    }

    flushStaticBuffer(acc, parts);
    if (parts.length === 0) {
      parts.push({ type: PathPartType.Static, value: '/', segments: [] });
    }
    return { parts, normalized, isDynamic };
  }

  private parseParam(seg: string, path: string): Result<PathPart, RouterErrorData> {
    let core = seg;
    let isOptional = false;

    const optionalResult = stripOptionalDecorator(core, seg, path);
    if ('kind' in optionalResult) {
      return err(optionalResult);
    }
    core = optionalResult.core;
    isOptional = optionalResult.isOptional;

    const sugarRejection = rejectColonWildcardSugar(core, seg, path);
    if (sugarRejection !== undefined) {
      return err(sugarRejection);
    }

    const nameAndPattern = extractNameAndPattern(core, path);
    if ('kind' in nameAndPattern) {
      return err(nameAndPattern);
    }
    const { name, pattern } = nameAndPattern;

    const nameValidation = validateParamName(name, ':', path);
    if (nameValidation !== null) {
      return nameValidation;
    }

    const dup = this.registerParam(name, ':', path);
    if (dup !== null) {
      return dup;
    }

    return { type: PathPartType.Param, name, pattern, optional: isOptional };
  }

  private parseWildcard(seg: string, index: number, totalSegments: number, path: string): Result<PathPart, RouterErrorData> {
    let core = seg.slice(1);
    let origin: WildcardOrigin = WildcardOrigin.Star;

    if (core.endsWith('+')) {
      origin = WildcardOrigin.Multi;
      core = core.slice(0, -1);
    }

    const name = core || '*';

    if (name !== '*') {
      const validation = validateParamName(name, '*', path);

      if (validation !== null) {
        return validation;
      }
    }

    if (index !== totalSegments - 1) {
      return err({
        kind: RouterErrorKind.RouteParse,
        message: `Wildcard '*${name}' must be the last segment: ${path}`,
        path,
        suggestion: 'Move the wildcard segment to the end of the path.',
      });
    }

    const dup = this.registerParam(name, '*', path);

    if (dup !== null) {
      return dup;
    }

    return { type: PathPartType.Wildcard, name, origin };
  }

  private registerParam(name: string, prefix: ':' | '*', path: string): Result<never, RouterErrorData> | null {
    if (this.activeParams.has(name)) {
      return err({
        kind: RouterErrorKind.ParamDuplicate,
        message: `Duplicate parameter name '${prefix}${name}' in path: ${path}`,
        path,
        segment: name,
        suggestion: `Rename one of the '${prefix}${name}' parameters so each name is unique within the path.`,
      });
    }

    this.activeParams.add(name);

    return null;
  }
}

function validateParamName(name: string, prefix: ':' | '*', path: string): Result<never, RouterErrorData> | null {
  if (name === '') {
    return err({
      kind: RouterErrorKind.RouteParse,
      message: `Empty parameter name in path: ${path}`,
      path,
      suggestion: 'Provide a name after the : or * decorator (e.g. :id, *path).',
    });
  }

  const firstCode = name.charCodeAt(0);
  const isFirstLetter = (firstCode >= 65 && firstCode <= 90) || (firstCode >= 97 && firstCode <= 122);

  if (!isFirstLetter) {
    return err({
      kind: RouterErrorKind.RouteParse,
      message: `Invalid parameter name '${prefix}${name}' in path: ${path}. Parameter names must start with a letter.`,
      path,
      segment: name,
      suggestion: 'Start the parameter name with an ASCII letter (a-z or A-Z).',
    });
  }

  for (let i = 1; i < name.length; i++) {
    const ch = name.charCodeAt(i);
    const isLetter = (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122);
    const isDigit = ch >= 48 && ch <= 57;
    const isUnderscore = ch === 95;

    if (!isLetter && !isDigit && !isUnderscore) {
      return err({
        kind: RouterErrorKind.RouteParse,
        message: `Invalid character '${name.charAt(i)}' in parameter name '${prefix}${name}'. Only alphanumeric characters and underscores are allowed (snake_case or camelCase).`,
        path,
        segment: name,
        suggestion: 'Restrict parameter names to ASCII letters, digits, and underscores.',
      });
    }
  }

  return null;
}

function rejectColonWildcardSugar(core: string, seg: string, path: string): RouterErrorData | undefined {
  const tail = core.charAt(core.length - 1);
  if (tail !== '+' && tail !== '*') {
    return undefined;
  }
  if (core.includes('(')) {
    return undefined;
  }
  const canonical = tail === '+' ? `*${core.slice(1, -1)}+` : `*${core.slice(1, -1)}`;
  return {
    kind: RouterErrorKind.RouteParse,
    message: `Colon-form wildcard '${seg}' is not supported. Use '${canonical}' instead.`,
    path,
    segment: seg,
    suggestion: `Wildcards must use the '*name' (zero-or-more) or '*name+' (one-or-more) syntax — not the ':name${tail}' colon form.`,
  };
}

function stripOptionalDecorator(
  core: string,
  seg: string,
  path: string,
): { core: string; isOptional: boolean } | RouterErrorData {
  if (!core.endsWith('?')) {
    return { core, isOptional: false };
  }
  const before = core.charCodeAt(core.length - 2);
  if (before === CC_PLUS || before === CC_STAR) {
    return {
      kind: RouterErrorKind.RouteParse,
      message: `Invalid decorator combination in parameter '${seg}': ${path}`,
      path,
      segment: seg,
      suggestion: 'Use either an optional param (:name?) or a wildcard segment (*name / *name+), not both.',
    };
  }
  return { core: core.slice(0, -1), isOptional: true };
}

function extractNameAndPattern(core: string, path: string): { name: string; pattern: string | null } | RouterErrorData {
  const parenIdx = core.indexOf('(');
  if (parenIdx === -1) {
    return { name: core.slice(1), pattern: null };
  }
  const name = core.slice(1, parenIdx);
  if (!core.endsWith(')')) {
    return {
      kind: RouterErrorKind.RouteParse,
      message: `Unclosed regex pattern in parameter ':${name}': ${path}`,
      path,
      suggestion: 'Close the regex group with a matching ).',
    };
  }
  const rawPattern = core.slice(parenIdx + 1, -1);
  if (rawPattern.trim() === '') {
    return {
      kind: RouterErrorKind.RouteParse,
      message: `Empty regex pattern in parameter ':${name}': ${path}`,
      path,
      segment: name,
      suggestion: `Either remove the parentheses entirely (':${name}') or provide a non-empty pattern.`,
    };
  }
  const normalizeResult = normalizeParamPatternSource(rawPattern);
  if (typeof normalizeResult !== 'string') {
    return {
      kind: RouterErrorKind.RouteParse,
      message: `Anchored regex pattern in parameter ':${name}': ${path}`,
      path,
      segment: name,
      suggestion: normalizeResult.suggestion,
    };
  }
  return { name, pattern: normalizeResult };
}

interface StaticAccumulator {
  buf: string;
  segments: string[];
}

function flushStaticBuffer(acc: StaticAccumulator, parts: PathPart[]): void {
  if (acc.buf.length === 0) {
    return;
  }
  parts.push({ type: PathPartType.Static, value: acc.buf, segments: acc.segments });
  acc.buf = '';
  acc.segments = [];
}

function appendStaticSegment(acc: StaticAccumulator, seg: string, hasNext: boolean): void {
  acc.buf += seg;
  acc.segments.push(seg);
  if (hasNext) {
    acc.buf += '/';
  }
}

function normalizeIriSegment(seg: string): string {
  const nfc = seg.normalize('NFC');
  let out = '';
  const encoder = NFC_ENCODER;
  for (const ch of nfc) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) {
      out += ch;
      continue;
    }
    const bytes = encoder.encode(ch);
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i]!;
      out += '%';
      out += HEX_UPPER[b >>> 4];
      out += HEX_UPPER[b & 0x0f];
    }
  }
  return out;
}

const NFC_ENCODER = new TextEncoder();
const HEX_UPPER = '0123456789ABCDEF';

export { extractNameAndPattern, PathParser, rejectColonWildcardSugar, stripOptionalDecorator };
export type { PathParserConfig };
