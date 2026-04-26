import { HttpHeader } from '@zipbul/shared';

import type { HeaderEntry } from '../header-entry';

export function serializeXDnsPrefetchControl(value: 'on' | 'off'): HeaderEntry {
  return [HttpHeader.XDnsPrefetchControl, value];
}
