import { LIMITS, NONCE_PLACEHOLDER } from './constants';
import { HelmetError } from './interfaces';
import type { HelmetOptions, HelmetWarning, HeadersOptions, ViolationDetail } from './interfaces';
import { resolveHelmetOptions, validateHelmetOptions } from './options';
import type { Nonce, ResolvedHelmetOptions } from './types';

import { resolveCacheControl, serializeCacheControl } from './cache-control/serialize';
import { serializeClearSiteData } from './clear-site-data/serialize';
import {
  serializeCoep,
  serializeCoepReportOnly,
  serializeCoop,
  serializeCoopReportOnly,
  serializeCorp,
} from './cross-origin/serialize';
import { buildNonceTemplate, serializeCspBody } from './csp/serialize';
import { serializeDocumentPolicy } from './document-policy/serialize';
import { serializeHsts } from './hsts/serialize';
import {
  serializeIntegrityPolicy,
  serializeIntegrityPolicyReportOnly,
} from './integrity-policy/serialize';
import {
  serializePermissionsPolicy,
  serializePermissionsPolicyReportOnly,
} from './permissions-policy/serialize';
import { applyRemoveHeaders } from './remove-headers/apply';
import {
  serializeNel,
  serializeReportingEndpoints,
  serializeReportToFromEndpoints,
} from './reporting/serialize';
import {
  serializeOriginAgentCluster,
  serializeReferrerPolicy,
  serializeTimingAllowOrigin,
  serializeXContentTypeOptions,
  serializeXDnsPrefetchControl,
  serializeXDownloadOptions,
  serializeXFrameOptions,
  serializeXPermittedCrossDomainPolicies,
  serializeXRobotsTag,
  serializeXXssProtection,
} from './simple-headers/serialize';

import { HttpHeader } from '@zipbul/shared';

import type { HeaderEntry } from './simple-headers/serialize';

const NONCE_VALIDATE_RE = /^[A-Za-z0-9+/=_-]{16,256}$/;

/** Set of always-overwrite (hard security) header names — lowercase. */
const ALWAYS_OVERWRITE = new Set<string>([
  HttpHeader.ContentSecurityPolicy,
  HttpHeader.ContentSecurityPolicyReportOnly,
  HttpHeader.CrossOriginOpenerPolicy,
  HttpHeader.CrossOriginOpenerPolicyReportOnly,
  HttpHeader.CrossOriginEmbedderPolicy,
  HttpHeader.CrossOriginEmbedderPolicyReportOnly,
  HttpHeader.CrossOriginResourcePolicy,
  HttpHeader.OriginAgentCluster,
  HttpHeader.PermissionsPolicy,
  HttpHeader.PermissionsPolicyReportOnly,
  HttpHeader.ReferrerPolicy,
  HttpHeader.StrictTransportSecurity,
  HttpHeader.XContentTypeOptions,
  HttpHeader.XDnsPrefetchControl,
  HttpHeader.XFrameOptions,
  HttpHeader.XPermittedCrossDomainPolicies,
  HttpHeader.XXssProtection,
  HttpHeader.XDownloadOptions,
  HttpHeader.IntegrityPolicy,
  HttpHeader.IntegrityPolicyReportOnly,
  HttpHeader.DocumentPolicy,
  HttpHeader.DocumentPolicyReportOnly,
  HttpHeader.RequireDocumentPolicy,
  HttpHeader.DocumentIsolationPolicy,
  HttpHeader.DocumentIsolationPolicyReportOnly,
]);

interface CompiledHeaders {
  /** Pre-built static headers (no nonce). */
  readonly entries: readonly HeaderEntry[];
  /** Pre-tokenised CSP body containing nonce placeholder, or undefined when no CSP. */
  readonly cspTemplate: string | undefined;
  /** Pre-tokenised CSP-RO body containing nonce placeholder. */
  readonly cspReportOnlyTemplate: string | undefined;
}

/**
 * Framework-agnostic security headers engine.
 *
 * Use {@link Helmet.create} to build an instance from {@link HelmetOptions}.
 * Validation is batched — if anything is wrong, every issue is reported via
 * {@link HelmetError.violations} in a single throw.
 */
export class Helmet {
  private readonly resolved: ResolvedHelmetOptions;
  private readonly compiled: CompiledHeaders;
  public readonly warnings: readonly HelmetWarning[];

