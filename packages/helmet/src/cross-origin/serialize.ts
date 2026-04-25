import { HttpHeader } from '@zipbul/shared';

import type { CoepValue, CoopValue, CorpValue } from '../types';

import type { HeaderEntry } from '../simple-headers/serialize';

export function serializeCoop(value: CoopValue): HeaderEntry {
  return [HttpHeader.CrossOriginOpenerPolicy, value];
}

export function serializeCoopReportOnly(value: CoopValue): HeaderEntry {
  return [HttpHeader.CrossOriginOpenerPolicyReportOnly, value];
}

export function serializeCoep(value: CoepValue): HeaderEntry {
  return [HttpHeader.CrossOriginEmbedderPolicy, value];
}

export function serializeCoepReportOnly(value: CoepValue): HeaderEntry {
  return [HttpHeader.CrossOriginEmbedderPolicyReportOnly, value];
}

export function serializeCorp(value: CorpValue): HeaderEntry {
  return [HttpHeader.CrossOriginResourcePolicy, value];
}

const COOP_VALUES = new Set<CoopValue>([
  'same-origin',
  'same-origin-allow-popups',
  'noopener-allow-popups',
  'unsafe-none',
]);
const COEP_VALUES = new Set<CoepValue>(['require-corp', 'credentialless', 'unsafe-none']);
const CORP_VALUES = new Set<CorpValue>(['same-origin', 'same-site', 'cross-origin']);

export function isValidCoop(value: string): value is CoopValue {
  return COOP_VALUES.has(value as CoopValue);
}
export function isValidCoep(value: string): value is CoepValue {
  return COEP_VALUES.has(value as CoepValue);
}
export function isValidCorp(value: string): value is CorpValue {
  return CORP_VALUES.has(value as CorpValue);
}
