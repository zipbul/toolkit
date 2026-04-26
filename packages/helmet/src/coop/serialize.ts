import { HttpHeader } from '@zipbul/shared';

import type { HeaderEntry } from '../header-entry';
import type { CoopValue } from '../types';

const COOP_VALUES = new Set<CoopValue>([
  'same-origin',
  'same-origin-allow-popups',
  'noopener-allow-popups',
  'unsafe-none',
]);

export function serializeCoop(value: CoopValue): HeaderEntry {
  return [HttpHeader.CrossOriginOpenerPolicy, value];
}

export function serializeCoopReportOnly(value: CoopValue): HeaderEntry {
  return [HttpHeader.CrossOriginOpenerPolicyReportOnly, value];
}

export function isValidCoop(value: string): value is CoopValue {
  return COOP_VALUES.has(value as CoopValue);
}
