import { HttpHeader } from '@zipbul/shared';

import type { HeaderEntry } from '../header-entry';
import { serializeString } from '../structured-fields/serialize';
import type { CoepResolved, CoepValue } from '../types';

const COEP_VALUES = new Set<CoepValue>(['require-corp', 'credentialless', 'unsafe-none']);

/** WHATWG HTML §7.1.4.1 — value plus optional `report-to="<endpoint>"` parameter. */
function serializeCoepValue(policy: CoepResolved): string {
  if (policy.reportTo === undefined) return policy.value;
  return `${policy.value}; report-to=${serializeString(policy.reportTo)}`;
}

export function serializeCoep(policy: CoepResolved): HeaderEntry {
  return [HttpHeader.CrossOriginEmbedderPolicy, serializeCoepValue(policy)];
}

export function serializeCoepReportOnly(policy: CoepResolved): HeaderEntry {
  return [HttpHeader.CrossOriginEmbedderPolicyReportOnly, serializeCoepValue(policy)];
}

export function isValidCoep(value: string): value is CoepValue {
  return COEP_VALUES.has(value as CoepValue);
}
