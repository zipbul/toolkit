import type { RouterProfile } from '../types';

export type RuntimePathScanReason =
  | 'path-fragment'
  | 'path-control-char'
  | 'path-non-ascii'
  | 'path-malformed-percent'
  | 'path-invalid-utf8'
  | 'path-encoded-slash'
  | 'path-encoded-control'
  | 'path-dot-segment';

export type RuntimePathScanResult =
  | { ok: true; key: string }
  | { ok: false; reason: RuntimePathScanReason };

export interface RuntimePathPolicyConfig {
  readonly profile: RouterProfile;
  readonly trimTrailingSlash: boolean;
  readonly toLowerCase: boolean;
  readonly maxPathLen: number;
  readonly maxSegLen: number;
  readonly checkPathLen: boolean;
  readonly checkSegLen: boolean;
}

/**
 * Single-pass scan over a runtime path. Order matches the public spec:
 * raw `#` reject → first `?` query strip → percent / UTF-8 / encoded-slash /
 * encoded-control / dot-segment validation → trailing slash policy →
 * compat-only case fold → lookup-key.
 *
 * Allocation budget on the valid ASCII fast path is one substring
 * (the length-trim slice). Failure paths return a reason so the caller
 * can skip cache writes.
 */
export function scanRuntimePath(
  path: string,
  cfg: RuntimePathPolicyConfig,
): RuntimePathScanResult {
  let end = path.length;

  // 1. Raw # → no-match (no cache).
  // 2. First raw ? → strip query.
  for (let i = 0; i < end; i++) {
    const c = path.charCodeAt(i);
    if (c === 0x23) return { ok: false, reason: 'path-fragment' };
    if (c === 0x3f) { end = i; break; }
  }

  if (cfg.checkPathLen && end > cfg.maxPathLen) {
    return { ok: false, reason: 'path-malformed-percent' };
  }

  const compat = cfg.profile === 'compat';

  // 3. Single-pass percent / UTF-8 / dot / encoded-slash / encoded-control validation.
  // Track segment boundaries for dot-segment detection over the decoded form.
  let segStart = 0;
  let segDecodedLen = 0;
  let segHasOnlyDots = true;
  let segDecodedDots = 0;
  let segLen = 0;

  for (let i = 0; i < end; ) {
    const c = path.charCodeAt(i);

    if ((c >= 0x00 && c <= 0x1f) || c === 0x7f) {
      return { ok: false, reason: 'path-control-char' };
    }
    if (c >= 0x80) {
      if (compat) {
        i++;
        segDecodedLen++;
        segLen++;
        segHasOnlyDots = false;
        continue;
      }
      return { ok: false, reason: 'path-non-ascii' };
    }

    if (c === 0x2f) {
      // segment boundary
      if (i > segStart && segHasOnlyDots && (segDecodedDots === 1 || segDecodedDots === 2) && segDecodedLen === segDecodedDots) {
        return { ok: false, reason: 'path-dot-segment' };
      }
      segStart = i + 1;
      segDecodedLen = 0;
      segHasOnlyDots = true;
      segDecodedDots = 0;
      segLen = 0;
      i++;
      continue;
    }

    if (c === 0x25) { // '%'
      if (i + 2 >= end) {
        if (compat) { i++; segDecodedLen++; segLen++; segHasOnlyDots = false; continue; }
        return { ok: false, reason: 'path-malformed-percent' };
      }
      const h1 = path.charCodeAt(i + 1);
      const h2 = path.charCodeAt(i + 2);
      const v1 = hexValue(h1);
      const v2 = hexValue(h2);
      if (v1 < 0 || v2 < 0) {
        if (compat) { i++; segDecodedLen++; segLen++; segHasOnlyDots = false; continue; }
        return { ok: false, reason: 'path-malformed-percent' };
      }
      const decoded = (v1 << 4) | v2;

      if (decoded === 0x2f) return { ok: false, reason: 'path-encoded-slash' };
      if ((decoded >= 0x00 && decoded <= 0x1f) || decoded === 0x7f) {
        return { ok: false, reason: 'path-encoded-control' };
      }

      // UTF-8 validation: first byte determines the sequence length, including
      // overlong rejection for 0xC0/0xC1 starters and out-of-range 0xF5+.
      if (decoded >= 0x80) {
        const seqLen = decoded < 0xc2 ? -1
          : decoded < 0xe0 ? 2
          : decoded < 0xf0 ? 3
          : decoded < 0xf5 ? 4
          : -1;
        if (seqLen < 0) {
          if (compat) { i += 3; segDecodedLen++; segLen += 3; segHasOnlyDots = false; continue; }
          return { ok: false, reason: 'path-invalid-utf8' };
        }
        const consumed = consumeUtf8Continuation(path, i, end, seqLen, decoded);
        if (consumed < 0) {
          if (compat) { i += 3; segDecodedLen++; segLen += 3; segHasOnlyDots = false; continue; }
          return { ok: false, reason: 'path-invalid-utf8' };
        }
        i += consumed;
        segDecodedLen++;
        segLen += consumed;
        segHasOnlyDots = false;
        continue;
      }

      if (decoded === 0x2e) {
        segDecodedDots++;
        segDecodedLen++;
        segLen += 3;
        i += 3;
        continue;
      }

      segHasOnlyDots = false;
      segDecodedLen++;
      segLen += 3;
      i += 3;
      continue;
    }

    if (c === 0x2e) { // '.'
      segDecodedDots++;
      segDecodedLen++;
      segLen++;
      i++;
      continue;
    }

    segHasOnlyDots = false;
    segDecodedLen++;
    segLen++;
    i++;
  }

  // Final segment dot-segment check (no trailing slash before the end).
  if (segLen > 0 && segHasOnlyDots && (segDecodedDots === 1 || segDecodedDots === 2) && segDecodedLen === segDecodedDots) {
    return { ok: false, reason: 'path-dot-segment' };
  }

  if (cfg.checkSegLen && segLen > cfg.maxSegLen) {
    return { ok: false, reason: 'path-malformed-percent' };
  }

  // 4 + 6: trailing slash policy + lookup-key construction.
  let key = end === path.length ? path : path.slice(0, end);
  if (cfg.trimTrailingSlash && key.length > 1 && key.charCodeAt(key.length - 1) === 0x2f) {
    key = key.slice(0, key.length - 1);
  }

  // 5: compat-only case fold (n/a in secure).
  if (cfg.toLowerCase) {
    const lowered = key.toLowerCase();
    if (lowered !== key) key = lowered;
  }

  return { ok: true, key };
}

