import { LIMITS } from './constants';
import { HelmetErrorReason } from './enums';
import type { HelmetOptions, HelmetWarning, ViolationDetail } from './interfaces';
import type {
  CoepValue,
  CoopValue,
  CorpValue,
  ReferrerPolicyToken,
  ResolvedHelmetOptions,
  XFrameOptionsValue,
} from './types';

import { resolveCacheControl } from './cache-control/serialize';
import { resolveClearSiteData, validateClearSiteData } from './clear-site-data/serialize';
import { resolveCsp, validateCsp } from './csp/serialize';
import { resolveDocumentPolicy } from './document-policy/serialize';
import { resolveHsts, validateHsts } from './hsts/serialize';
import { resolveIntegrityPolicy, validateIntegrityPolicy } from './integrity-policy/serialize';
import {
  resolvePermissionsPolicy,
  validatePermissionsPolicy,
} from './permissions-policy/serialize';
import { resolveRemoveHeaders } from './remove-headers/resolve';
import { resolveNel, resolveReportingEndpoints } from './reporting/serialize';
import { validateReferrerPolicy } from './referrer-policy/validate';
import { validateTimingAllowOrigin } from './timing-allow-origin/validate';
import { validateXDnsPrefetchControl } from './x-dns-prefetch-control/validate';
import { validateXFrameOptions } from './x-frame-options/validate';
import { validateXPermittedCrossDomainPolicies } from './x-permitted-cross-domain-policies/validate';
import { validateXRobotsTag } from './x-robots-tag/validate';
import { validateXXssProtection } from './x-xss-protection/validate';

const VALID_COOP = new Set<CoopValue>([
  'same-origin',
  'same-origin-allow-popups',
  'noopener-allow-popups',
  'unsafe-none',
]);
const VALID_CORP = new Set<CorpValue>(['same-origin', 'same-site', 'cross-origin']);
const VALID_COEP = new Set<CoepValue>(['require-corp', 'credentialless', 'unsafe-none']);
const VALID_DOC_ISO = new Set([
  'isolate-and-require-corp',
  'isolate-and-credentialless',
  'none',
]);

