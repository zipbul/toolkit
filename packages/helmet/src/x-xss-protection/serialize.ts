import { HttpHeader } from '@zipbul/shared';

import type { HeaderEntry } from '../header-entry';

export function serializeXXssProtection(value: '0' | '1; mode=block'): HeaderEntry {
  return [HttpHeader.XXssProtection, value];
}
