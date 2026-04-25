import { HelmetWarningReason } from './enums';
import { Helmet } from './helmet';
import type { HelmetOptions, HelmetWarning } from './interfaces';

/**
 * Map an `helmet` (helmet.js) v8/v9 options object to {@link HelmetOptions}
 * and call {@link Helmet.create}. Migration-time decisions surface as
 * warnings on the returned instance.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function fromHelmetOptions(legacy: Record<string, any> | undefined): Helmet {
  const opts: HelmetOptions = {};
  const warnings: HelmetWarning[] = [];
  if (legacy === undefined) return Helmet.create(opts);

  // ── direct mappings ──
  if ('contentSecurityPolicy' in legacy) {
    const csp = legacy.contentSecurityPolicy;
    if (csp === false) opts.contentSecurityPolicy = false;
    else if (csp && typeof csp === 'object') {
      if (csp.useDefaults === false) {
        warnings.push({
          reason: HelmetWarningReason.HelmetUseDefaultsIgnored,
          path: 'contentSecurityPolicy.useDefaults',
          message: 'helmet useDefaults:false is ignored — OWASP defaults are always merged',
        });
      }
      if (csp.reportOnly === true) {
        opts.contentSecurityPolicyReportOnly = { directives: csp.directives };
        warnings.push({
          reason: HelmetWarningReason.HelmetReportOnlyLifted,
          path: 'contentSecurityPolicy.reportOnly',
          message: 'reportOnly:true → top-level contentSecurityPolicyReportOnly',
        });
      } else {
        opts.contentSecurityPolicy = { directives: csp.directives };
      }
    }
  }
  for (const key of [
    'crossOriginEmbedderPolicy',
    'crossOriginOpenerPolicy',
    'crossOriginResourcePolicy',
    'referrerPolicy',
  ] as const) {
    if (key in legacy) {
      const v = legacy[key];
      if (v && typeof v === 'object') {
        (opts as Record<string, unknown>)[key] = v.policy;
      } else {
        (opts as Record<string, unknown>)[key] = v;
      }
    }
  }
  if ('originAgentCluster' in legacy) opts.originAgentCluster = !!legacy.originAgentCluster;
  if ('removeHeaders' in legacy) opts.removeHeaders = legacy.removeHeaders;
  if ('strictTransportSecurity' in legacy) opts.strictTransportSecurity = legacy.strictTransportSecurity;
  if ('xContentTypeOptions' in legacy) opts.xContentTypeOptions = !!legacy.xContentTypeOptions;
  if ('xDnsPrefetchControl' in legacy) {
    const v = legacy.xDnsPrefetchControl;
    if (v && typeof v === 'object') opts.xDnsPrefetchControl = v.allow ? 'on' : 'off';
    else opts.xDnsPrefetchControl = v;
  }
  if ('xDownloadOptions' in legacy) opts.xDownloadOptions = !!legacy.xDownloadOptions;
  if ('xFrameOptions' in legacy) {
    const v = legacy.xFrameOptions;
    if (v && typeof v === 'object') opts.xFrameOptions = v.action;
    else opts.xFrameOptions = v;
  } else if (!('frameguard' in legacy) && legacy.xFrameOptions === undefined) {
    warnings.push({
      reason: HelmetWarningReason.HelmetXFrameOptionsDefaultTightened,
      path: 'xFrameOptions',
      message: 'helmet default SAMEORIGIN tightened to deny in @zipbul/helmet',
    });
  }
  if ('xPermittedCrossDomainPolicies' in legacy) {
    const v = legacy.xPermittedCrossDomainPolicies;
    opts.xPermittedCrossDomainPolicies =
      v && typeof v === 'object' ? v.permittedPolicies : v;
  }
  if ('xXssProtection' in legacy) {
    if (legacy.xXssProtection === true) {
      opts.xXssProtection = '0';
      warnings.push({
        reason: HelmetWarningReason.HelmetXssFilterHarmful,
        path: 'xXssProtection',
        message: 'helmet xssFilter:true (pre-v4 Auditor) is harmful — emitting "0" instead',
      });
    } else {
      opts.xXssProtection = legacy.xXssProtection;
    }
  }

  // ── alias renames ──
  const aliasMap: Record<string, keyof HelmetOptions> = {
    hsts: 'strictTransportSecurity',
    noSniff: 'xContentTypeOptions',
    dnsPrefetchControl: 'xDnsPrefetchControl',
    ieNoOpen: 'xDownloadOptions',
    frameguard: 'xFrameOptions',
    permittedCrossDomainPolicies: 'xPermittedCrossDomainPolicies',
    xssFilter: 'xXssProtection',
  };
  for (const [alias, canonical] of Object.entries(aliasMap)) {
    if (alias in legacy) {
      if (canonical in opts) {
        warnings.push({
          reason: HelmetWarningReason.HelmetAliasRedundant,
          path: alias,
          message: `${alias} ignored — canonical ${canonical} already supplied`,
        });
        continue;
      }
      const v = legacy[alias];
      if (canonical === 'xFrameOptions' && v && typeof v === 'object') {
        opts.xFrameOptions = v.action;
      } else if (canonical === 'xDnsPrefetchControl' && v && typeof v === 'object') {
        opts.xDnsPrefetchControl = v.allow ? 'on' : 'off';
      } else if (canonical === 'xPermittedCrossDomainPolicies' && v && typeof v === 'object') {
        opts.xPermittedCrossDomainPolicies = v.permittedPolicies;
      } else {
        (opts as Record<string, unknown>)[canonical] = v;
      }
    }
  }

  // ── Semantic remap: hidePoweredBy / xPoweredBy ──
  const wantsRemove =
    legacy.xPoweredBy === false || legacy.hidePoweredBy === true;
  if (wantsRemove) {
    const removeOpt = opts.removeHeaders;
    if (removeOpt === false) {
      // Conflict: legacy intent overrides the explicit removeHeaders:false.
      opts.removeHeaders = { headers: ['X-Powered-By'] };
      warnings.push({
        reason: HelmetWarningReason.RemoveHeadersForcedByLegacy,
        path: 'removeHeaders',
        message:
          'removeHeaders:false was overridden because legacy xPoweredBy:false specified explicit X-Powered-By removal intent',
      });
    } else if (removeOpt === undefined || removeOpt === true) {
      // default already includes X-Powered-By
    } else if (typeof removeOpt === 'object') {
      const list = removeOpt.headers ?? [];
      if (!list.some(h => h.toLowerCase() === 'x-powered-by')) {
        opts.removeHeaders = { ...removeOpt, headers: [...list, 'X-Powered-By'] };
      }
    }
  }

  const helmet = Helmet.create(opts);
  // Append migration warnings to the instance — wrap because warnings is frozen.
  const merged = Object.freeze([...helmet.warnings, ...warnings]);
  return Object.assign(Object.create(Object.getPrototypeOf(helmet)), helmet, {
    warnings: merged,
  }) as Helmet;
}