  private constructor(resolved: ResolvedHelmetOptions, warnings: readonly HelmetWarning[]) {
    this.resolved = resolved;
    this.warnings = Object.freeze(warnings.slice());
    this.compiled = compileHeaders(resolved);
    Object.freeze(this);
  }

  /**
   * Build a Helmet instance from {@link HelmetOptions}.
   * @throws {HelmetError} when validation fails (every violation aggregated).
   */
  public static create(options?: HelmetOptions): Helmet {
    const violations: ViolationDetail[] = [];
    const warnings: HelmetWarning[] = [];
    const resolved = resolveHelmetOptions(options, violations);
    validateHelmetOptions(resolved, violations, warnings);
    if (violations.length > 0) throw new HelmetError(violations);
    return new Helmet(resolved, warnings);
  }

  /** Generate a 16-byte base64url branded nonce (CSP3 §2.3.1). */
  public static generateNonce(bytes: number = 16): Nonce {
    const buf = new Uint8Array(bytes);
    crypto.getRandomValues(buf);
    return base64url(buf) as Nonce;
  }

  // ── Static single-header helpers (tree-shake friendly) ──────────────────────
  // Equivalent in spirit to helmet 8.x's sub-middlewares (`helmet.hsts()` etc.).
  // Each returns a single [name, value] tuple after a one-shot validate.

  public static csp(input?: HelmetOptions['contentSecurityPolicy']): HeaderEntry {
    return Helmet.create({ contentSecurityPolicy: input as never })
      .__entriesByName(HttpHeader.ContentSecurityPolicy)!;
  }

  public static hsts(input?: HelmetOptions['strictTransportSecurity']): HeaderEntry {
    return Helmet.create({ strictTransportSecurity: input as never })
      .__entriesByName(HttpHeader.StrictTransportSecurity)!;
  }

  public static permissionsPolicy(input?: HelmetOptions['permissionsPolicy']): HeaderEntry {
    const helmet = Helmet.create({ permissionsPolicy: input as never });
    const entry = helmet.__entriesByName(HttpHeader.PermissionsPolicy);
    if (entry === undefined) {
      throw new HelmetError([
        {
          reason: 'input_too_large' as never,
          path: 'permissionsPolicy',
          message: 'permissionsPolicy resolved to no header — provide at least one feature',
        },
      ]);
    }
    return entry;
  }

  public static referrerPolicy(input?: HelmetOptions['referrerPolicy']): HeaderEntry {
    return Helmet.create({ referrerPolicy: input as never })
      .__entriesByName(HttpHeader.ReferrerPolicy)!;
  }

  public static xFrameOptions(input?: HelmetOptions['xFrameOptions']): HeaderEntry {
    return Helmet.create({ xFrameOptions: input as never })
      .__entriesByName(HttpHeader.XFrameOptions)!;
  }

  public static xContentTypeOptions(): HeaderEntry {
    return Helmet.create().__entriesByName(HttpHeader.XContentTypeOptions)!;
  }

  public static crossOriginOpenerPolicy(input?: HelmetOptions['crossOriginOpenerPolicy']): HeaderEntry {
    return Helmet.create({ crossOriginOpenerPolicy: input as never })
      .__entriesByName(HttpHeader.CrossOriginOpenerPolicy)!;
  }

  public static crossOriginResourcePolicy(input?: HelmetOptions['crossOriginResourcePolicy']): HeaderEntry {
    return Helmet.create({ crossOriginResourcePolicy: input as never })
      .__entriesByName(HttpHeader.CrossOriginResourcePolicy)!;
  }

  public static crossOriginEmbedderPolicy(input?: HelmetOptions['crossOriginEmbedderPolicy']): HeaderEntry {
    const helmet = Helmet.create({ crossOriginEmbedderPolicy: input as never });
    return helmet.__entriesByName(HttpHeader.CrossOriginEmbedderPolicy)!;
  }

  public static originAgentCluster(input?: HelmetOptions['originAgentCluster']): HeaderEntry {
    return Helmet.create({ originAgentCluster: input as never })
      .__entriesByName(HttpHeader.OriginAgentCluster)!;
  }

  /** Internal lookup used by static helpers. Not part of the public API. */
  private __entriesByName(name: string): HeaderEntry | undefined {
    for (const entry of this.compiled.entries) {
      if (entry[0] === name) return entry;
    }
    if (name === HttpHeader.ContentSecurityPolicy && this.compiled.cspTemplate !== undefined) {
      return [name, this.cspBody()];
    }
    if (
      name === HttpHeader.ContentSecurityPolicyReportOnly &&
      this.compiled.cspReportOnlyTemplate !== undefined
    ) {
      return [name, this.cspReportOnlyBody()];
    }
    return undefined;
  }

