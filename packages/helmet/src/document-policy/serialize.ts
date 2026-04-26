import { HttpHeader } from '@zipbul/shared';

import { LIMITS, RESERVED_KEYS } from '../constants';
import { HelmetErrorReason } from '../enums';
import type { DocumentPolicyOptions, ViolationDetail } from '../interfaces';
import {
  serializeDictionary,
  serializeItem,
  token,
  type DictionaryValue,
  type SfBareItem,
} from '../structured-fields/serialize';
import type { ResolvedDocumentPolicyOptions } from '../types';

import type { HeaderEntry } from '../header-entry';

export function resolveDocumentPolicy(
  input: DocumentPolicyOptions | undefined,
  path: string,
  violations: ViolationDetail[],
): ResolvedDocumentPolicyOptions | undefined {
  if (input === undefined) return undefined;
  const map = new Map<string, string | boolean | number | readonly (string | boolean | number)[]>();
  const raw = input.policies ?? {};
  // `{ __proto__: x }` literal sets the prototype rather than an own property,
  // so Object.entries misses it. Inspect the prototype chain explicitly.
  const proto = Object.getPrototypeOf(raw);
  if (proto !== null && proto !== Object.prototype) {
    violations.push({
      reason: HelmetErrorReason.ReservedKeyDenied,
      path: `${path}.policies.__proto__`,
      message: 'reserved key denied (__proto__ override on input object)',
    });
  }
  const entries = Object.entries(raw);
  if (entries.length > LIMITS.documentPolicyEntries) {
    violations.push({
      reason: HelmetErrorReason.InputTooLarge,
      path: `${path}.policies`,
      message: `too many document policy entries (${entries.length} > ${LIMITS.documentPolicyEntries})`,
    });
  }
  for (const [k, v] of entries) {
    if (RESERVED_KEYS.has(k)) {
      violations.push({
        reason: HelmetErrorReason.ReservedKeyDenied,
        path: `${path}.policies.${k}`,
        message: 'reserved key denied (prototype pollution guard)',
      });
      continue;
    }
    map.set(k, Array.isArray(v) ? Object.freeze(v.slice()) : v);
  }
  return Object.freeze({ policies: map });
}

export function serializeDocumentPolicy(opts: ResolvedDocumentPolicyOptions): HeaderEntry {
  const dict = new Map<string, DictionaryValue>();
  for (const [k, v] of opts.policies) {
    if (Array.isArray(v)) {
      const arr = v as readonly (string | boolean | number)[];
      dict.set(k, { innerList: arr.map(toBareItem) });
    } else {
      dict.set(k, toBareItem(v as string | boolean | number));
    }
  }
  return [HttpHeader.DocumentPolicy, serializeDictionary(dict)];
}

function toBareItem(v: string | boolean | number): SfBareItem {
  // Strings without spaces and matching token grammar are emitted as tokens
  // for spec parity (Document-Policy values are typically tokens).
  if (typeof v === 'string' && /^[a-zA-Z*][a-zA-Z0-9!#$%&'*+\-.^_`|~:/]*$/.test(v)) {
    return token(v);
  }
  return v;
}

// Helpful for serializeItem only: re-exported to satisfy unused-import lint
void serializeItem;