/** Convert a partial HelmetOptions into a fully populated, frozen tree. */
export function resolveHelmetOptions(
  options: HelmetOptions | undefined,
  violations: ViolationDetail[],
): ResolvedHelmetOptions {
  const opts = options ?? {};

  const reportingEndpoints = resolveReportingEndpoints(
    opts.reportingEndpoints,
    'reportingEndpoints',
    violations,
  );
  const knownEndpoints = new Set<string>(
    reportingEndpoints ? [...reportingEndpoints.endpoints.keys()] : [],
  );

  const referrerPolicy: readonly ReferrerPolicyToken[] | false = (() => {
    if (opts.referrerPolicy === false) return false;
    if (opts.referrerPolicy === undefined || opts.referrerPolicy === true) {
      return Object.freeze(['no-referrer'] as ReferrerPolicyToken[]);
    }
    if (Array.isArray(opts.referrerPolicy)) {
      return Object.freeze(opts.referrerPolicy.slice());
    }
    return Object.freeze([opts.referrerPolicy]);
  })();

  return Object.freeze({
    contentSecurityPolicy: resolveCsp(opts.contentSecurityPolicy, 'default-on') ?? false,
    contentSecurityPolicyReportOnly: opts.contentSecurityPolicyReportOnly
      ? (resolveCsp(opts.contentSecurityPolicyReportOnly, 'report-only') as Exclude<
          ReturnType<typeof resolveCsp>,
          false | undefined
        >)
      : undefined,
    crossOriginOpenerPolicy: ((): ResolvedHelmetOptions['crossOriginOpenerPolicy'] => {
      const v = opts.crossOriginOpenerPolicy;
      if (v === false) return false;
      if (v === undefined || v === true) return { value: 'same-origin' };
      if (typeof v === 'string') return { value: v };
      // Object form { value, reportTo }
      return v.reportTo !== undefined
        ? { value: v.value, reportTo: v.reportTo }
        : { value: v.value };
    })(),
    crossOriginOpenerPolicyReportOnly: ((): ResolvedHelmetOptions['crossOriginOpenerPolicyReportOnly'] => {
      const v = opts.crossOriginOpenerPolicyReportOnly;
      if (v === undefined) return undefined;
      if (typeof v === 'string') return { value: v };
      return v.reportTo !== undefined
        ? { value: v.value, reportTo: v.reportTo }
        : { value: v.value };
    })(),
    crossOriginEmbedderPolicy: ((): ResolvedHelmetOptions['crossOriginEmbedderPolicy'] => {
      const v = opts.crossOriginEmbedderPolicy;
      if (v === undefined || v === false) return false;
      if (v === true) return { value: 'require-corp' };
      if (typeof v === 'string') return { value: v };
      return v.reportTo !== undefined
        ? { value: v.value, reportTo: v.reportTo }
        : { value: v.value };
    })(),
    crossOriginEmbedderPolicyReportOnly: ((): ResolvedHelmetOptions['crossOriginEmbedderPolicyReportOnly'] => {
      const v = opts.crossOriginEmbedderPolicyReportOnly;
      if (v === undefined) return undefined;
      if (typeof v === 'string') return { value: v };
      return v.reportTo !== undefined
        ? { value: v.value, reportTo: v.reportTo }
        : { value: v.value };
    })(),
    crossOriginResourcePolicy:
      opts.crossOriginResourcePolicy === false
        ? false
        : opts.crossOriginResourcePolicy === undefined || opts.crossOriginResourcePolicy === true
          ? 'same-origin'
          : opts.crossOriginResourcePolicy,
    originAgentCluster: opts.originAgentCluster !== false,
    permissionsPolicy: resolvePermissionsPolicy(opts.permissionsPolicy),
    permissionsPolicyReportOnly: opts.permissionsPolicyReportOnly
      ? (resolvePermissionsPolicy(opts.permissionsPolicyReportOnly) as Exclude<
          ReturnType<typeof resolvePermissionsPolicy>,
          false
        >)
      : undefined,
    referrerPolicy,
    strictTransportSecurity: resolveHsts(opts.strictTransportSecurity),
    xContentTypeOptions: opts.xContentTypeOptions !== false,
    xDnsPrefetchControl:
      opts.xDnsPrefetchControl === false
        ? false
        : opts.xDnsPrefetchControl === undefined || opts.xDnsPrefetchControl === true
          ? 'off'
          : opts.xDnsPrefetchControl,
    xFrameOptions:
      opts.xFrameOptions === false
        ? false
        : opts.xFrameOptions === undefined || opts.xFrameOptions === true
          ? 'deny'
          : (opts.xFrameOptions as XFrameOptionsValue),
    xPermittedCrossDomainPolicies:
      opts.xPermittedCrossDomainPolicies === false
        ? false
        : opts.xPermittedCrossDomainPolicies === undefined ||
            opts.xPermittedCrossDomainPolicies === true
          ? 'none'
          : opts.xPermittedCrossDomainPolicies,
    reportingEndpoints,
    integrityPolicy: resolveIntegrityPolicy(opts.integrityPolicy),
    integrityPolicyReportOnly: opts.integrityPolicyReportOnly
      ? (resolveIntegrityPolicy(opts.integrityPolicyReportOnly) as Exclude<
          ReturnType<typeof resolveIntegrityPolicy>,
          false | undefined
        >)
      : undefined,
    clearSiteData: resolveClearSiteData(opts.clearSiteData),
    cacheControl: resolveCacheControl(opts.cacheControl),
    nel: resolveNel(opts.nel, 'nel', violations, knownEndpoints),
    documentPolicy: resolveDocumentPolicy(opts.documentPolicy, 'documentPolicy', violations),
    documentPolicyReportOnly: resolveDocumentPolicy(
      opts.documentPolicyReportOnly,
      'documentPolicyReportOnly',
      violations,
    ),
    requireDocumentPolicy: resolveDocumentPolicy(
      opts.requireDocumentPolicy,
      'requireDocumentPolicy',
      violations,
    ),
    documentIsolationPolicy: opts.documentIsolationPolicy,
    documentIsolationPolicyReportOnly: opts.documentIsolationPolicyReportOnly,
    timingAllowOrigin:
      opts.timingAllowOrigin === undefined
        ? undefined
        : Object.freeze(
            Array.isArray(opts.timingAllowOrigin)
              ? opts.timingAllowOrigin.slice()
              : [opts.timingAllowOrigin],
          ),
    xRobotsTag:
      opts.xRobotsTag === undefined
        ? undefined
        : opts.xRobotsTag === false
          ? false
          : opts.xRobotsTag === true
            ? Object.freeze({ directives: Object.freeze(['noindex', 'nofollow']) })
            : Object.freeze({ directives: Object.freeze((opts.xRobotsTag.directives ?? []).slice()) }),
    xDownloadOptions: opts.xDownloadOptions === true,
    xXssProtection:
      opts.xXssProtection === undefined || opts.xXssProtection === false
        ? false
        : opts.xXssProtection === true
          ? '0'
          : opts.xXssProtection,
    removeHeaders: resolveRemoveHeaders(opts.removeHeaders),
  });
}

