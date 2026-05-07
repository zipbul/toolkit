import type { Result } from '@zipbul/result';
import type { RouterErrorData, RouterProfile } from '../types';

import { err } from '@zipbul/result';

const MAX_METHOD_LENGTH = 64;

// HTTP method token grammar: 1*tchar where tchar = ALPHA / DIGIT /
// "!" / "#" / "$" / "%" / "&" / "'" / "*" / "+" / "-" / "." /
// "^" / "_" / "`" / "|" / "~". Char-code switch instead of regex to keep
// the per-add gate allocation-free.
function isValidMethodToken(method: string): boolean {
  const len = method.length;
  if (len === 0 || len > MAX_METHOD_LENGTH) return false;
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
 * Validate an HTTP method token under the given profile. `secure` and
 * `compat` both apply the HTTP token grammar — token validation is not
 * relaxed in `compat` (method validation and the 32-method limit still
 * apply). `unsafe` profile keeps the same gate; only numeric limits relax.
 */
export function validateMethodToken(
  method: string,
  _profile: RouterProfile,
): Result<void, RouterErrorData> {
  if (method.length === 0) {
    return err({
      kind: 'method-empty',
      message: 'HTTP method must not be empty.',
      suggestion: 'Provide a non-empty method token (e.g., GET, POST, custom token).',
    });
  }
  if (method.length > MAX_METHOD_LENGTH) {
    return err({
      kind: 'method-too-long',
      message: `HTTP method exceeds ${MAX_METHOD_LENGTH} ASCII bytes: '${method.slice(0, 16)}...'`,
      method,
      suggestion: `Method tokens must be 1-${MAX_METHOD_LENGTH} ASCII bytes.`,
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