  /** Get the snapshot of resolved options (deep-frozen). */
  public toJSON(): ResolvedHelmetOptions {
    return this.resolved;
  }

  /** Lowercase names of headers Helmet will emit (diagnostics). */
  public headerNames(): readonly string[] {
    const names = new Set<string>();
    for (const [name] of this.compiled.entries) names.add(name);
    if (this.compiled.cspTemplate !== undefined) names.add(HttpHeader.ContentSecurityPolicy);
    if (this.compiled.cspReportOnlyTemplate !== undefined)
      names.add(HttpHeader.ContentSecurityPolicyReportOnly);
    return Object.freeze([...names]);
  }

  /** Lowercase names of headers Helmet will remove from incoming responses. */
  public headersToRemove(): readonly string[] {
    return this.resolved.removeHeaders.headers;
  }

  /** Defensive Headers copy. Mutating the result does not affect the cache. */
  public headers(options?: HeadersOptions): Headers {
    const out = new Headers();
    for (const [name, value] of this.compiled.entries) out.append(name, value);
    if (this.compiled.cspTemplate !== undefined) {
      out.set(HttpHeader.ContentSecurityPolicy, this.cspBody(options));
    }
    if (this.compiled.cspReportOnlyTemplate !== undefined) {
      out.set(HttpHeader.ContentSecurityPolicyReportOnly, this.cspReportOnlyBody(options));
    }
    return out;
  }

  /** Plain object form — best for hot paths that push name/value pairs into a framework. */
  public headersRecord(options?: HeadersOptions): Readonly<Record<string, string>> {
    const out: Record<string, string> = Object.create(null);
    for (const [name, value] of this.compiled.entries) {
      // Multi-value safe: append later headers using comma join (only used by reporting headers).
      const existing = out[name];
      out[name] = existing === undefined ? value : `${existing}, ${value}`;
    }
    if (this.compiled.cspTemplate !== undefined) {
      out[HttpHeader.ContentSecurityPolicy] = this.cspBody(options);
    }
    if (this.compiled.cspReportOnlyTemplate !== undefined) {
      out[HttpHeader.ContentSecurityPolicyReportOnly] = this.cspReportOnlyBody(options);
    }
    return Object.freeze(out);
  }

  /** Mutate a Headers instance in place. Use only before the response head is sent. */
  public applyHeadersTo(headers: Headers, options?: HeadersOptions): void {
    for (const name of this.resolved.removeHeaders.headers) headers.delete(name);
    for (const [name, value] of this.compiled.entries) {
      if (ALWAYS_OVERWRITE.has(name) || !headers.has(name)) {
        headers.set(name, value);
      }
    }
    if (this.compiled.cspTemplate !== undefined) {
      headers.set(HttpHeader.ContentSecurityPolicy, this.cspBody(options));
    }
    if (this.compiled.cspReportOnlyTemplate !== undefined) {
      headers.set(HttpHeader.ContentSecurityPolicyReportOnly, this.cspReportOnlyBody(options));
    }
  }

  /** Build a new Response with security headers overlaid on top of `response`. */
  public apply(response: Response, options?: HeadersOptions): Response {
    if (response.bodyUsed) {
      throw new HelmetError([
        {
          reason: 'response_body_consumed' as never,
          path: 'response',
          message: 'cannot apply Helmet headers to a Response whose body has already been consumed',
        },
      ]);
    }
    if (response.type === 'error' || response.type === 'opaqueredirect') {
      throw new HelmetError([
        {
          reason: 'opaque_response_unsupported' as never,
          path: 'response',
          message: 'cannot apply Helmet headers to opaque/error Response',
        },
      ]);
    }
    const status = response.status;
    if (status === 304 || (status >= 100 && status < 200)) {
      return response;
    }
    const headers = cloneHeadersWithSetCookie(response.headers);
    applyRemoveHeaders(headers, this.resolved.removeHeaders.headers);
    for (const [name, value] of this.compiled.entries) {
      if (ALWAYS_OVERWRITE.has(name) || !headers.has(name)) {
        headers.set(name, value);
      }
    }
    if (this.compiled.cspTemplate !== undefined) {
      headers.set(HttpHeader.ContentSecurityPolicy, this.cspBody(options));
    }
    if (this.compiled.cspReportOnlyTemplate !== undefined) {
      headers.set(HttpHeader.ContentSecurityPolicyReportOnly, this.cspReportOnlyBody(options));
    }
    return new Response(response.body, {
      status,
      statusText: response.statusText,
      headers,
    });
  }

