import { HttpHeader } from '@zipbul/shared';

import type { HeaderEntry } from '../header-entry';
import { serializeBoolean } from '../structured-fields/serialize';

/**
 * Origin-Agent-Cluster — sf-boolean. Emits `?1` (opt-in) or `?0` (opt-out).
 * Both values are meaningful; `false` is *not* "do not emit".
 */
export function serializeOriginAgentCluster(value: boolean): HeaderEntry {
  return [HttpHeader.OriginAgentCluster, serializeBoolean(value)];
}
