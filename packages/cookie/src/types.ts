import type { CookiePriority } from './interfaces';

export type SigningAlgorithm = 'sha256' | 'sha384' | 'sha512';

export type ResolvedCookieParserOptions = {
  secrets: string[] | null;
  algorithm: SigningAlgorithm;
  encryptionSecrets: string[] | null;
  prefixValidation: boolean;
  publicSuffixCheck: (domain: string) => boolean;
  onEncrypt: ((info: { keyIndex: number; counter: number }) => void) | null;
  defaults: ResolvedCookieDefaults;
};

export type ResolvedCookieDefaults = {
  httpOnly: boolean | null;
  secure: boolean | 'auto' | null;
  sameSite: 'strict' | 'lax' | 'none' | null;
  path: string | null;
  domain: string | null;
  maxAge: number | null;
  expires: number | Date | string | null;
  partitioned: boolean | null;
  priority: CookiePriority | null;
};
