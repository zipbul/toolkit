import { HttpHeader } from '@zipbul/shared';

import type { HeaderEntry } from '../header-entry';

export function serializeXDownloadOptions(): HeaderEntry {
  return [HttpHeader.XDownloadOptions, 'noopen'];
}
