import { HttpHeader } from '@zipbul/shared';

import type { HeaderEntry } from '../header-entry';

export function serializeTimingAllowOrigin(values: readonly string[]): HeaderEntry {
  return [HttpHeader.TimingAllowOrigin, values.join(', ')];
}
