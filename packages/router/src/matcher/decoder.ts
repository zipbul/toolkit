import type { DecoderFn } from '../types';

/**
 * Module-singleton decoder for param values. Stateless — every router
 * shares the same function object so JSC can keep call-site ICs
 * monomorphic across instances. Decodes percent-encoded values; on
 * decode failure, returns the raw string unchanged.
 */
export const decoder: DecoderFn = (raw: string): string => {
  if (!raw.includes('%')) return raw;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};
