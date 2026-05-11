import { HttpHeader } from '@zipbul/shared';

import { LIMITS } from '../constants';
import { HelmetErrorReason } from '../enums';
import type {
  DocumentPolicyEntry,
  DocumentPolicyOptions,
  ViolationDetail,
} from '../interfaces';
import { checkPrototypeChain, checkReservedKey } from '../internal/reserved-key-guard';
import {
  serializeDictionary,
  token,
  type DictionaryValue,
  type SfBareItem,
} from '../structured-fields/serialize';
import type {
  ResolvedDocumentPolicyOptions,
  ResolvedDocumentPolicyValue,
} from '../types';

import type { HeaderEntry } from '../header-entry';

function isEntryShape(v: unknown): v is DocumentPolicyEntry {
  return typeof v === 'object' && v !== null && 'value' in (v as Record<string, unknown>);
}

export function resolveDocumentPolicy(
  input: DocumentPolicyOptions | undefined,
  path: string,
  violations: ViolationDetail[],
): ResolvedDocumentPolicyOptions | undefined {
  if (input === undefined) return undefined;
  const map = new Map<string, ResolvedDocumentPolicyValue>();
  const raw = input.policies ?? {};
  checkPrototypeChain(raw, `${path}.policies`, violations);
  const entries = Object.entries(raw);
  if (entries.length > LIMITS.documentPolicyEntries) {
    violations.push({
      reason: HelmetErrorReason.InputTooLarge,
      path: `${path}.policies`,
      message: `too many document policy entries (${entries.length} > ${LIMITS.documentPolicyEntries})`,
    });
  }
  for (const [k, v] of entries) {
    if (!checkReservedKey(k, `${path}.policies.${k}`, violations)) continue;
    if (isEntryShape(v)) {
      const params = resolveParameters(v.parameters);
      const value = Array.isArray(v.value) ? Object.freeze(v.value.slice()) : v.value;
      map.set(k, { value, parameters: params });
    } else {
      map.set(k, Array.isArray(v) ? Object.freeze(v.slice()) : v);
    }
  }
  return Object.freeze({ policies: map });
}

function resolveParameters(
  params: Record<string, string | number | boolean> | undefined,
): ReadonlyMap<string, SfBareItem> {
  const out = new Map<string, SfBareItem>();
  if (params === undefined) return out;
  for (const [pk, pv] of Object.entries(params)) {
    if (typeof pv === 'string') out.set(pk, token(pv));
    else out.set(pk, pv);
  }
  return out;
}

export function serializeDocumentPolicy(opts: ResolvedDocumentPolicyOptions): HeaderEntry {
  const dict = new Map<string, DictionaryValue>();
  for (const [k, v] of opts.policies) {
    if (typeof v === 'object' && v !== null && 'parameters' in v && 'value' in v) {
      const inner = v.value;
      if (Array.isArray(inner)) {
        dict.set(k, {
          innerList: inner.map(toBareItem),
          parameters: v.parameters,
        });
      } else {
        dict.set(k, {
          item: toBareItem(inner as string | boolean | number),
          parameters: v.parameters,
        });
      }
    } else if (Array.isArray(v)) {
      dict.set(k, { innerList: v.map(toBareItem) });
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