/**
 * Run all module validators against the resolved tree.
 * Pushes violations and warnings (non-fatal) into the supplied lists.
 */
export function validateHelmetOptions(
  resolved: ResolvedHelmetOptions,
  violations: ViolationDetail[],
  warnings: HelmetWarning[],
): void {
  const knownEndpoints = new Set<string>(
    resolved.reportingEndpoints ? [...resolved.reportingEndpoints.endpoints.keys()] : [],
  );

  if (resolved.contentSecurityPolicy !== false) {
    violations.push(
      ...validateCsp(resolved.contentSecurityPolicy, 'contentSecurityPolicy', warnings, knownEndpoints),
    );
  }
  if (resolved.contentSecurityPolicyReportOnly) {
    violations.push(
      ...validateCsp(
        resolved.contentSecurityPolicyReportOnly,
        'contentSecurityPolicyReportOnly',
        warnings,
        knownEndpoints,
      ),
    );
  }

  validateCoopOrCoep(
    resolved.crossOriginOpenerPolicy,
    'crossOriginOpenerPolicy',
    VALID_COOP,
    knownEndpoints,
    violations,
  );
  validateCoopOrCoep(
    resolved.crossOriginOpenerPolicyReportOnly,
    'crossOriginOpenerPolicyReportOnly',
    VALID_COOP,
    knownEndpoints,
    violations,
  );
  if (resolved.crossOriginResourcePolicy !== false && !VALID_CORP.has(resolved.crossOriginResourcePolicy)) {
    violations.push({
      reason: HelmetErrorReason.InvalidCspKeyword,
      path: 'crossOriginResourcePolicy',
      message: 'invalid Cross-Origin-Resource-Policy value',
    });
  }
  validateCoopOrCoep(
    resolved.crossOriginEmbedderPolicy,
    'crossOriginEmbedderPolicy',
    VALID_COEP,
    knownEndpoints,
    violations,
  );
  validateCoopOrCoep(
    resolved.crossOriginEmbedderPolicyReportOnly,
    'crossOriginEmbedderPolicyReportOnly',
    VALID_COEP,
    knownEndpoints,
    violations,
  );

  if (resolved.documentIsolationPolicy !== undefined && !VALID_DOC_ISO.has(resolved.documentIsolationPolicy)) {
    violations.push({
      reason: HelmetErrorReason.InvalidCspKeyword,
      path: 'documentIsolationPolicy',
      message: 'invalid Document-Isolation-Policy value',
    });
  }

  if (resolved.permissionsPolicy !== false) {
    violations.push(...validatePermissionsPolicy(resolved.permissionsPolicy, 'permissionsPolicy', warnings));
  }
  if (resolved.permissionsPolicyReportOnly) {
    violations.push(
      ...validatePermissionsPolicy(
        resolved.permissionsPolicyReportOnly,
        'permissionsPolicyReportOnly',
        warnings,
      ),
    );
  }
  if (resolved.referrerPolicy !== false) {
    violations.push(...validateReferrerPolicy(resolved.referrerPolicy, 'referrerPolicy'));
  }
  if (resolved.strictTransportSecurity !== false) {
    violations.push(...validateHsts(resolved.strictTransportSecurity, 'strictTransportSecurity'));
  }
  if (resolved.xFrameOptions !== false) {
    violations.push(...validateXFrameOptions(resolved.xFrameOptions, 'xFrameOptions'));
  }
  if (resolved.xDnsPrefetchControl !== false) {
    violations.push(
      ...validateXDnsPrefetchControl(resolved.xDnsPrefetchControl, 'xDnsPrefetchControl'),
    );
  }
  if (resolved.xPermittedCrossDomainPolicies !== false) {
    violations.push(
      ...validateXPermittedCrossDomainPolicies(
        resolved.xPermittedCrossDomainPolicies,
        'xPermittedCrossDomainPolicies',
      ),
    );
  }
  if (resolved.xXssProtection !== false) {
    violations.push(...validateXXssProtection(resolved.xXssProtection, 'xXssProtection'));
  }
  if (resolved.timingAllowOrigin !== undefined) {
    violations.push(...validateTimingAllowOrigin(resolved.timingAllowOrigin, 'timingAllowOrigin'));
  }
  if (resolved.xRobotsTag !== false && resolved.xRobotsTag !== undefined) {
    violations.push(
      ...validateXRobotsTag(resolved.xRobotsTag.directives, 'xRobotsTag.directives'),
    );
  }

  if (resolved.integrityPolicy !== false && resolved.integrityPolicy !== undefined) {
    violations.push(
      ...validateIntegrityPolicy(resolved.integrityPolicy, 'integrityPolicy', knownEndpoints),
    );
  }
  if (resolved.integrityPolicyReportOnly) {
    violations.push(
      ...validateIntegrityPolicy(
        resolved.integrityPolicyReportOnly,
        'integrityPolicyReportOnly',
        knownEndpoints,
      ),
    );
  }
  if (resolved.clearSiteData !== false && resolved.clearSiteData !== undefined) {
    violations.push(...validateClearSiteData(resolved.clearSiteData, 'clearSiteData', warnings));
  }

  // Cap violations at LIMITS.violations with sentinel.
  if (violations.length > LIMITS.violations) {
    const overflow = violations.length - LIMITS.violations + 1;
    violations.length = LIMITS.violations - 1;
    violations.push({
      reason: HelmetErrorReason.TooManyViolations,
      path: '$',
      message: `truncated at ${LIMITS.violations}; ${overflow} more suppressed`,
    });
  }
}

