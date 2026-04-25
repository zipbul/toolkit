import { Csp } from './constants';
import { Helmet } from './helmet';
import type { HelmetOptions } from './interfaces';

/**
 * Strict CSP preset — `strict-dynamic` script policy + Trusted Types +
 * HSTS preload eligibility.
 */
function strict(): Helmet {
  return Helmet.create({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: [Csp.None],
        scriptSrc: [Csp.StrictDynamic, "'unsafe-inline'", 'https:'],
        styleSrc: [Csp.Self, "'unsafe-inline'"],
        imgSrc: [Csp.Self, 'data:'],
        connectSrc: [Csp.Self],
        baseUri: [Csp.Self],
        formAction: [Csp.Self],
        frameAncestors: [Csp.None],
        objectSrc: [Csp.None],
        manifestSrc: [Csp.Self],
        upgradeInsecureRequests: true,
        requireTrustedTypesFor: ["'script'"],
      },
    },
    strictTransportSecurity: { maxAge: 63072000, includeSubDomains: true, preload: true },
    crossOriginOpenerPolicy: 'same-origin',
    crossOriginEmbedderPolicy: 'require-corp',
    crossOriginResourcePolicy: 'same-origin',
  });
}

/** API-only — `default-src 'none'` + `Cache-Control: no-store`. */
function api(): Helmet {
  return Helmet.create({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: [Csp.None],
        frameAncestors: [Csp.None],
        baseUri: [Csp.None],
        formAction: [Csp.None],
      },
    },
    cacheControl: true,
    crossOriginResourcePolicy: 'same-origin',
    crossOriginOpenerPolicy: 'same-origin',
  });
}

/** SPA — hash-friendly defaults that play nicely with bundlers. */
function spa(): Helmet {
  return Helmet.create({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: [Csp.Self],
        imgSrc: [Csp.Self, 'data:', 'blob:'],
        styleSrc: [Csp.Self, "'unsafe-inline'"],
        scriptSrc: [Csp.Self],
        connectSrc: [Csp.Self],
      },
    },
  });
}

/** Mozilla Observatory v2 A+ targets. */
function observatoryAPlus(): Helmet {
  return Helmet.create({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: [Csp.None],
        scriptSrc: [Csp.Self],
        styleSrc: [Csp.Self],
        imgSrc: [Csp.Self],
        connectSrc: [Csp.Self],
        baseUri: [Csp.Self],
        formAction: [Csp.Self],
        frameAncestors: [Csp.None],
        objectSrc: [Csp.None],
        manifestSrc: [Csp.Self],
        upgradeInsecureRequests: true,
      },
    },
    strictTransportSecurity: { maxAge: 63072000, includeSubDomains: true, preload: true },
    crossOriginOpenerPolicy: 'same-origin',
    crossOriginEmbedderPolicy: 'require-corp',
    crossOriginResourcePolicy: 'same-origin',
    integrityPolicy: true,
  });
}

/** AMP-compatible CSP. */
function amp(): Helmet {
  return Helmet.create({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: [Csp.Self],
        scriptSrc: [Csp.Self, 'https://cdn.ampproject.org'],
        styleSrc: [Csp.Self, "'unsafe-inline'"],
        imgSrc: [Csp.Self, 'data:', 'https:'],
      },
    },
  });
}

/** OAuth/OIDC popup-flow compatible. */
function oauth(): Helmet {
  return Helmet.create({
    crossOriginOpenerPolicy: 'same-origin-allow-popups',
    referrerPolicy: 'strict-origin-when-cross-origin',
  });
}

/** KISA / ISMS-P 2.10.6 compatible. */
function kisa(): Helmet {
  return Helmet.create({
    xXssProtection: '1; mode=block',
    cacheControl: { value: 'no-store, max-age=0', pragma: true, expires: true },
    strictTransportSecurity: { maxAge: 63072000, includeSubDomains: true, preload: true },
  });
}

/** ACSC ISM-1788 — strict-origin-when-cross-origin Referrer-Policy. */
function acsc(): Helmet {
  return Helmet.create({ referrerPolicy: 'strict-origin-when-cross-origin' });
}

/** BSI TR-03161 — Cache-Control no-store enforced. */
function bsi(): Helmet {
  return Helmet.create({
    cacheControl: { value: 'no-store, max-age=0', pragma: true, expires: true },
  });
}

/** NCSC monitoring-first — CSP-Report-Only + Reporting-Endpoints. */
function ncsc(): Helmet {
  return Helmet.create({
    contentSecurityPolicyReportOnly: {
      directives: {
        defaultSrc: [Csp.Self],
        reportTo: 'csp-endpoint',
      },
    },
    reportingEndpoints: { endpoints: { 'csp-endpoint': 'https://example.invalid/csp' as never } },
  });
}

/** IPA "安全なウェブサイトの作り方" 第7版 — uppercase XFO. */
function ipa(): Helmet {
  return Helmet.create({ xFrameOptions: 'DENY' });
}

export const presets = {
  strict,
  api,
  spa,
  observatoryAPlus,
  amp,
  oauth,
  kisa,
  acsc,
  bsi,
  ncsc,
  ipa,
} as const;

export type PresetName = keyof typeof presets;

// Stub forwarders for type completeness — exported with the Helmet class via index.
export type { HelmetOptions };
