import type { CookieErrorReason } from './enums';

/** @internal */
export interface CookieErrorData {
  reason: CookieErrorReason;
  message: string;
}

export class CookieError extends Error {
  public readonly reason: CookieErrorReason;

  constructor(data: CookieErrorData) {
    super(data.message);
    this.name = 'CookieError';
    this.reason = data.reason;
  }
}

export type CookiePriority = 'low' | 'medium' | 'high';

export interface CookieParserOptions {
  secrets?: string[];
  algorithm?: 'sha256' | 'sha384' | 'sha512';
  encryptionSecret?: string | string[];
  prefixValidation?: boolean;
  publicSuffixCheck?: (domain: string) => boolean;
  onEncrypt?: (info: { keyIndex: number; counter: number }) => void;
  httpOnly?: boolean;
  secure?: boolean | 'auto';
  sameSite?: 'strict' | 'lax' | 'none';
  path?: string;
  domain?: string;
  maxAge?: number;
  expires?: number | Date | string;
  partitioned?: boolean;
  priority?: CookiePriority;
}

export interface CookieAttributes {
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: 'strict' | 'lax' | 'none';
  maxAge?: number;
  expires?: number | Date | string;
  partitioned?: boolean;
  priority?: CookiePriority;
}

export interface SerializeContext {
  isSecure?: boolean;
}
