import type { Result } from '@zipbul/result';

import { err, isErr } from '@zipbul/result';

import type { PathPart } from '../tree';
import type { RouterErrorData } from '../types';

import { PathPartType, WildcardOrigin } from '../tree';
import { RouterErrorKind } from '../types';
import { CC_COLON, CC_PLUS, CC_STAR } from './constants';
import { validatePathChars } from './path-policy';
// ── Types ──
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

// ── PathParser ──

class PathParser {
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

  // Single-pass char-code scan covering the structural-sanity check (leading
  private validatePath(path: string): Result<never, RouterErrorData> | null {
    const result = validatePathChars(path);
    if (isErr(result)) {
      return result;
    }
    return null;
  }

  /**
   * Stage 2 — split + normalize. Returns the segment array consumed by
   * stage 3 alongside the canonical normalized path used by lookup.
   */
  private tokenize(path: string): Result<{ segments: string[]; normalized: string }, RouterErrorData> {
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
    let trimmedTrailingSlash = false;
    if (this.config.ignoreTrailingSlash) {
      if (segments.length > 0 && segments[segments.length - 1] === '') {
        segments.pop();
        trimmedTrailingSlash = true;
      }
    }

    // Single-pass walk:
    //   - empty-segment check
    //   - IRI → URI normalize for static segments (NFC + percent-encode
    //     non-ASCII UTF-8 per RFC 3986 §2.5)
    //   - case-fold for static segments (`pathCaseSensitive=false`)
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

      // IRI normalization (RFC 3987 → RFC 3986). Cheap ASCII-only fast path
      // first — short-circuit when every byte is < 0x80 so we don't enter
      // the NFC normalize / UTF-8 encode path on ordinary ASCII paths.
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

    // Skip the `segments.join('/')` rebuild whenever the path is already
    // canonical (no case fold applied, no trailing slash trimmed, no IRI
    // segment normalized) — the hot bench measured the rebuild at
    // ~96 ns/route, with `caseSensitive=true` (the default) and canonical
    // paths it is pure work that produces the same string we already have.
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

  /**
   * Stage 3 — walk the tokenized segments and emit `PathPart[]`. Static
   * segments are accumulated into a buffer and flushed when a dynamic one
   * appears; consecutive statics share a single PathPart so the matcher can
   * compare prefixes in one go.
   */
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
        // parseParam never returns a wildcard now that the colon-form
        // sugar (`:name+` / `:name*`) is rejected upstream — the
        // discriminant is always 'param' here.
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
    // Root path `/` with no segments produces an empty parts list — emit
    // an explicit static `/` so insertIntoSegmentTree sees a real terminal.
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

    // `:name+` / `:name*` is not a supported colon-form wildcard — wildcards
    // must use the `*name` / `*name+` syntax exclusively. Reject the sugar at
    // parse time so two surface forms can't represent the same PathPart.
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

    // Regex pattern safety is the framework / user's responsibility — the
    // router does not gate against ReDoS-vulnerable shapes. Per policy
    // ("URL safety = framework responsibility"), security validation
    // belongs in a normalizer plug-in (e.g. `re2` / `recheck`) layered
    // ahead of the router. Build-time `new RegExp(...)` compile failure
    // is still surfaced as `route-parse` by segment-tree.ts.
    return { type: PathPartType.Param, name, pattern, optional: isOptional };
  }

  private parseWildcard(seg: string, index: number, totalSegments: number, path: string): Result<PathPart, RouterErrorData> {
    // Determine origin
    let core = seg.slice(1); // skip '*'
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

    // Wildcard must be the last segment
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

  /**
   * Reject duplicate `:name` / `*name` within the same path. Returns null on
   * success (and registers the name), or an `Err` carrying the duplicate
   * diagnostic. Caller must run `validateParamName` first — this helper
   * trusts the name shape and only enforces uniqueness.
   */
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
function validateParamName(name: string, prefix: ':' | '*', path: string): Result<never, RouterErrorData> | null {
  if (name === '') {
    return err({
      kind: RouterErrorKind.RouteParse,
      message: `Empty parameter name in path: ${path}`,
      path,
      suggestion: 'Provide a name after the : or * decorator (e.g. :id, *path).',
    });
  }

  // Strict check: Only snake_case and camelCase allowed.
  // Pattern: ^[a-zA-Z][a-zA-Z0-9_]*$
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

/**
 * Reject `:name+` / `:name*` (without a regex group). These are surface
 * sugar for the canonical `*name+` / `*name` wildcard syntax — accepting
 * both forms means two distinct strings can register the same logical
 * route, so we cut the sugar at parse time and force the canonical form.
 * Returns `undefined` when the segment is not this shape.
 */
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

/**
 * Peel the trailing `?` optional decorator.
 *
 * Defensive against `:name+?` / `:name*?` combinations: the production
 * path-policy.ts grammar already rejects raw `?` after non-identifier
 * characters as `path-query`, so these forms never reach this helper
 * during a normal `add()` flow. The check stays as a contract guard
 * for direct internal callers (unit tests against parseParam).
 *
 * Returns `{ core, isOptional }` on success, a `RouterErrorData` carrier
 * on failure (no Result wrapper — caller already wraps in `err()`).
 */
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

/**
 * Split `:name(pattern)` into its name and (possibly null) pattern.
 * Returns the parsed pair on success, a `RouterErrorData` carrier for
 * unclosed groups or empty/whitespace-only patterns.
 */
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

/** Mutable accumulator that gathers consecutive static segments before
 *  any dynamic part flushes them as one literal `PathPart`. */
interface StaticAccumulator {
  buf: string;
  segments: string[];
}

/** Flush whatever the accumulator holds into `parts` and reset it.
 *  No-op when the accumulator is empty. */
function flushStaticBuffer(acc: StaticAccumulator, parts: PathPart[]): void {
  if (acc.buf.length === 0) {
    return;
  }
  parts.push({ type: PathPartType.Static, value: acc.buf, segments: acc.segments });
  acc.buf = '';
  acc.segments = [];
}

/** Append one literal segment to the accumulator. `hasNext` controls
 *  whether a trailing slash is appended for the next segment join. */
function appendStaticSegment(acc: StaticAccumulator, seg: string, hasNext: boolean): void {
  acc.buf += seg;
  acc.segments.push(seg);
  if (hasNext) {
    acc.buf += '/';
  }
}

/**
 * IRI → URI segment normalization (RFC 3987 §3.1).
 *   1. NFC normalize (RFC 3987 §5.3.2.2).
 *   2. Percent-encode every non-ASCII byte of the UTF-8 encoding
 *      (RFC 3986 §2.5).
 *
 * Caller has already verified `seg` contains at least one non-ASCII
 * code point, so the cheap ASCII fast path lives in the caller — this
 * helper always runs both steps.
 *
 * Output is RFC 3986 conformant: every code point ≥ 0x80 becomes
 * `%XX` (uppercase hex) per RFC 3986 §2.1 recommendation.
 *
 * @internal exported for unit tests.
 */
function normalizeIriSegment(seg: string): string {
  const nfc = seg.normalize('NFC');
  let out = '';
  const encoder = NFC_ENCODER;
  // Iterate code points (not UTF-16 code units) so surrogate pairs
  // encode as a single 4-byte UTF-8 sequence.
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