  /** Derive a child Helmet by overlaying partial options on top of this instance. */
  public derive(partial: HelmetOptions): Helmet {
    // PLAN §derive — re-validate the merged tree from scratch. We reconstruct
    // raw HelmetOptions from the resolved snapshot so the new validator sees
    // the same shape.
    const merged: HelmetOptions = {
      ...rebuildOptions(this.resolved),
      ...partial,
    };
    return Helmet.create(merged);
  }

  // ── private helpers ──

  private cspBody(options?: HeadersOptions): string {
    const tpl = this.compiled.cspTemplate;
    if (tpl === undefined) return '';
    return injectNonce(tpl, options?.nonce);
  }

  private cspReportOnlyBody(options?: HeadersOptions): string {
    const tpl = this.compiled.cspReportOnlyTemplate;
    if (tpl === undefined) return '';
    return injectNonce(tpl, options?.nonce);
  }
}

function compileHeaders(r: ResolvedHelmetOptions): CompiledHeaders {
  const entries: HeaderEntry[] = [];

  // CSP-RO body uses the same nonce template path; CSP enforces.
  let cspTemplate: string | undefined;
  let cspReportOnlyTemplate: string | undefined;

  if (r.contentSecurityPolicy !== false) {
    cspTemplate = buildNonceTemplate(r.contentSecurityPolicy);
  }
  if (r.contentSecurityPolicyReportOnly !== undefined) {
    cspReportOnlyTemplate = buildNonceTemplate(r.contentSecurityPolicyReportOnly);
  }

  if (r.crossOriginOpenerPolicy !== false) entries.push(serializeCoop(r.crossOriginOpenerPolicy));
  if (r.crossOriginOpenerPolicyReportOnly !== undefined)
    entries.push(serializeCoopReportOnly(r.crossOriginOpenerPolicyReportOnly));
  if (r.crossOriginEmbedderPolicy !== false) entries.push(serializeCoep(r.crossOriginEmbedderPolicy));
  if (r.crossOriginEmbedderPolicyReportOnly !== undefined)
    entries.push(serializeCoepReportOnly(r.crossOriginEmbedderPolicyReportOnly));
  if (r.crossOriginResourcePolicy !== false) entries.push(serializeCorp(r.crossOriginResourcePolicy));
  entries.push(serializeOriginAgentCluster(r.originAgentCluster));
  if (r.xContentTypeOptions) entries.push(serializeXContentTypeOptions());
  if (r.xFrameOptions !== false) entries.push(serializeXFrameOptions(r.xFrameOptions));
  if (r.xPermittedCrossDomainPolicies !== false)
    entries.push(serializeXPermittedCrossDomainPolicies(r.xPermittedCrossDomainPolicies));
  if (r.xDnsPrefetchControl !== false) entries.push(serializeXDnsPrefetchControl(r.xDnsPrefetchControl));
  if (r.referrerPolicy !== false) entries.push(serializeReferrerPolicy(r.referrerPolicy));
  if (r.strictTransportSecurity !== false) entries.push(serializeHsts(r.strictTransportSecurity));
  if (r.xXssProtection !== false) entries.push(serializeXXssProtection(r.xXssProtection));
  if (r.xDownloadOptions) entries.push(serializeXDownloadOptions());
  if (r.permissionsPolicy !== false) {
    const pp = serializePermissionsPolicy(r.permissionsPolicy);
    if (pp !== undefined) entries.push(pp);
  }
  if (r.permissionsPolicyReportOnly !== undefined) {
    const pp = serializePermissionsPolicyReportOnly(r.permissionsPolicyReportOnly);
    if (pp !== undefined) entries.push(pp);
  }
  if (r.documentIsolationPolicy !== undefined)
    entries.push([HttpHeader.DocumentIsolationPolicy, r.documentIsolationPolicy]);
  if (r.documentIsolationPolicyReportOnly !== undefined)
    entries.push([
      HttpHeader.DocumentIsolationPolicyReportOnly,
      r.documentIsolationPolicyReportOnly,
    ]);
  if (r.documentPolicy !== undefined) entries.push(serializeDocumentPolicy(r.documentPolicy));
  if (r.documentPolicyReportOnly !== undefined) {
    const [, value] = serializeDocumentPolicy(r.documentPolicyReportOnly);
    entries.push([HttpHeader.DocumentPolicyReportOnly, value]);
  }
  if (r.requireDocumentPolicy !== undefined) {
    const [, value] = serializeDocumentPolicy(r.requireDocumentPolicy);
    entries.push([HttpHeader.RequireDocumentPolicy, value]);
  }
  if (r.integrityPolicy !== false && r.integrityPolicy !== undefined)
    entries.push(serializeIntegrityPolicy(r.integrityPolicy));
  if (r.integrityPolicyReportOnly !== undefined)
    entries.push(serializeIntegrityPolicyReportOnly(r.integrityPolicyReportOnly));

  if (r.reportingEndpoints !== undefined && r.reportingEndpoints.endpoints.size > 0)
    entries.push(serializeReportingEndpoints(r.reportingEndpoints));
  if (r.nel !== undefined) {
    if (r.reportingEndpoints !== undefined) {
      const reportTo = serializeReportToFromEndpoints(r.reportingEndpoints, r.nel);
      if (reportTo !== undefined) entries.push(reportTo);
    }
    entries.push(serializeNel(r.nel));
  }

  if (r.cacheControl !== false && r.cacheControl !== undefined) {
    for (const e of serializeCacheControl(r.cacheControl)) entries.push(e);
  }
  if (r.xRobotsTag !== false && r.xRobotsTag !== undefined && r.xRobotsTag.directives.length > 0) {
    entries.push(serializeXRobotsTag(r.xRobotsTag.directives));
  }
  if (r.timingAllowOrigin !== undefined && r.timingAllowOrigin.length > 0) {
    entries.push(serializeTimingAllowOrigin(r.timingAllowOrigin));
  }
  if (r.clearSiteData !== false && r.clearSiteData !== undefined) {
    entries.push(serializeClearSiteData(r.clearSiteData));
  }

  return Object.freeze({
    entries: Object.freeze(entries),
    cspTemplate,
    cspReportOnlyTemplate,
  });
}

