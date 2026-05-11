import { HttpHeader } from '@zipbul/shared';

import type { HeaderEntry } from '../header-entry';
import type { CorpValue } from '../types';

const CORP_VALUES = new Set<CorpValue>(['same-origin', 'same-site', 'cross-origin']);

export function serializeCorp(value: CorpValue): HeaderEntry {
  return [HttpHeader.CrossOriginResourcePolicy, value];
}

export function isValidCorp(value: string): value is CorpValue {
  return CORP_VALUES.has(value as CorpValue);
}
