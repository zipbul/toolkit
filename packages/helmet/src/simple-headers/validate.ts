import { HelmetErrorReason } from '../enums';
import type { ViolationDetail } from '../interfaces';
import type { ReferrerPolicyToken, XFrameOptionsValue } from '../types';

const REFERRER_POLICY_TOKENS = new Set<ReferrerPolicyToken>([
  'no-referrer',
  'no-referrer-when-downgrade',
  'origin',
  'origin-when-cross-origin',
  'same-origin',
  'strict-origin',
  'strict-origin-when-cross-origin',
  'unsafe-url',
]);

const XFO_VALUES = new Set<XFrameOptionsValue>(['deny', 'sameorigin', 'DENY', 'SAMEORIGIN']);
const XPCDP_VALUES = new Set(['none', 'master-only', 'by-content-type', 'all']);
const XDPC_VALUES = new Set(['on', 'off']);
const XSS_VALUES = new Set(['0', '1; mode=block']);

export function validateReferrerPolicy(
  tokens: readonly ReferrerPolicyToken[],
  path: string,
): ViolationDetail[] {
  const out: ViolationDetail[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === undefined || !REFERRER_POLICY_TOKENS.has(t)) {
      out.push({
        reason: HelmetErrorReason.InvalidReferrerPolicyToken,
        path: `${path}[${i}]`,
        message: 'invalid Referrer-Policy token',
        remedy:
          'use one of: no-referrer, no-referrer-when-downgrade, origin, origin-when-cross-origin, same-origin, strict-origin, strict-origin-when-cross-origin, unsafe-url',
      });
    }
  }
  return out;
}

export function validateXFrameOptions(value: string, path: string): ViolationDetail[] {
  if (!XFO_VALUES.has(value as XFrameOptionsValue)) {
    return [
      {
        reason: HelmetErrorReason.InvalidXFrameOptionsValue,
        path,
        message: 'invalid X-Frame-Options value',
        remedy: "use 'deny' or 'sameorigin' (or uppercase variants for WAF compatibility)",
      },
    ];
  }
  return [];
}

export function validateXDnsPrefetchControl(value: string, path: string): ViolationDetail[] {
  if (!XDPC_VALUES.has(value)) {
    return [
      {
        reason: HelmetErrorReason.InvalidXDnsPrefetchValue,
        path,
        message: "X-DNS-Prefetch-Control must be 'on' or 'off'",
      },
    ];
  }
  return [];
}

export function validateXPermittedCrossDomainPolicies(
  value: string,
  path: string,
): ViolationDetail[] {
  if (!XPCDP_VALUES.has(value)) {
    return [
      {
        reason: HelmetErrorReason.InvalidXPermittedCrossDomainValue,
        path,
        message: 'invalid X-Permitted-Cross-Domain-Policies value',
      },
    ];
  }
  return [];
}

export function validateXXssProtection(value: string, path: string): ViolationDetail[] {
  if (!XSS_VALUES.has(value)) {
    return [
      {
        reason: HelmetErrorReason.InvalidXXssProtectionValue,
        path,
        message: "X-XSS-Protection must be '0' or '1; mode=block'",
      },
    ];
  }
  return [];
}

const TAO_RE = /^(\*|null|https?:\/\/[^\s,]+)$/;

export function validateTimingAllowOrigin(values: readonly string[], path: string): ViolationDetail[] {
  const out: ViolationDetail[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (typeof v !== 'string' || !TAO_RE.test(v)) {
      out.push({
        reason: HelmetErrorReason.InvalidTimingAllowOrigin,
        path: `${path}[${i}]`,
        message: "Timing-Allow-Origin entries must be '*', 'null', or a fully-qualified http(s) origin",
      });
    }
  }
  return out;
}
