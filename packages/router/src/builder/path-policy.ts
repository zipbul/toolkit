import type { Result } from '@zipbul/result';
import type { RouterErrorData, RouterProfile } from '../types';

import { err } from '@zipbul/result';

const CC_SLASH = 0x2f;

/**
 * Single-pass scan over a registered path. Rejects bytes the secure profile
 * forbids: raw `?`/`#` (except the `:name?` decorator), C0/DEL controls,
 * raw non-ASCII, malformed percent escapes, dot segments (literal and
 * percent-encoded), and ASCII chars outside RFC 3986 pchar. Inside a regex
 * group `(...)` only the first three rules apply — body chars are passed
 * through to the regex-safety pass.
 *
 * Compat profile relaxes the malformed-percent gate (raw pass-through); the
 * raw-fragment, raw-query, and control-char rejects are kept because they
 * are router-grammar level rather than secure-only.
 */
export function validatePathChars(
  path: string,
  profile: RouterProfile,
  maxPathLength: number,
): Result<void, RouterErrorData> {
  if (path.length === 0 || path.charCodeAt(0) !== CC_SLASH) {
    return err({
      kind: 'path-missing-leading-slash',
      message: `Path must start with '/': ${path}`,
      path,
    });
  }

  if (Number.isFinite(maxPathLength) && path.length > maxPathLength) {
    return err({
      kind: 'path-too-long',
      message: `Path length ${path.length} exceeds maxPathLength ${maxPathLength}.`,
      path,
      suggestion: `Shorten the path or raise maxPathLength.`,
    });
  }

  const compatRelaxed = profile === 'compat';

  let segStart = 1;
  let parenDepth = 0;
  const len = path.length;
  for (let i = 0; i < len; i++) {
    const c = path.charCodeAt(i);

    if (c === 0x28) parenDepth++;
    else if (c === 0x29 && parenDepth > 0) parenDepth--;

    if (c === 0x23) {
      return err({
        kind: 'path-fragment',
        message: `Path must not contain raw fragment '#': ${path}`,
        path,
        suggestion: 'Use percent-encoded form `%23` for literal `#`.',
      });
    }

    if (c === 0x3f) {
      const prev = i > 0 ? path.charCodeAt(i - 1) : 0;
      const isIdentChar = (prev >= 0x30 && prev <= 0x39) || (prev >= 0x41 && prev <= 0x5a) ||
                          (prev >= 0x61 && prev <= 0x7a) || prev === 0x5f;
      const next = i + 1 < len ? path.charCodeAt(i + 1) : 0;
      const isSegEnd = next === 0 || next === CC_SLASH;
      if (!isIdentChar || !isSegEnd) {
        return err({
          kind: 'path-query',
          message: `Path must not contain raw query '?' (use \`:name?\` decorator only): ${path}`,
          path,
          suggestion: 'Optional param decorator `?` must follow a param name and end the segment.',
        });
      }
    }

    if ((c >= 0x00 && c <= 0x1f) || c === 0x7f) {
      return err({
        kind: 'path-control-char',
        message: `Path must not contain control characters (charCode 0x${c.toString(16).padStart(2, '0')}): ${path}`,
        path,
        suggestion: 'Remove control characters from the route pattern.',
      });
    }

    if (c >= 0x80) {
      return err({
        kind: 'path-non-ascii',
        message: `Path must not contain raw non-ASCII bytes (charCode 0x${c.toString(16)}): ${path}`,
        path,
        suggestion: 'Represent non-ASCII characters as percent-encoded UTF-8.',
      });
    }

    if (c === 0x25 && !compatRelaxed) {
      if (i + 2 >= len || !isHex(path.charCodeAt(i + 1)) || !isHex(path.charCodeAt(i + 2))) {
        return err({
          kind: 'path-malformed-percent',
          message: `Path contains malformed percent-escape: ${path}`,
          path,
          suggestion: 'Every `%` must be followed by exactly two hex digits (0-9, A-F, a-f).',
        });
      }
    }

    if (c === CC_SLASH || i === len - 1) {
      const segEnd = c === CC_SLASH ? i : i + 1;
      if (segEnd > segStart) {
        if (isDotSegment(path, segStart, segEnd)) {
          return err({
            kind: 'path-dot-segment',
            message: `Path must not contain dot segments '.' or '..' (literal or percent-encoded): ${path}`,
            path,
            suggestion: 'Remove dot segments. Encoded forms `%2e`, `%2E`, `%2e%2e` are also rejected.',
          });
        }
      }
      segStart = i + 1;
    }

    if (parenDepth > 0) continue;
    if (!isAcceptablePathChar(c)) {
      return err({
        kind: 'path-invalid-pchar',
        message: `Path contains invalid character '${path[i]}' (charCode 0x${c.toString(16)}): ${path}`,
        path,
        suggestion: 'Use percent-encoded form for characters outside RFC 3986 pchar.',
      });
    }
  }

  return undefined;
}

function isHex(c: number): boolean {
  return (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
}

function isDotSegment(path: string, segStart: number, segEnd: number): boolean {
  let dotCount = 0;
  let nonDot = false;
  let i = segStart;
  while (i < segEnd) {
    const c = path.charCodeAt(i);
    if (c === 0x2e) {
      dotCount++;
      i++;
      continue;
    }
    if (c === 0x25 && i + 2 < segEnd) {
      const h1 = path.charCodeAt(i + 1);
      const h2 = path.charCodeAt(i + 2);
      if ((h1 === 0x32) && (h2 === 0x65 || h2 === 0x45)) {
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

function isAcceptablePathChar(c: number): boolean {
  if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39)) return true;
  if (c === 0x2d || c === 0x2e || c === 0x5f || c === 0x7e) return true;
  if (c === 0x21 || c === 0x24 || c === 0x26 || c === 0x27 || c === 0x28 ||
      c === 0x29 || c === 0x2a || c === 0x2b || c === 0x2c || c === 0x3b || c === 0x3d) return true;
  if (c === 0x3a || c === 0x40 || c === 0x2f || c === 0x3f) return true;
  if (c === 0x25) return true;
  return false;
}
