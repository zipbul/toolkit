import { HttpHeader } from '@zipbul/shared';

import { LIMITS, RESERVED_KEYS } from '../constants';
import { HelmetErrorReason } from '../enums';
import type { NelOptions, ReportingEndpointsOptions, ViolationDetail } from '../interfaces';
import { serializeString } from '../structured-fields/serialize';
import type { ResolvedNelOptions, ResolvedReportingEndpointsOptions } from '../types';

import type { HeaderEntry } from '../header-entry';

const ENDPOINT_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function resolveReportingEndpoints(
  input: ReportingEndpointsOptions | undefined,
  path: string,
  violations: ViolationDetail[],
): ResolvedReportingEndpointsOptions | undefined {
  if (input === undefined) return undefined;
  const map = new Map<string, string>();
  const raw = input.endpoints ?? {};
  // Detect prototype pollution attempts: object literal `{__proto__: x}` sets
  // the prototype rather than an own property, so Object.entries misses it.
  // Inspect the prototype chain explicitly.
  const proto = Object.getPrototypeOf(raw);
  if (proto !== null && proto !== Object.prototype) {
    violations.push({
      reason: HelmetErrorReason.ReservedKeyDenied,
      path: `${path}.endpoints.__proto__`,
      message: 'reserved key denied (__proto__ override on input object)',
    });
  }
  const entries = Object.entries(raw);
  if (entries.length > LIMITS.reportingEndpoints) {
    violations.push({
      reason: HelmetErrorReason.InputTooLarge,
      path: `${path}.endpoints`,
      message: `too many reporting endpoints (${entries.length} > ${LIMITS.reportingEndpoints})`,
    });
  }
  for (const [name, url] of entries) {
    if (RESERVED_KEYS.has(name)) {
      violations.push({
        reason: HelmetErrorReason.ReservedKeyDenied,
        path: `${path}.endpoints.${name}`,
        message: 'reserved key denied (prototype pollution guard)',
      });
      continue;
    }
    if (!ENDPOINT_NAME_RE.test(name)) {
      violations.push({
        reason: HelmetErrorReason.InvalidReportingEndpointName,
        path: `${path}.endpoints.${name}`,
        message: 'reporting endpoint name must match [A-Za-z0-9_-]{1,64}',
      });
      continue;
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      violations.push({
        reason: HelmetErrorReason.ReportingEndpointInvalidUrl,
        path: `${path}.endpoints.${name}`,
        message: 'reporting endpoint URL is not a valid absolute URL',
      });
      continue;
    }
    if (parsed.protocol !== 'https:') {
      violations.push({
        reason: HelmetErrorReason.ReportingEndpointNotHttps,
        path: `${path}.endpoints.${name}`,
        message: 'reporting endpoint URL must use https:',
      });
      continue;
    }
    map.set(name, parsed.toString());
  }
  return Object.freeze({ endpoints: map });
}

export function serializeReportingEndpoints(
  opts: ResolvedReportingEndpointsOptions,
): HeaderEntry {
  const parts: string[] = [];
  for (const [name, url] of opts.endpoints) {
    parts.push(`${name}=${serializeString(url)}`);
  }
  return [HttpHeader.ReportingEndpoints, parts.join(', ')];
}

export function resolveNel(
  input: NelOptions | undefined,
  path: string,
  violations: ViolationDetail[],
  knownEndpoints: ReadonlySet<string>,
): ResolvedNelOptions | undefined {
  if (input === undefined) return undefined;
  if (typeof input.reportTo !== 'string' || !knownEndpoints.has(input.reportTo)) {
    violations.push({
      reason: HelmetErrorReason.NelMissingReportingEndpoint,
      path: `${path}.reportTo`,
      message: 'NEL reportTo must reference a name defined in reportingEndpoints',
    });
  }
  if (!Number.isInteger(input.maxAge) || input.maxAge < 0) {
    violations.push({
      reason: HelmetErrorReason.NelInvalidMaxAge,
      path: `${path}.maxAge`,
      message: 'NEL max_age must be a non-negative integer',
    });
  }
  if (input.successFraction !== undefined) {
    if (input.successFraction < 0 || input.successFraction > 1) {
      violations.push({
        reason: HelmetErrorReason.NelInvalidFraction,
        path: `${path}.successFraction`,
        message: 'NEL success_fraction must be in [0, 1]',
      });
    }
  }
  if (input.failureFraction !== undefined) {
    if (input.failureFraction < 0 || input.failureFraction > 1) {
      violations.push({
        reason: HelmetErrorReason.NelInvalidFraction,
        path: `${path}.failureFraction`,
        message: 'NEL failure_fraction must be in [0, 1]',
      });
    }
  }
  return Object.freeze({
    reportTo: input.reportTo,
    maxAge: input.maxAge,
    includeSubdomains: input.includeSubdomains === true,
    successFraction: input.successFraction,
    failureFraction: input.failureFraction,
  });
}

/**
 * NEL header is JSON. Build a stable string with explicit ordering so it
 * is suitable for golden-file regression testing.
 */
export function serializeNel(opts: ResolvedNelOptions): HeaderEntry {
  const obj: Record<string, unknown> = {
    report_to: opts.reportTo,
    max_age: opts.maxAge,
  };
  if (opts.includeSubdomains) obj.include_subdomains = true;
  if (opts.successFraction !== undefined) obj.success_fraction = opts.successFraction;
  if (opts.failureFraction !== undefined) obj.failure_fraction = opts.failureFraction;
  return [HttpHeader.Nel, JSON.stringify(obj)];
}

/**
 * NEL still requires the legacy `Report-To` header. We synthesise one
 * from `Reporting-Endpoints` so users do not need to write JSON twice.
 */
export function serializeReportToFromEndpoints(
  endpoints: ResolvedReportingEndpointsOptions,
  nel: ResolvedNelOptions,
): HeaderEntry | undefined {
  const url = endpoints.endpoints.get(nel.reportTo);
  if (url === undefined) return undefined;
  const groups = [
    {
      group: nel.reportTo,
      max_age: nel.maxAge,
      endpoints: [{ url }],
      ...(nel.includeSubdomains ? { include_subdomains: true } : {}),
    },
  ];
  return [HttpHeader.ReportTo, groups.map(g => JSON.stringify(g)).join(', ')];
}
