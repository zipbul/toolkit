import { HttpHeader } from '@zipbul/shared';

import { LIMITS, NONCE_PLACEHOLDER, RESERVED_KEYS } from '../constants';
import { HelmetErrorReason, HelmetWarningReason } from '../enums';
import type {
  ContentSecurityPolicyOptions,
  CspDirectives,
  HelmetWarning,
  ViolationDetail,
} from '../interfaces';
import type { ResolvedCspOptions, SandboxToken } from '../types';

import type { HeaderEntry } from '../header-entry';
import {
  DEPRECATED_DIRECTIVES,
  EMIT_ORDER,
  FETCH_DIRECTIVES,
  NON_FETCH_LIST_DIRECTIVES,
  camelToKebab,
} from './directives';
import { FRAME_ANCESTORS_FORBIDDEN, isNonceOrHashSource, validateCspSource } from './source-validate';

const REPORT_TO_NAME_RE = /^[A-Za-z0-9_-]+$/;
// CRLF + C0/DEL + whitespace + structural delimiters that would corrupt header
// serialization or violate URL grammar (RFC 3986). Defense-in-depth: Fetch
// Headers also rejects CRLF, but we fail loudly at validate-time.
const REPORT_URI_FORBIDDEN_RE = /[\x00-\x20\x7f"<>\\^`{|}\u00a0\u2028\u2029\ufeff]/;
const SANDBOX_TOKENS = new Set<SandboxToken>([
  'allow-downloads',
  'allow-forms',
  'allow-modals',
  'allow-orientation-lock',
  'allow-pointer-lock',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  'allow-presentation',
  'allow-same-origin',
  'allow-scripts',
  'allow-storage-access-by-user-activation',
  'allow-top-navigation',
  'allow-top-navigation-by-user-activation',
  'allow-top-navigation-to-custom-protocols',
]);

const TT_POLICY_NAME_RE = /^[A-Za-z0-9\-#=_/@.%]+$/;

const OWASP_DEFAULTS: CspDirectives = {
  defaultSrc: ["'self'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
  objectSrc: ["'none'"],
  manifestSrc: ["'self'"],
  upgradeInsecureRequests: true,
};

export function resolveCsp(
  input: boolean | ContentSecurityPolicyOptions | undefined,
  fallback: 'default-on' | 'report-only',
): ResolvedCspOptions | false | undefined {
  if (input === false) return false;
  if (input === undefined) {
    return fallback === 'default-on' ? toResolved(OWASP_DEFAULTS) : undefined;
  }
  if (input === true) return toResolved(OWASP_DEFAULTS);
  // Replace per directive (PLAN §CSP 디렉티브 커스터마이징 전략: Replace).
  const merged: CspDirectives = { ...OWASP_DEFAULTS, ...input.directives };
  return toResolved(merged);
}

function toResolved(d: CspDirectives): ResolvedCspOptions {
  const map = new Map<string, readonly string[] | string | boolean>();
  for (const key of EMIT_ORDER) {
    const value = d[key];
    if (value === undefined) continue;
    const kebab = camelToKebab(key);
    if (Array.isArray(value)) {
      map.set(kebab, Object.freeze(value.slice()));
    } else if (typeof value === 'string' || typeof value === 'boolean') {
      map.set(kebab, value);
    }
  }
  return Object.freeze({ directives: map });
}

export function validateCsp(
  resolved: ResolvedCspOptions,
  path: string,
  warnings: HelmetWarning[],
  knownEndpoints: ReadonlySet<string>,
): ViolationDetail[] {
  const out: ViolationDetail[] = [];
  if (resolved.directives.size > LIMITS.cspDirectiveKeys) {
    out.push({
      reason: HelmetErrorReason.InputTooLarge,
      path,
      message: `too many CSP directives (${resolved.directives.size} > ${LIMITS.cspDirectiveKeys})`,
    });
  }
  for (const [name, value] of resolved.directives) {
    if (RESERVED_KEYS.has(name)) {
      out.push({
        reason: HelmetErrorReason.ReservedKeyDenied,
        path: `${path}.directives.${name}`,
        message: 'reserved key denied',
      });
      continue;
    }
    if (DEPRECATED_DIRECTIVES.has(name)) {
      out.push({
        reason: HelmetErrorReason.DeprecatedCspDirective,
        path: `${path}.directives.${name}`,
        message: `CSP directive "${name}" is deprecated/removed`,
      });
      continue;
    }

    if (name === 'sandbox') {
      validateSandbox(value, `${path}.directives.${name}`, out);
      continue;
    }
    if (name === 'webrtc') {
      if (value !== 'allow' && value !== 'block') {
        out.push({
          reason: HelmetErrorReason.InvalidWebRtcDirective,
          path: `${path}.directives.${name}`,
          message: "webrtc must be 'allow' or 'block'",
        });
      }
      continue;
    }
    if (name === 'upgrade-insecure-requests') {
      if (typeof value !== 'boolean') {
        out.push({
          reason: HelmetErrorReason.InvalidCspKeyword,
          path: `${path}.directives.${name}`,
          message: 'upgrade-insecure-requests must be boolean',
        });
      }
      continue;
    }
    if (name === 'report-to') {
      if (typeof value !== 'string' || !REPORT_TO_NAME_RE.test(value)) {
        out.push({
          reason: HelmetErrorReason.InvalidReportToGroupName,
          path: `${path}.directives.${name}`,
          message: 'report-to value must match [A-Za-z0-9_-]+',
        });
      } else if (!knownEndpoints.has(value)) {
        out.push({
          reason: HelmetErrorReason.UnknownReportingEndpoint,
          path: `${path}.directives.${name}`,
          message: 'report-to references undefined Reporting-Endpoints name',
        });
      }
      continue;
    }
    if (name === 'report-uri') {
      if (typeof value !== 'string' || value.trim().length === 0) {
        out.push({
          reason: HelmetErrorReason.InvalidReportUri,
          path: `${path}.directives.${name}`,
          message: 'report-uri must be a non-empty string',
        });
      } else if (value.length > LIMITS.hostSourceLength) {
        out.push({
          reason: HelmetErrorReason.InputTooLarge,
          path: `${path}.directives.${name}`,
          message: `report-uri exceeds ${LIMITS.hostSourceLength} chars`,
        });
      } else if (REPORT_URI_FORBIDDEN_RE.test(value)) {
        out.push({
          reason: HelmetErrorReason.ControlCharRejected,
          path: `${path}.directives.${name}`,
          message: 'report-uri contains forbidden whitespace or control characters',
        });
      }
      continue;
    }
    if (name === 'require-trusted-types-for') {
      validateRequireTt(value, `${path}.directives.${name}`, out);
      continue;
    }
    if (name === 'trusted-types') {
      validateTrustedTypes(value, `${path}.directives.${name}`, out, warnings);
      continue;
    }

    // Source-list directive
    if (!Array.isArray(value)) {
      out.push({
        reason: HelmetErrorReason.InvalidCspKeyword,
        path: `${path}.directives.${name}`,
        message: 'expected an array of CSP sources',
      });
      continue;
    }
    if (FETCH_DIRECTIVES.has(toCamel(name) as keyof CspDirectives) && value.length === 0) {
      out.push({
        reason: HelmetErrorReason.EmptyFetchDirective,
        path: `${path}.directives.${name}`,
        message: `${name} must have at least one source — use ['none'] explicitly`,
      });
      continue;
    }
    if (value.length > LIMITS.cspSourcesPerDirective) {
      out.push({
        reason: HelmetErrorReason.InputTooLarge,
        path: `${path}.directives.${name}`,
        message: `too many sources (${value.length} > ${LIMITS.cspSourcesPerDirective})`,
      });
    }
    for (let i = 0; i < value.length; i++) {
      const v = value[i] ?? '';
      validateCspSource(v, `${path}.directives.${name}[${i}]`, out);
      if (name === 'frame-ancestors') {
        if (FRAME_ANCESTORS_FORBIDDEN.has(v)) {
          out.push({
            reason: HelmetErrorReason.InvalidFrameAncestorsKeyword,
            path: `${path}.directives.${name}[${i}]`,
            message: `frame-ancestors does not allow ${v} (CSP3 §6.4.2)`,
          });
        } else if (isNonceOrHashSource(v)) {
          out.push({
            reason: HelmetErrorReason.InvalidFrameAncestorsKeyword,
            path: `${path}.directives.${name}[${i}]`,
            message:
              'frame-ancestors does not allow nonce or hash sources (CSP3 §6.4.2 — only host/scheme/self/none)',
          });
        }
      }
    }
    if (NON_FETCH_LIST_DIRECTIVES.has(toCamel(name) as keyof CspDirectives) && value.length === 0) {
      out.push({
        reason: HelmetErrorReason.EmptyFetchDirective,
        path: `${path}.directives.${name}`,
        message: `${name} must have at least one source`,
      });
    }
  }

  semanticWarnings(resolved, path, warnings);
  return out;
}

function validateSandbox(
  value: readonly string[] | string | boolean,
  path: string,
  out: ViolationDetail[],
): void {
  if (!Array.isArray(value)) {
    out.push({
      reason: HelmetErrorReason.InvalidSandboxToken,
      path,
      message: 'sandbox must be an array of tokens',
    });
    return;
  }
  for (let i = 0; i < value.length; i++) {
    const t = value[i];
    if (typeof t !== 'string' || !SANDBOX_TOKENS.has(t as SandboxToken)) {
      out.push({
        reason: HelmetErrorReason.InvalidSandboxToken,
        path: `${path}[${i}]`,
        message: `unknown sandbox token`,
      });
    }
  }
}

function validateRequireTt(
  value: readonly string[] | string | boolean,
  path: string,
  out: ViolationDetail[],
): void {
  if (!Array.isArray(value)) {
    out.push({
      reason: HelmetErrorReason.InvalidRequireTrustedTypesToken,
      path,
      message: "require-trusted-types-for must be an array containing 'script'",
    });
    return;
  }
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== "'script'") {
      out.push({
        reason: HelmetErrorReason.InvalidRequireTrustedTypesToken,
        path: `${path}[${i}]`,
        message: "require-trusted-types-for accepts only 'script'",
      });
    }
  }
}

function validateTrustedTypes(
  value: readonly string[] | string | boolean,
  path: string,
  out: ViolationDetail[],
  warnings: HelmetWarning[],
): void {
  if (!Array.isArray(value)) {
    out.push({
      reason: HelmetErrorReason.InvalidTrustedTypesPolicyName,
      path,
      message: 'trustedTypes must be an array',
    });
    return;
  }
  for (let i = 0; i < value.length; i++) {
    const t = value[i] ?? '';
    if (t === "'allow-duplicates'" || t === "'none'" || t === '*') continue;
    const stripped = t.replace(/^'|'$/g, '');
    if (!TT_POLICY_NAME_RE.test(stripped)) {
      out.push({
        reason: HelmetErrorReason.InvalidTrustedTypesPolicyName,
        path: `${path}[${i}]`,
        message: 'trusted types policy-name must match [A-Za-z0-9-#=_/@.%]+',
      });
      continue;
    }
    if (stripped === 'default') {
      warnings.push({
        reason: HelmetWarningReason.TrustedTypesDefaultPolicy,
        path: `${path}[${i}]`,
        message: 'using the "default" Trusted Types policy applies to every sink-side string',
      });
    }
  }
}

function semanticWarnings(
  resolved: ResolvedCspOptions,
  path: string,
  warnings: HelmetWarning[],
): void {
  for (const [name, value] of resolved.directives) {
    if (!Array.isArray(value)) continue;
    const list = value as readonly string[];
    if (
      list.includes("'unsafe-inline'") &&
      list.some(s => s.startsWith("'nonce-") || s.startsWith("'sha256-") || s.startsWith("'sha384-") || s.startsWith("'sha512-"))
    ) {
      warnings.push({
        reason: HelmetWarningReason.UnsafeInlineWithNonce,
        path: `${path}.directives.${name}`,
        message: `'unsafe-inline' is ignored when nonce/hash is present in ${name} (CSP3 §6.7.3)`,
      });
    }
  }
  if (resolved.directives.has('manifest-src')) {
    // No-op: manifest-src is explicit, so no warn.
  } else if (resolved.directives.has('default-src')) {
    warnings.push({
      reason: HelmetWarningReason.ManifestSrcNoFallback,
      path: `${path}.directives.manifest-src`,
      message: 'manifest-src does not fall back to default-src; PWA manifest fetches may be blocked',
    });
  }
}

function toCamel(kebab: string): string {
  return kebab.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
}

export function serializeCsp(opts: ResolvedCspOptions): HeaderEntry {
  return [HttpHeader.ContentSecurityPolicy, serializeCspBody(opts)];
}

export function serializeCspReportOnly(opts: ResolvedCspOptions): HeaderEntry {
  return [HttpHeader.ContentSecurityPolicyReportOnly, serializeCspBody(opts)];
}

export function serializeCspBody(opts: ResolvedCspOptions): string {
  const parts: string[] = [];
  for (const [name, value] of opts.directives) {
    if (typeof value === 'boolean') {
      if (value) parts.push(name);
      continue;
    }
    if (typeof value === 'string') {
      parts.push(`${name} ${value}`);
      continue;
    }
    if (value.length === 0) {
      parts.push(name);
      continue;
    }
    parts.push(`${name} ${value.join(' ')}`);
  }
  return parts.join('; ');
}

/**
 * Build a CSP body that contains a per-request nonce placeholder.
 * The placeholder is later substituted via String.prototype.replaceAll
 * with a function form (see PLAN §캐싱 전략 cache poisoning section).
 *
 * **Fallback preservation**: when the user did not explicitly set
 * `script-src` / `style-src`, the spec says they fall back to `default-src`.
 * Naively writing `script-src 'nonce-X'` would *drop* that fallback —
 * blocking every same-origin script. We therefore copy the resolved
 * `default-src` sources into the synthesised `script-src` / `style-src`
 * before appending the nonce, so existing sources keep working.
 *
 * `-elem` / `-attr` variants are only injected when the user explicitly
 * set them; otherwise they fall back to `script-src` / `style-src`
 * (which now carry the nonce) per CSP3 §6.1.
 */
export function buildNonceTemplate(opts: ResolvedCspOptions): string {
  const cloned = new Map(opts.directives);
  const defaultSrc = cloned.get('default-src');
  const fallbackSources: readonly string[] = Array.isArray(defaultSrc) ? defaultSrc : [];

  for (const directive of ['script-src', 'style-src'] as const) {
    const current = cloned.get(directive);
    if (Array.isArray(current)) {
      cloned.set(directive, [...current, `'nonce-${NONCE_PLACEHOLDER}'`]);
    } else {
      // Synthesise from default-src to preserve fallback semantics.
      cloned.set(directive, [...fallbackSources, `'nonce-${NONCE_PLACEHOLDER}'`]);
    }
  }
  for (const directive of [
    'script-src-elem',
    'style-src-elem',
    'script-src-attr',
    'style-src-attr',
  ] as const) {
    const current = cloned.get(directive);
    if (Array.isArray(current)) {
      cloned.set(directive, [...current, `'nonce-${NONCE_PLACEHOLDER}'`]);
    }
  }
  return serializeCspBody({ directives: cloned });
}
