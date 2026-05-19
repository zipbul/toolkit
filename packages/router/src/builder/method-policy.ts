import type { Result } from '@zipbul/result';

import { err } from '@zipbul/result';

import type { RouterErrorData } from '../types';

import { RouterErrorKind } from '../types';

const TCHAR_TABLE = (() => {
  const t = new Uint8Array(256);
  for (let c = 0x41; c <= 0x5a; c++) {
    t[c] = 1;
  }
  for (let c = 0x61; c <= 0x7a; c++) {
    t[c] = 1;
  }
  for (let c = 0x30; c <= 0x39; c++) {
    t[c] = 1;
  }
  for (const c of [0x21, 0x23, 0x24, 0x25, 0x26, 0x27, 0x2a, 0x2b, 0x2d, 0x2e, 0x5e, 0x5f, 0x60, 0x7c, 0x7e]) {
    t[c] = 1;
  }
  return t;
})();

function isValidMethodToken(method: string): boolean {
  const len = method.length;
  for (let i = 0; i < len; i++) {
    if (TCHAR_TABLE[method.charCodeAt(i)] === 0) {
      return false;
    }
  }
  return true;
}

export function validateMethodToken(method: string): Result<void, RouterErrorData> {
  if (method.length === 0) {
    return err({
      kind: RouterErrorKind.MethodEmpty,
      message: 'HTTP method must not be empty.',
      suggestion: 'Provide a non-empty method token (e.g., GET, POST, custom token).',
    });
  }
  if (!isValidMethodToken(method)) {
    return err({
      kind: RouterErrorKind.MethodInvalidToken,
      message: `HTTP method contains a character outside the token grammar: '${method}'`,
      method,
      suggestion: "Use only HTTP token characters: alphanumerics + ! # $ % & ' * + - . ^ _ ` | ~.",
    });
  }
  return undefined;
}
