import { HttpHeader } from '@zipbul/shared';

import { HelmetErrorReason } from '../enums';
import type { IntegrityPolicyOptions, ViolationDetail } from '../interfaces';
import { serializeDictionary, token } from '../structured-fields/serialize';
import type { ResolvedIntegrityPolicyOptions } from '../types';

import type { HeaderEntry } from '../simple-headers/serialize';

const VALID_DESTINATIONS = new Set<'script' | 'style'>(['script', 'style']);

export function resolveIntegrityPolicy(
  input: boolean | IntegrityPolicyOptions | undefined,
): ResolvedIntegrityPolicyOptions | false | undefined {
  if (input === undefined) return undefined;
  if (input === false) return false;
  if (input === true) {
    return Object.freeze({
      blockedDestinations: Object.freeze(['script', 'style'] as const),
      sources: Object.freeze(['inline'] as const),
      endpoints: Object.freeze([]),
    });
  }
  return Object.freeze({
    blockedDestinations: Object.freeze((input.blockedDestinations ?? ['script', 'style']).slice()),
    sources: Object.freeze((input.sources ?? ['inline']).slice()),
    endpoints: Object.freeze((input.endpoints ?? []).slice()),
  });
}

export function validateIntegrityPolicy(
  resolved: ResolvedIntegrityPolicyOptions,
  path: string,
  knownEndpoints: ReadonlySet<string>,
): ViolationDetail[] {
  const out: ViolationDetail[] = [];
  if (resolved.blockedDestinations.length === 0) {
    out.push({
      reason: HelmetErrorReason.IntegrityPolicyEmpty,
      path: `${path}.blockedDestinations`,
      message: 'integrityPolicy.blockedDestinations must not be empty',
    });
  }
  for (let i = 0; i < resolved.blockedDestinations.length; i++) {
    const d = resolved.blockedDestinations[i];
    if (d === undefined || !VALID_DESTINATIONS.has(d)) {
      out.push({
        reason: HelmetErrorReason.InvalidIntegrityDestination,
        path: `${path}.blockedDestinations[${i}]`,
        message: "blocked-destinations must be 'script' or 'style'",
      });
    }
  }
  for (let i = 0; i < resolved.sources.length; i++) {
    if (resolved.sources[i] !== 'inline') {
      out.push({
        reason: HelmetErrorReason.InvalidIntegritySource,
        path: `${path}.sources[${i}]`,
        message: "integrity-policy sources currently supports only 'inline'",
      });
    }
  }
  for (let i = 0; i < resolved.endpoints.length; i++) {
    const e = resolved.endpoints[i];
    if (typeof e !== 'string' || !knownEndpoints.has(e)) {
      out.push({
        reason: HelmetErrorReason.UnknownReportingEndpoint,
        path: `${path}.endpoints[${i}]`,
        message: 'integrity-policy endpoint name not defined in reportingEndpoints',
      });
    }
  }
  return out;
}

export function serializeIntegrityPolicy(opts: ResolvedIntegrityPolicyOptions): HeaderEntry {
  const dict = new Map<string, never>();
  dict.set('blocked-destinations', {
    innerList: opts.blockedDestinations.map(d => token(d)),
  } as never);
  if (opts.sources.length > 0) {
    dict.set('sources', { innerList: opts.sources.map(s => token(s)) } as never);
  }
  if (opts.endpoints.length > 0) {
    dict.set('endpoints', { innerList: opts.endpoints.map(e => token(e)) } as never);
  }
  return [HttpHeader.IntegrityPolicy, serializeDictionary(dict as never)];
}

export function serializeIntegrityPolicyReportOnly(
  opts: ResolvedIntegrityPolicyOptions,
): HeaderEntry {
  const [, value] = serializeIntegrityPolicy(opts);
  return [HttpHeader.IntegrityPolicyReportOnly, value];
}
