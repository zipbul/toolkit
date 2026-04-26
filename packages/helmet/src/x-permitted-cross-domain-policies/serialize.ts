import { HttpHeader } from '@zipbul/shared';

import type { HeaderEntry } from '../header-entry';

export function serializeXPermittedCrossDomainPolicies(
  value: 'none' | 'master-only' | 'by-content-type' | 'all',
): HeaderEntry {
  return [HttpHeader.XPermittedCrossDomainPolicies, value];
}
