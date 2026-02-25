import type { Result } from '@zipbul/result';
import type { EncodedSlashBehavior, RouterErrData } from '../types';

import { err } from '@zipbul/result';

/** Function type returned by {@link buildDecoder}. Takes a raw segment and returns decoded or an error. */
export type DecoderFn = (raw: string) => Result<string, RouterErrData>;

/**
 * Builds a pre-specialised decoder closure for the given configuration.
 * Using a closure eliminates per-call branching on behavior/failFast in the hot path.
 */
export function buildDecoder(behavior: EncodedSlashBehavior | undefined, failFast: boolean): DecoderFn {
  if (behavior === 'preserve') {
    return (raw: string) => raw;
  }

  if (behavior === 'reject') {
    if (failFast) {
      return (raw: string): Result<string, RouterErrData> => {
        if (!raw.includes('%')) return raw;
        if (/%(2F|2f)/.test(raw)) {
          return err<RouterErrData>({ kind: 'encoded-slash', message: 'Encoded slashes are forbidden', segment: raw });
        }
        try {
          return decodeURIComponent(raw);
        } catch {
          return err<RouterErrData>({ kind: 'encoding', message: `Failed to decode URI component: ${raw}`, segment: raw });
        }
      };
    }

    return (raw: string): Result<string, RouterErrData> => {
      if (!raw.includes('%')) return raw;
      if (/%(2F|2f)/.test(raw)) {
        return err<RouterErrData>({ kind: 'encoded-slash', message: 'Encoded slashes are forbidden', segment: raw });
      }
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    };
  }

  // 'decode' (default)
  if (failFast) {
    return (raw: string): Result<string, RouterErrData> => {
      if (!raw.includes('%')) return raw;
      try {
        return decodeURIComponent(raw);
      } catch {
        return err<RouterErrData>({ kind: 'encoding', message: `Failed to decode URI component: ${raw}`, segment: raw });
      }
    };
  }

  return (raw: string): Result<string, RouterErrData> => {
    if (!raw.includes('%')) return raw;
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  };
}
