import { HttpHeader } from '@zipbul/shared';

import { LIMITS, NONCE_PLACEHOLDER } from '../constants';
import { checkReservedKey } from '../internal/reserved-key-guard';
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
    validateCspDirective(name, value, path, out, warnings, knownEndpoints);
  }
  semanticWarnings(resolved, path, warnings);
  return out;
}

/** Dispatch a single directive to its specialised validator. */
function validateCspDirective(
  name: string,
  value: ResolvedCspValue,
  path: string,
  out: ViolationDetail[],
  warnings: HelmetWarning[],
  knownEndpoints: ReadonlySet<string>,
): void {
  const localPath = `${path}.directives.${name}`;
  if (!checkReservedKey(name, localPath, out)) return;
  if (DEPRECATED_DIRECTIVES.has(name)) {
    out.push({
      reason: HelmetErrorReason.DeprecatedCspDirective,
      path: localPath,
      message: `CSP directive "${name}" is deprecated/removed`,
    });
    return;
  }

  switch (name) {
    case 'sandbox':
      validateSandbox(value, localPath, out);
      return;
    case 'webrtc':
      validateWebrtc(value, localPath, out);
      return;
    case 'upgrade-insecure-requests':
      validateUpgradeInsecureRequests(value, localPath, out);
      return;
    case 'report-to':
      validateReportTo(value, localPath, out, knownEndpoints);
      return;
    case 'report-uri':
      validateReportUri(value, localPath, out);
      return;
    case 'require-trusted-types-for':
      validateRequireTt(value, localPath, out);
      return;
    case 'trusted-types':
      validateTrustedTypes(value, localPath, out, warnings);
      return;
    default:
      validateSourceListDirective(name, value, localPath, out);
  }
}

type ResolvedCspValue = readonly string[] | string | boolean;

function validateWebrtc(value: ResolvedCspValue, path: string, out: ViolationDetail[]): void {
  if (value !== 'allow' && value !== 'block') {
    out.push({
      reason: HelmetErrorReason.InvalidWebRtcDirective,
      path,
      message: "webrtc must be 'allow' or 'block'",
    });
  }
}

function validateUpgradeInsecureRequests(
  value: ResolvedCspValue,
  path: string,
  out: ViolationDetail[],
): void {
  if (typeof value !== 'boolean') {
    out.push({
      reason: HelmetErrorReason.InvalidCspKeyword,
      path,
      message: 'upgrade-insecure-requests must be boolean',
    });
  }
}

function validateReportTo(
  value: ResolvedCspValue,
  path: string,
  out: ViolationDetail[],
  knownEndpoints: ReadonlySet<string>,
): void {
  if (typeof value !== 'string' || !REPORT_TO_NAME_RE.test(value)) {
    out.push({
      reason: HelmetErrorReason.InvalidReportToGroupName,
      path,
      message: 'report-to value must match [A-Za-z0-9_-]+',
    });
  } else if (!knownEndpoints.has(value)) {
    out.push({
      reason: HelmetErrorReason.UnknownReportingEndpoint,
      path,
      message: 'report-to references undefined Reporting-Endpoints name',
    });
  }
}

function validateReportUri(value: ResolvedCspValue, path: string, out: ViolationDetail[]): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    out.push({
      reason: HelmetErrorReason.InvalidReportUri,
      path,
      message: 'report-uri must be a non-empty string',
    });
  } else if (value.length > LIMITS.hostSourceLength) {
    out.push({
      reason: HelmetErrorReason.InputTooLarge,
      path,
      message: `report-uri exceeds ${LIMITS.hostSourceLength} chars`,
    });
  } else if (REPORT_URI_FORBIDDEN_RE.test(value)) {
    out.push({
      reason: HelmetErrorReason.ControlCharRejected,
      path,
      message: 'report-uri contains forbidden whitespace or control characters',
    });
  }
}

function validateSourceListDirective(
  name: string,
  value: ResolvedCspValue,
  path: string,
  out: ViolationDetail[],
): void {
  if (!Array.isArray(value)) {
    out.push({
      reason: HelmetErrorReason.InvalidCspKeyword,
      path,
      message: 'expected an array of CSP sources',
    });
    return;
  }
  const camel = toCamel(name) as keyof CspDirectives;
  if (FETCH_DIRECTIVES.has(camel) && value.length === 0) {
    out.push({
      reason: HelmetErrorReason.EmptyFetchDirective,
      path,
      message: `${name} must have at least one source — use ['none'] explicitly`,
    });
    return;
  }
  if (value.length > LIMITS.cspSourcesPerDirective) {
    out.push({
      reason: HelmetErrorReason.InputTooLarge,
      path,
      message: `too many sources (${value.length} > ${LIMITS.cspSourcesPerDirective})`,
    });
  }
  for (let i = 0; i < value.length; i++) {
    const v = value[i] ?? '';
    const itemPath = `${path}[${i}]`;
    validateCspSource(v, itemPath, out);
    if (name === 'frame-ancestors') validateFrameAncestorsSource(v, itemPath, out);
  }
  if (NON_FETCH_LIST_DIRECTIVES.has(camel) && value.length === 0) {
    out.push({
      reason: HelmetErrorReason.EmptyFetchDirective,
      path,
      message: `${name} must have at least one source`,
    });
  }
}

function validateFrameAncestorsSource(
  source: string,
  path: string,
  out: ViolationDetail[],
): void {
  if (FRAME_ANCESTORS_FORBIDDEN.has(source)) {
    out.push({
      reason: HelmetErrorReason.InvalidFrameAncestorsKeyword,
      path,
      message: `frame-ancestors does not allow ${source} (CSP3 §6.4.2)`,
    });
  } else if (isNonceOrHashSource(source)) {
    out.push({
      reason: HelmetErrorReason.InvalidFrameAncestorsKeyword,
      path,
      message:
        'frame-ancestors does not allow nonce or hash sources (CSP3 §6.4.2 — only host/scheme/self/none)',
    });
  }
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
