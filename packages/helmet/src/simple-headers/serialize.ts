import { HttpHeader } from '@zipbul/shared';

import type { ReferrerPolicyToken, XFrameOptionsValue } from '../types';
import { serializeBoolean } from '../structured-fields/serialize';

export type HeaderEntry = readonly [name: string, value: string];

export function serializeXContentTypeOptions(): HeaderEntry {
  return [HttpHeader.XContentTypeOptions, 'nosniff'];
}

export function serializeXFrameOptions(value: XFrameOptionsValue): HeaderEntry {
  // Preserve user case for WAF compatibility (e.g., Cloudflare DENY signature).
  return [HttpHeader.XFrameOptions, value];
}

export function serializeXDnsPrefetchControl(value: 'on' | 'off'): HeaderEntry {
  return [HttpHeader.XDnsPrefetchControl, value];
}

export function serializeXPermittedCrossDomainPolicies(
  value: 'none' | 'master-only' | 'by-content-type' | 'all',
): HeaderEntry {
  return [HttpHeader.XPermittedCrossDomainPolicies, value];
}

export function serializeReferrerPolicy(tokens: readonly ReferrerPolicyToken[]): HeaderEntry {
  return [HttpHeader.ReferrerPolicy, tokens.join(', ')];
}

export function serializeXXssProtection(value: '0' | '1; mode=block'): HeaderEntry {
  return [HttpHeader.XXssProtection, value];
}

export function serializeXDownloadOptions(): HeaderEntry {
  return [HttpHeader.XDownloadOptions, 'noopen'];
}

/**
 * Origin-Agent-Cluster is an sf-boolean — emits `?1` (opt-in) or `?0` (opt-out).
 * Both are meaningful; `false` is *not* "do not emit".
 */
export function serializeOriginAgentCluster(value: boolean): HeaderEntry {
  return [HttpHeader.OriginAgentCluster, serializeBoolean(value)];
}

export function serializeTimingAllowOrigin(values: readonly string[]): HeaderEntry {
  return [HttpHeader.TimingAllowOrigin, values.join(', ')];
}

export function serializeXRobotsTag(directives: readonly string[]): HeaderEntry {
  return [HttpHeader.XRobotsTag, directives.join(', ')];
}
