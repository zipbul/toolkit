import type { Result } from '@zipbul/result';

import { err } from '@zipbul/result';

import type { RouterErrorData } from '../types';

import { RouterErrorKind } from '../types';
import { CC_SLASH } from './constants';

function validatePathChars(path: string): Result<void, RouterErrorData> {
  if (path.length === 0 || path.charCodeAt(0) !== CC_SLASH) {
    return err({
      kind: RouterErrorKind.PathMissingLeadingSlash,
      message: `Path must start with '/': ${path}`,
      path,
      suggestion: 'Prefix the route pattern with `/` (e.g. `users` → `/users`).',
    });
  }

  let segStart = 1;
  let parenDepth = 0;
  const len = path.length;
  for (let i = 0; i < len; i++) {
    const c = path.charCodeAt(i);

    if (c === 0x28) {
      parenDepth++;
    } else if (c === 0x29 && parenDepth > 0) {
      parenDepth--;
    }

    if ((c >= 0x00 && c <= 0x1f) || c === 0x7f) {
      return err({
        kind: RouterErrorKind.PathControlChar,
        message: `Path must not contain control characters (charCode 0x${c.toString(16).padStart(2, '0')}): ${path}`,
        path,
        suggestion: 'Remove control characters from the route pattern.',
      });
    }

    if (c >= 0x80) {
      continue;
    }

    if (c === 0x25) {
      if (i + 2 >= len || !isHex(path.charCodeAt(i + 1)) || !isHex(path.charCodeAt(i + 2))) {
        return err({
          kind: RouterErrorKind.PathMalformedPercent,
          message: `Path contains malformed percent-escape: ${path}`,
          path,
          suggestion: 'Every `%` must be followed by exactly two hex digits (0-9, A-F, a-f).',
        });
      }
    }

    if (parenDepth > 0) {
      if (c === CC_SLASH || i === len - 1) {
        const segEnd = c === CC_SLASH ? i : i + 1;
        if (segEnd > segStart && isDotSegment(path, segStart, segEnd)) {
          return err({
            kind: RouterErrorKind.PathDotSegment,
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
        kind: RouterErrorKind.PathFragment,
        message: `Path must not contain raw fragment '#': ${path}`,
        path,
        suggestion: 'Use percent-encoded form `%23` for literal `#`.',
      });
    }

    if (c === 0x3f) {
      const prev = i > 0 ? path.charCodeAt(i - 1) : 0;
      const isIdentChar =
        (prev >= 0x30 && prev <= 0x39) || (prev >= 0x41 && prev <= 0x5a) || (prev >= 0x61 && prev <= 0x7a) || prev === 0x5f;
      const next = i + 1 < len ? path.charCodeAt(i + 1) : 0;
      const isSegEnd = next === 0 || next === CC_SLASH;
      if (!isIdentChar || !isSegEnd) {
        return err({
          kind: RouterErrorKind.PathQuery,
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
            kind: RouterErrorKind.PathDotSegment,
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
        kind: RouterErrorKind.PathInvalidPchar,
        message: `Path contains invalid character '${path[i]}' (charCode 0x${c.toString(16)}): ${path}`,
        path,
        segment: path[i]!,
        suggestion: 'Use the percent-encoded form for characters outside the path-segment grammar (RFC 3986 §3.3 pchar).',
      });
    }
  }

  return validateDecodedBytes(path);
}

function isHex(c: number): boolean {
  return (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
}

type DecodeFailKind = RouterErrorKind.PathEncodedSlash | RouterErrorKind.PathInvalidUtf8;

function failDecode(kind: DecodeFailKind, msg: string, suggestion: string, path: string): Result<never, RouterErrorData> {
  return err({ kind, message: `${msg}: ${path}`, path, suggestion });
}

function hexValue(c: number): number {
  if (c >= 0x30 && c <= 0x39) {
    return c - 0x30;
  }
  if (c >= 0x41 && c <= 0x46) {
    return c - 0x41 + 10;
  }
  return c - 0x61 + 10;
}

function validateDecodedBytes(path: string): Result<void, RouterErrorData> {
  const len = path.length;
  let parenDepth = 0;
  let i = 0;
  let expect = 0;
  let seqVal = 0;
  let seqMin = 0;

  while (i < len) {
    const ch = path.charCodeAt(i);
    if (ch === 0x28) {
      parenDepth++;
      i++;
      continue;
    }
    if (ch === 0x29 && parenDepth > 0) {
      parenDepth--;
      i++;
      continue;
    }
    if (parenDepth > 0) {
      i++;
      continue;
    }

    if (ch !== 0x25) {
      if (expect !== 0) {
        return failDecode(
          RouterErrorKind.PathInvalidUtf8,
          'Path percent-encoding decodes to a truncated UTF-8 sequence',
          'Each `%xx` continuation byte must complete the surrounding UTF-8 codepoint.',
          path,
        );
      }
      i++;
      continue;
    }

    const b = (hexValue(path.charCodeAt(i + 1)) << 4) | hexValue(path.charCodeAt(i + 2));
    i += 3;

    if (expect === 0) {
      if (b === 0x2f) {
        return failDecode(
          RouterErrorKind.PathEncodedSlash,
          'Path contains percent-encoded `/` (%2F)',
          'Encoded slashes are not allowed; the path grammar reserves `/` as the segment separator.',
          path,
        );
      }
      if (b < 0x80) {
        continue;
      }

      if (b < 0xc2) {
        return failDecode(
          RouterErrorKind.PathInvalidUtf8,
          `Path percent-encoding produced invalid UTF-8 lead byte %${b.toString(16).toUpperCase()}`,
          'Lead bytes 0x80-0xbf and 0xc0-0xc1 are not valid in well-formed UTF-8.',
          path,
        );
      }
      if (b < 0xe0) {
        expect = 1;
        seqVal = b & 0x1f;
        seqMin = 0x80;
      } else if (b < 0xf0) {
        expect = 2;
        seqVal = b & 0x0f;
        seqMin = 0x800;
      } else if (b < 0xf5) {
        expect = 3;
        seqVal = b & 0x07;
        seqMin = 0x10000;
      } else {
        return failDecode(
          RouterErrorKind.PathInvalidUtf8,
          `Path percent-encoding produced invalid UTF-8 lead byte %${b.toString(16).toUpperCase()}`,
          'Lead bytes 0xf5-0xff are outside the Unicode range.',
          path,
        );
      }
      continue;
    }

    if ((b & 0xc0) !== 0x80) {
      return failDecode(
        RouterErrorKind.PathInvalidUtf8,
        `Path percent-encoding produced invalid UTF-8 continuation byte %${b.toString(16).toUpperCase()}`,
        'Continuation bytes must match `0b10xxxxxx`.',
        path,
      );
    }
    seqVal = (seqVal << 6) | (b & 0x3f);
    expect--;
    if (expect === 0) {
      if (seqVal < seqMin) {
        return failDecode(
          RouterErrorKind.PathInvalidUtf8,
          `Path percent-encoding produced an overlong UTF-8 sequence (codepoint U+${seqVal.toString(16).toUpperCase()})`,
          'Overlong encodings are forbidden by RFC 3629 §3.',
          path,
        );
      }
      if (seqVal >= 0xd800 && seqVal <= 0xdfff) {
        return failDecode(
          RouterErrorKind.PathInvalidUtf8,
          `Path percent-encoding produced a surrogate codepoint U+${seqVal.toString(16).toUpperCase()}`,
          'UTF-16 surrogate halves are not valid Unicode scalars.',
          path,
        );
      }
      if (seqVal > 0x10ffff) {
        return failDecode(
          RouterErrorKind.PathInvalidUtf8,
          `Path percent-encoding produced a codepoint above U+10FFFF`,
          'The Unicode range tops out at U+10FFFF.',
          path,
        );
      }
    }
  }

  if (expect !== 0) {
    return failDecode(
      RouterErrorKind.PathInvalidUtf8,
      'Path ends with an incomplete UTF-8 sequence',
      'Provide all continuation bytes for the trailing UTF-8 codepoint.',
      path,
    );
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
      if (h1 === 0x32 && (h2 === 0x65 || h2 === 0x45)) {
        dotCount++;
        i += 3;
        continue;
      }
    }
    nonDot = true;
    break;
  }
  if (nonDot) {
    return false;
  }
  return dotCount === 1 || dotCount === 2;
}

const ACCEPTABLE_PCHAR_TABLE = (() => {
  const t = new Uint8Array(128);
  for (let c = 0x41; c <= 0x5a; c++) {
    t[c] = 1;
  }
  for (let c = 0x61; c <= 0x7a; c++) {
    t[c] = 1;
  }
  for (let c = 0x30; c <= 0x39; c++) {
    t[c] = 1;
  }
  for (const c of [
    0x2d, 0x2e, 0x5f, 0x7e, 0x21, 0x24, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x2b, 0x2c, 0x3b, 0x3d, 0x3a, 0x40, 0x2f, 0x3f, 0x25,
  ]) {
    t[c] = 1;
  }
  return t;
})();

function isAcceptablePathChar(c: number): boolean {
  return c < 128 && ACCEPTABLE_PCHAR_TABLE[c] === 1;
}

export { validatePathChars };
