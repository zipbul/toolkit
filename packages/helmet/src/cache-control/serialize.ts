import { HttpHeader } from '@zipbul/shared';

import type { ResolvedCacheControlOptions } from '../types';

import type { HeaderEntry } from '../header-entry';

export function serializeCacheControl(opts: ResolvedCacheControlOptions): HeaderEntry[] {
  const out: HeaderEntry[] = [[HttpHeader.CacheControl, opts.value]];
  if (opts.pragma) out.push([HttpHeader.Pragma, 'no-cache']);
  if (opts.expires) out.push([HttpHeader.Expires, '0']);
  return out;
}

export function resolveCacheControl(
  input: boolean | { value?: string; pragma?: boolean; expires?: boolean } | undefined,
): ResolvedCacheControlOptions | undefined | false {
  if (input === undefined) return undefined;
  if (input === false) return false;
  if (input === true) {
    return Object.freeze({ value: 'no-store, max-age=0', pragma: false, expires: false });
  }
  return Object.freeze({
    value: input.value ?? 'no-store, max-age=0',
    pragma: input.pragma === true,
    expires: input.expires === true,
  });
}
