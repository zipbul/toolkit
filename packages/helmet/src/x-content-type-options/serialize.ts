import { HttpHeader } from '@zipbul/shared';

import type { HeaderEntry } from '../header-entry';

export function serializeXContentTypeOptions(): HeaderEntry {
  return [HttpHeader.XContentTypeOptions, 'nosniff'];
}
