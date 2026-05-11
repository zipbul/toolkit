import { HttpHeader } from '@zipbul/shared';

import type { HeaderEntry } from '../header-entry';

export function serializeXRobotsTag(directives: readonly string[]): HeaderEntry {
  return [HttpHeader.XRobotsTag, directives.join(', ')];
}
