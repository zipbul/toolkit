import type { Result } from '@zipbul/result';
import type { RouterErrorData } from '../types';

import { err } from '@zipbul/result';

// HTTP method token grammar (RFC 9110 §5.6.2 + §9.1, RFC 9112 §3.1):
//   method = token = 1*tchar
//   tchar  = ALPHA / DIGIT / "!" / "#" / "$" / "%" / "&" / "'" / "*"
//          / "+" / "-" / "." / "^" / "_" / "`" / "|" / "~"
// RFC 9112 §3.1 explicitly: "The request method is case-sensitive." — we
// therefore do NOT canonicalize case; "GET" and "get" are distinct methods.
// RFC 9110 §2.3 explicitly states no predefined length limit, so we impose
// none beyond `1*tchar` (one or more) — `MethodRegistry`'s `MAX_METHODS`
// cap (32-bit bitmask ceiling) already prevents unbounded growth, and
// `add()` is developer-controlled code, not external input, so an
// adversarial-length method string is not a meaningful threat model.
//
// Implementation: a 256-byte lookup table indexed by `charCodeAt(i)`.
// Bench `bench/method-research/L-validate-alternatives.bench.ts` shows
// 1.4-1.74× faster than the prior char-code branch chain across short /
// long / invalid token mixes (and 2-4× faster than a regex).
const TCHAR_TABLE = (() => {
  const t = new Uint8Array(256);
  for (let c = 0x41; c <= 0x5a; c++) t[c] = 1;          // A-Z
  for (let c = 0x61; c <= 0x7a; c++) t[c] = 1;          // a-z
  for (let c = 0x30; c <= 0x39; c++) t[c] = 1;          // 0-9
  for (const c of [0x21,0x23,0x24,0x25,0x26,0x27,0x2a,0x2b,
                   0x2d,0x2e,0x5e,0x5f,0x60,0x7c,0x7e]) {
    t[c] = 1;
  }
  return t;
})();

function isValidMethodToken(method: string): boolean {
  const len = method.length;
  if (len === 0) return false;
  for (let i = 0; i < len; i++) {
    if (TCHAR_TABLE[method.charCodeAt(i)] === 0) return false;
  }
  return true;
}

/**
 * Validate an HTTP method token. Always strict — registration is a
 * compile-time concern and the token grammar is fixed by the HTTP spec.
 */
export function validateMethodToken(method: string): Result<void, RouterErrorData> {
  if (method.length === 0) {
    return err({
      kind: 'method-empty',
      message: 'HTTP method must not be empty.',
      suggestion: 'Provide a non-empty method token (e.g., GET, POST, custom token).',
    });
  }
  if (!isValidMethodToken(method)) {
    return err({
      kind: 'method-invalid-token',
      message: `HTTP method contains a character outside the token grammar: '${method}'`,
      method,
      suggestion: 'Use only HTTP token characters: alphanumerics + ! # $ % & \' * + - . ^ _ ` | ~.',
    });
  }
  return undefined;
}
