import { HttpHeader } from '@zipbul/shared';

import type { HeaderEntry } from '../header-entry';
import { serializeString } from '../structured-fields/serialize';
import type { CoopResolved, CoopValue } from '../types';

const COOP_VALUES = new Set<CoopValue>([
  'same-origin',
  'same-origin-allow-popups',
  'noopener-allow-popups',
  'unsafe-none',
]);

/** WHATWG HTML §7.1.3.1 — value plus optional `report-to="<endpoint>"` parameter. */
function serializeCoopValue(policy: CoopResolved): string {
  if (policy.reportTo === undefined) return policy.value;
  return `${policy.value}; report-to=${serializeString(policy.reportTo)}`;
}

export function serializeCoop(policy: CoopResolved): HeaderEntry {
  return [HttpHeader.CrossOriginOpenerPolicy, serializeCoopValue(policy)];
}

export function serializeCoopReportOnly(policy: CoopResolved): HeaderEntry {
  return [HttpHeader.CrossOriginOpenerPolicyReportOnly, serializeCoopValue(policy)];
}

export function isValidCoop(value: string): value is CoopValue {
  return COOP_VALUES.has(value as CoopValue);
}
