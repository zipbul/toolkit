import type { Result } from '@zipbul/result';
import type { RouterErrorData } from '../types';

import { err } from '@zipbul/result';
import { CC_SLASH } from './constants';

/**
 * Single-pass scan over a registered path. Rejects bytes the path
 * grammar forbids at registration time: raw `?`/`#` (except the
 * `:name?` decorator), C0/DEL controls, raw non-ASCII, malformed
 * percent escapes, dot segments (literal and percent-encoded), and
 * ASCII chars outside `unreserved / pct-encoded / sub-delims / ":" / "@"`.
 *
 * Inside a regex group `(...)` only the first three rules apply —
 * body chars pass through to the regex-safety pass.
 *
 * This runs once per `add()` call. There is no "compat" relaxation —
 * registered paths are code, not user input, and code that violates
 * the grammar is a developer bug.
 */
export function validatePathChars(
  path: string,
): Result<void, RouterErrorData> {
  if (path.length === 0 || path.charCodeAt(0) !== CC_SLASH) {
    return err({
      kind: 'path-missing-leading-slash',
      message: `Path must start with '/': ${path}`,
      path,
    });
  }

  let segStart = 1;
  let parenDepth = 0;
  const len = path.length;
  for (let i = 0; i < len; i++) {
    const c = path.charCodeAt(i);

    if (c === 0x28) parenDepth++;
    else if (c === 0x29 && parenDepth > 0) parenDepth--;

    // Universal byte rules — apply both inside and outside regex groups.
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

    if (c === 0x25) {
      if (i + 2 >= len || !isHex(path.charCodeAt(i + 1)) || !isHex(path.charCodeAt(i + 2))) {
        return err({
          kind: 'path-malformed-percent',
          message: `Path contains malformed percent-escape: ${path}`,
          path,
          suggestion: 'Every `%` must be followed by exactly two hex digits (0-9, A-F, a-f).',
        });
      }
    }

    // Inside a regex group `(...)` the router-grammar tokens `?` `#` and
    // the pchar-restriction are skipped — those bytes are part of the
    // user's regex AST, which is validated separately by regex-safety.
    if (parenDepth > 0) {
      if (c === CC_SLASH || i === len - 1) {
        // Dot-segment / segStart bookkeeping still runs so a regex group
        // crossing a `/` is still classified correctly afterwards.
        const segEnd = c === CC_SLASH ? i : i + 1;
        if (segEnd > segStart && isDotSegment(path, segStart, segEnd)) {
          return err({
            kind: 'path-dot-segment',
            message: `Path must not contain dot segments '.' or '..' (literal or percent-encoded): ${path}`,
            path,
            suggestion: 'Remove dot segments. Encoded forms `%2e`, `%2E`, `%2e%2e` are also rejected.',
          });
        }
        segStart = i + 1;
      }
      continue;
    }

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

    if (!isAcceptablePathChar(c)) {
      return err({
        kind: 'path-invalid-pchar',
        message: `Path contains invalid character '${path[i]}' (charCode 0x${c.toString(16)}): ${path}`,
        path,
        suggestion: 'Use the percent-encoded form for characters outside the path-segment grammar.',
      });
    }
  }

  // Single-pass percent-decode validation: classify each decoded byte
  // and verify the resulting byte stream as well-formed UTF-8.
  return validateDecodedBytes(path);
}

