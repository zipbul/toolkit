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
// Char-code switch (instead of regex) keeps the per-add gate alloc-free.
function isValidMethodToken(method: string): boolean {
  const len = method.length;
  if (len === 0) return false;
  for (let i = 0; i < len; i++) {
    const c = method.charCodeAt(i);
    if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39)) continue;
    if (c === 0x21 || c === 0x23 || c === 0x24 || c === 0x25 || c === 0x26 ||
        c === 0x27 || c === 0x2a || c === 0x2b || c === 0x2d || c === 0x2e ||
        c === 0x5e || c === 0x5f || c === 0x60 || c === 0x7c || c === 0x7e) continue;
    return false;
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