function injectNonce(template: string, nonce: string | undefined): string {
  if (nonce === undefined) {
    // Strip any nonce placeholders if no nonce is supplied — leaving the
    // placeholder in the live header would be a security failure.
    return template.replaceAll(`'nonce-${NONCE_PLACEHOLDER}'`, '').replaceAll(/  +/g, ' ').trim();
  }
  if (!NONCE_VALIDATE_RE.test(nonce) || nonce.length > LIMITS.nonceMax) {
    throw new HelmetError([
      {
        reason: 'invalid_nonce_charset' as never,
        path: 'options.nonce',
        message: 'nonce must match base64url charset and be 16-256 chars',
      },
    ]);
  }
  // PLAN §캐싱 전략: function-form replaceAll guards against $-meta cache poisoning.
  return template.replaceAll(NONCE_PLACEHOLDER, () => nonce);
}

function cloneHeadersWithSetCookie(input: Headers): Headers {
  const out = new Headers();
  // Set-Cookie can appear multiple times — Headers.getSetCookie preserves all.
  // Other headers we copy via for-of which yields combined values.
  const seenSetCookie: string[] = [];
  if (typeof input.getSetCookie === 'function') {
    seenSetCookie.push(...input.getSetCookie());
  }
  for (const [k, v] of input) {
    if (k.toLowerCase() === 'set-cookie') continue;
    out.append(k, v);
  }
  for (const v of seenSetCookie) out.append('set-cookie', v);
  return out;
}

function base64url(buf: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]!);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Re-construct a partial HelmetOptions from a resolved tree. Used by
 * derive() so the child can be re-validated end-to-end. The reconstruction
 * is loss-tolerant — only public configurable shapes are preserved, the
 * deep frozen Maps are turned back into plain objects/arrays.
 */