function isHex(c: number): boolean {
  return (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
}

type DecodeFailKind = 'path-encoded-control' | 'path-encoded-slash' | 'path-invalid-utf8';

function failDecode(
  kind: DecodeFailKind,
  msg: string,
  suggestion: string,
  path: string,
): Result<never, RouterErrorData> {
  return err({ kind, message: `${msg}: ${path}`, path, suggestion });
}

function hexValue(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;
  return c - 0x61 + 10;
}

/**
 * Single-pass percent-decode of a registered path. Walks each `%xx`
 * exactly once (no recursion / re-decoding of decoded bytes), classifies
 * every produced byte, and validates the resulting raw byte stream as
 * well-formed UTF-8.
 *
 * Rejects:
 *   - `%00`-`%1F`, `%7F`        → `path-encoded-control`
 *   - `%2F` (encoded `/`)        → `path-encoded-slash`
 *   - overlong / surrogate /
 *     truncated UTF-8 sequences  → `path-invalid-utf8`
 *
 * Dot-segment detection (`.`, `..`, `%2e`, etc.) already happens in the
 * earlier pass via `isDotSegment`, so it is intentionally not duplicated
 * here; double-encoded forms like `%252F` decode once to `%2F` and
 * remain a literal three-char sequence — they are *not* re-decoded into
 * a slash, which is the entire point of single-pass.
 *
 * Bytes inside a regex group `(...)` are skipped: their contents are
 * the user's regex AST and are validated by `assessRegexSafety`.
 */
function validateDecodedBytes(path: string): Result<void, RouterErrorData> {
  const len = path.length;
  let parenDepth = 0;
  let i = 0;
  // UTF-8 continuation tracking. When `expect > 0` we are mid-sequence
  // and the next decoded byte must be `0b10xxxxxx`. `seqVal` accumulates
  // the codepoint to detect overlongs and surrogates on completion.
  let expect = 0;
  let seqVal = 0;
  let seqMin = 0;

  while (i < len) {
    const ch = path.charCodeAt(i);
    if (ch === 0x28) { parenDepth++; i++; continue; }
    if (ch === 0x29 && parenDepth > 0) { parenDepth--; i++; continue; }
    if (parenDepth > 0) { i++; continue; }

    if (ch !== 0x25) {
      // Literal ASCII byte. If we were inside a UTF-8 sequence, the
      // sequence is incomplete (a non-continuation byte appeared).
      if (expect !== 0) {
        return failDecode('path-invalid-utf8',
          'Path percent-encoding decodes to a truncated UTF-8 sequence',
          'Each `%xx` continuation byte must complete the surrounding UTF-8 codepoint.', path);
      }
      i++;
      continue;
    }

    // `%xx` — well-formed-percent already enforced by validatePathChars.
    const b = (hexValue(path.charCodeAt(i + 1)) << 4) | hexValue(path.charCodeAt(i + 2));
    i += 3;

    if (expect === 0) {
      // Starting a new byte. Classify ASCII first.
      if ((b >= 0x00 && b <= 0x1f) || b === 0x7f) {
        return failDecode('path-encoded-control',
          `Path contains percent-encoded control byte %${b.toString(16).padStart(2, '0').toUpperCase()}`,
          'Control bytes (0x00-0x1F, 0x7F) are not permitted in registered paths.', path);
      }
      if (b === 0x2f) {
        return failDecode('path-encoded-slash',
          'Path contains percent-encoded `/` (%2F)',
          'Encoded slashes are not allowed; the path grammar reserves `/` as the segment separator.', path);
      }
      if (b < 0x80) { continue; }

      // Multi-byte UTF-8 lead byte.
      if (b < 0xc2) {
        // 0x80-0xbf: stray continuation. 0xc0-0xc1: overlong 2-byte.
        return failDecode('path-invalid-utf8',
          `Path percent-encoding produced invalid UTF-8 lead byte %${b.toString(16).toUpperCase()}`,
          'Lead bytes 0x80-0xbf and 0xc0-0xc1 are not valid in well-formed UTF-8.', path);
      }
      if (b < 0xe0) { expect = 1; seqVal = b & 0x1f; seqMin = 0x80; }
      else if (b < 0xf0) { expect = 2; seqVal = b & 0x0f; seqMin = 0x800; }
      else if (b < 0xf5) { expect = 3; seqVal = b & 0x07; seqMin = 0x10000; }
      else {
        return failDecode('path-invalid-utf8',
          `Path percent-encoding produced invalid UTF-8 lead byte %${b.toString(16).toUpperCase()}`,
          'Lead bytes 0xf5-0xff are outside the Unicode range.', path);
      }
      continue;
    }

    // Continuation byte expected.
    if ((b & 0xc0) !== 0x80) {
      return failDecode('path-invalid-utf8',
        `Path percent-encoding produced invalid UTF-8 continuation byte %${b.toString(16).toUpperCase()}`,
        'Continuation bytes must match `0b10xxxxxx`.', path);
    }
    seqVal = (seqVal << 6) | (b & 0x3f);
    expect--;
    if (expect === 0) {
      if (seqVal < seqMin) {
        return failDecode('path-invalid-utf8',
          `Path percent-encoding produced an overlong UTF-8 sequence (codepoint U+${seqVal.toString(16).toUpperCase()})`,
          'Overlong encodings are forbidden by RFC 3629 §3.', path);
      }
      if (seqVal >= 0xd800 && seqVal <= 0xdfff) {
        return failDecode('path-invalid-utf8',
          `Path percent-encoding produced a surrogate codepoint U+${seqVal.toString(16).toUpperCase()}`,
          'UTF-16 surrogate halves are not valid Unicode scalars.', path);
      }
      if (seqVal > 0x10ffff) {
        return failDecode('path-invalid-utf8',
          `Path percent-encoding produced a codepoint above U+10FFFF`,
          'The Unicode range tops out at U+10FFFF.', path);
      }
    }
  }

  if (expect !== 0) {
    return failDecode('path-invalid-utf8',
      'Path ends with an incomplete UTF-8 sequence',
      'Provide all continuation bytes for the trailing UTF-8 codepoint.', path);
  }
  return undefined;
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

// 128-entry lookup table — one Uint8Array load + comparison vs the
// 8-branch hand-written `isAcceptablePathChar` mirrors method-policy's
// TCHAR_TABLE pattern. Covers ALPHA / DIGIT / unreserved / sub-delims /
// `:` / `@` / `/` / `?` / `%` per RFC 3986 path-char grammar.
const ACCEPTABLE_PCHAR_TABLE = (() => {
  const t = new Uint8Array(128);
  for (let c = 0x41; c <= 0x5a; c++) t[c] = 1;     // A-Z
  for (let c = 0x61; c <= 0x7a; c++) t[c] = 1;     // a-z
  for (let c = 0x30; c <= 0x39; c++) t[c] = 1;     // 0-9
  for (const c of [
    0x2d, 0x2e, 0x5f, 0x7e,                        // unreserved: - . _ ~
    0x21, 0x24, 0x26, 0x27, 0x28, 0x29,            // sub-delims: ! $ & ' ( )
    0x2a, 0x2b, 0x2c, 0x3b, 0x3d,                  // sub-delims: * + , ; =
    0x3a, 0x40, 0x2f, 0x3f, 0x25,                  // : @ / ? %
  ]) t[c] = 1;
  return t;
})();

function isAcceptablePathChar(c: number): boolean {
  return c < 128 && ACCEPTABLE_PCHAR_TABLE[c] === 1;
}