function hexValue(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  if (c >= 0x41 && c <= 0x46) return c - 0x37;
  if (c >= 0x61 && c <= 0x66) return c - 0x57;
  return -1;
}

// Consume `seqLen` UTF-8 bytes starting at the `%XX` at position `i`. Returns
// the total number of source chars consumed (3 per byte) or -1 on invalid /
// overlong / surrogate / out-of-range.
function consumeUtf8Continuation(
  path: string,
  i: number,
  end: number,
  seqLen: number,
  firstByte: number,
): number {
  let codepoint = firstByte & (seqLen === 2 ? 0x1f : seqLen === 3 ? 0x0f : 0x07);
  let pos = i + 3;
  for (let n = 1; n < seqLen; n++) {
    if (pos + 2 >= end) return -1;
    if (path.charCodeAt(pos) !== 0x25) return -1;
    const v1 = hexValue(path.charCodeAt(pos + 1));
    const v2 = hexValue(path.charCodeAt(pos + 2));
    if (v1 < 0 || v2 < 0) return -1;
    const byte = (v1 << 4) | v2;
    if ((byte & 0xc0) !== 0x80) return -1;
    codepoint = (codepoint << 6) | (byte & 0x3f);
    pos += 3;
  }
  // Overlong / surrogate / range gates.
  if (seqLen === 2 && codepoint < 0x80) return -1;
  if (seqLen === 3 && codepoint < 0x800) return -1;
  if (seqLen === 3 && codepoint >= 0xd800 && codepoint <= 0xdfff) return -1;
  if (seqLen === 4 && (codepoint < 0x10000 || codepoint > 0x10ffff)) return -1;
  return seqLen * 3;
}