function rebuildOptions(r: ResolvedHelmetOptions): HelmetOptions {
  const opts: HelmetOptions = {};
  if (r.contentSecurityPolicy !== false) {
    const directives: Record<string, unknown> = {};
    for (const [k, v] of r.contentSecurityPolicy.directives) {
      directives[kebabToCamel(k)] = Array.isArray(v) ? [...v] : v;
    }
    opts.contentSecurityPolicy = { directives: directives as never };
  } else {
    opts.contentSecurityPolicy = false;
  }
  if (r.contentSecurityPolicyReportOnly !== undefined) {
    const directives: Record<string, unknown> = {};
    for (const [k, v] of r.contentSecurityPolicyReportOnly.directives) {
      directives[kebabToCamel(k)] = Array.isArray(v) ? [...v] : v;
    }
    opts.contentSecurityPolicyReportOnly = { directives: directives as never };
  }
  opts.crossOriginOpenerPolicy = r.crossOriginOpenerPolicy === false ? false : r.crossOriginOpenerPolicy;
  opts.crossOriginOpenerPolicyReportOnly = r.crossOriginOpenerPolicyReportOnly;
  opts.crossOriginEmbedderPolicy = r.crossOriginEmbedderPolicy === false ? false : r.crossOriginEmbedderPolicy;
  opts.crossOriginEmbedderPolicyReportOnly = r.crossOriginEmbedderPolicyReportOnly;
  opts.crossOriginResourcePolicy = r.crossOriginResourcePolicy === false ? false : r.crossOriginResourcePolicy;
  opts.originAgentCluster = r.originAgentCluster;
  if (r.permissionsPolicy !== false) {
    const features: Record<string, string[]> = {};
    for (const [k, v] of r.permissionsPolicy.features) features[k] = [...v];
    opts.permissionsPolicy = { features };
  } else {
    opts.permissionsPolicy = false;
  }
  if (r.permissionsPolicyReportOnly !== undefined) {
    const features: Record<string, string[]> = {};
    for (const [k, v] of r.permissionsPolicyReportOnly.features) features[k] = [...v];
    opts.permissionsPolicyReportOnly = { features };
  }
  opts.referrerPolicy = r.referrerPolicy === false ? false : [...r.referrerPolicy];
  opts.strictTransportSecurity =
    r.strictTransportSecurity === false ? false : { ...r.strictTransportSecurity };
  opts.xContentTypeOptions = r.xContentTypeOptions;
  opts.xDnsPrefetchControl = r.xDnsPrefetchControl === false ? false : r.xDnsPrefetchControl;
  opts.xFrameOptions = r.xFrameOptions === false ? false : r.xFrameOptions;
  opts.xPermittedCrossDomainPolicies =
    r.xPermittedCrossDomainPolicies === false ? false : r.xPermittedCrossDomainPolicies;
  opts.xDownloadOptions = r.xDownloadOptions;
  opts.xXssProtection = r.xXssProtection === false ? false : r.xXssProtection;
  opts.removeHeaders = { headers: [...r.removeHeaders.headers] };
  if (r.reportingEndpoints !== undefined) {
    opts.reportingEndpoints = {
      endpoints: Object.fromEntries(r.reportingEndpoints.endpoints) as Record<string, never>,
    };
  }
  if (r.integrityPolicy !== false && r.integrityPolicy !== undefined) {
    opts.integrityPolicy = {
      blockedDestinations: [...r.integrityPolicy.blockedDestinations],
      sources: [...r.integrityPolicy.sources],
      endpoints: [...r.integrityPolicy.endpoints],
    };
  }
  if (r.integrityPolicyReportOnly !== undefined) {
    opts.integrityPolicyReportOnly = {
      blockedDestinations: [...r.integrityPolicyReportOnly.blockedDestinations],
      sources: [...r.integrityPolicyReportOnly.sources],
      endpoints: [...r.integrityPolicyReportOnly.endpoints],
    };
  }
  if (r.clearSiteData !== false && r.clearSiteData !== undefined) {
    opts.clearSiteData = { directives: [...r.clearSiteData.directives] as never };
  }
  if (r.cacheControl !== false && r.cacheControl !== undefined) {
    opts.cacheControl = { ...r.cacheControl };
  }
  if (r.nel !== undefined) opts.nel = { ...r.nel };
  if (r.timingAllowOrigin !== undefined) opts.timingAllowOrigin = [...r.timingAllowOrigin];
  if (r.xRobotsTag !== false && r.xRobotsTag !== undefined) {
    opts.xRobotsTag = { directives: [...r.xRobotsTag.directives] };
  }
  if (r.documentIsolationPolicy !== undefined)
    opts.documentIsolationPolicy = r.documentIsolationPolicy;
  if (r.documentIsolationPolicyReportOnly !== undefined)
    opts.documentIsolationPolicyReportOnly = r.documentIsolationPolicyReportOnly;
  return opts;
}

function kebabToCamel(name: string): string {
  return name.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
}

// Re-exported for convenience by integration tests.
export { resolveCacheControl };
