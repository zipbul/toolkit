import type { Result } from '@zipbul/result';
import type { EncodedSlashBehavior, RouterErrData } from '../types';

import { err } from '@zipbul/result';

export function decodeURIComponentSafe(value: string, behavior: EncodedSlashBehavior | undefined, failFast: boolean): Result<string, RouterErrData> {
  if (!value.includes('%')) {
    return value;
  }

  const target = value;

  if (behavior === 'reject') {
    if (/%(2F|2f)/.test(value)) {
      return err<RouterErrData>({
        kind: 'encoded-slash',
        message: 'Encoded slashes are forbidden',
        segment: value,
      });
    }
  } else if (behavior === 'preserve') {
    return value;
  }

  try {
    return decodeURIComponent(target);
  } catch (_e) {
    if (failFast) {
      return err<RouterErrData>({
        kind: 'encoding',
        message: `Failed to decode URI component: ${value}`,
        segment: value,
      });
    }

    return value;
  }
}
