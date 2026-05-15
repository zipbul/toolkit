import type { DecoderFn } from '../types';

/**
 * Module-singleton decoder for param values. Stateless — every router
 * shares the same function object so JSC can keep call-site ICs
 * monomorphic across instances. Decodes percent-encoded values via
 * `decodeURIComponent`; malformed input throws (as `decodeURIComponent`
 * always has). The caller's HTTP-server boundary is responsible for
 * RFC-conformant pathnames, so wrapping the decode in a try/catch would
 * just hide upstream bugs at one wasted runtime branch per param.
 */
export const decoder: DecoderFn = (raw: string): string => {
  if (!raw.includes('%')) return raw;
  return decodeURIComponent(raw);
};