/**
 * Validate the resolved object form of `Cross-Origin-Opener-Policy` /
 * `Cross-Origin-Embedder-Policy` (HTML §7.1.3.1 / §7.1.4.1).
 *
 * The HTML spec allows `report-to="<endpoint-name>"` as an attached parameter.
 * The endpoint name MUST be declared via `Reporting-Endpoints`; an undefined
 * name is silently dropped by browsers, which would mask reports — so we fail
 * loudly at validation time (mirrors CSP `report-to` cross-reference).
 */
function validateCoopOrCoep<V extends string>(
  policy: { value: V; reportTo?: string } | false | undefined,
  path: string,
  validValues: ReadonlySet<V>,
  knownEndpoints: ReadonlySet<string>,
  out: ViolationDetail[],
): void {
  if (policy === false || policy === undefined) return;
  if (!validValues.has(policy.value)) {
    out.push({
      reason: HelmetErrorReason.InvalidCspKeyword,
      path: `${path}.value`,
      message: `invalid policy value "${policy.value}"`,
    });
  }
  if (policy.reportTo !== undefined) {
    if (!REPORTING_ENDPOINT_NAME_RE.test(policy.reportTo)) {
      out.push({
        reason: HelmetErrorReason.InvalidReportingEndpointName,
        path: `${path}.reportTo`,
        message: 'report-to value must match [A-Za-z0-9_-]{1,64}',
      });
    } else if (!knownEndpoints.has(policy.reportTo)) {
      out.push({
        reason: HelmetErrorReason.UnknownReportingEndpoint,
        path: `${path}.reportTo`,
        message: `${path}.reportTo references undefined Reporting-Endpoints name`,
      });
    }
  }
}

const REPORTING_ENDPOINT_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;
