import { HttpHeader } from '@zipbul/shared';

import type { HeaderEntry } from '../header-entry';
import type { CoepValue } from '../types';

const COEP_VALUES = new Set<CoepValue>(['require-corp', 'credentialless', 'unsafe-none']);

export function serializeCoep(value: CoepValue): HeaderEntry {
  return [HttpHeader.CrossOriginEmbedderPolicy, value];
}

export function serializeCoepReportOnly(value: CoepValue): HeaderEntry {
  return [HttpHeader.CrossOriginEmbedderPolicyReportOnly, value];
}

export function isValidCoep(value: string): value is CoepValue {
  return COEP_VALUES.has(value as CoepValue);
}
