import { HttpHeader } from '@zipbul/shared';

import type { HeaderEntry } from '../header-entry';

export function serializeXPermittedCrossDomainPolicies(
  value: 'none' | 'master-only' | 'by-content-type' | 'by-ftp-filename' | 'all',
): HeaderEntry {
  return [HttpHeader.XPermittedCrossDomainPolicies, value];
}
