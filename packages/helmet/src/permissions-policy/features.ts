import type { PermissionsPolicyFeature } from '../types';

/**
 * Standardized features per W3C Permissions Policy registry §"Standardized Features".
 * Source: https://github.com/w3c/webappsec-permissions-policy/blob/main/features.md
 */
export const STANDARDIZED: ReadonlySet<PermissionsPolicyFeature> = new Set<PermissionsPolicyFeature>([
  'accelerometer',
  'ambient-light-sensor',
  'attribution-reporting',
  'autoplay',
  'battery',
  'bluetooth',
  'camera',
  'ch-ua',
  'ch-ua-arch',
  'ch-ua-bitness',
  'ch-ua-full-version',
  'ch-ua-full-version-list',
  'ch-ua-high-entropy-values',
  'ch-ua-mobile',
  'ch-ua-model',
  'ch-ua-platform',
  'ch-ua-platform-version',
  'ch-ua-wow64',
  'compute-pressure',
  'cross-origin-isolated',
  'direct-sockets',
  'display-capture',
  'encrypted-media',
  'execution-while-not-rendered',
  'execution-while-out-of-viewport',
  'fullscreen',
  'geolocation',
  'gyroscope',
  'hid',
  'identity-credentials-get',
  'idle-detection',
  'keyboard-map',
  'magnetometer',
  'mediasession',
  'microphone',
  'midi',
  'navigation-override',
  'otp-credentials',
  'payment',
  'picture-in-picture',
  'publickey-credentials-get',
  'screen-wake-lock',
  'serial',
  'storage-access',
  'sync-xhr',
  'usb',
  'web-share',
  'window-management',
  'xr-spatial-tracking',
]);

/** Proposed features per W3C registry §"Proposed Features". */
export const PROPOSED: ReadonlySet<PermissionsPolicyFeature> = new Set<PermissionsPolicyFeature>([
  'autofill',
  'clipboard-read',
  'clipboard-write',
  'deferred-fetch',
  'gamepad',
  'language-detector',
  'language-model',
  'manual-text',
  'rewriter',
  'speaker-selection',
  'summarizer',
  'translator',
  'writer',
]);

/** Experimental features per W3C registry §"Experimental Features". */
export const EXPERIMENTAL: ReadonlySet<PermissionsPolicyFeature> = new Set<PermissionsPolicyFeature>([
  'all-screens-capture',
  'browsing-topics',
  'captured-surface-control',
  'conversion-measurement',
  'digital-credentials-create',
  'digital-credentials-get',
  'focus-without-user-activation',
  'join-ad-interest-group',
  'local-fonts',
  'monetization',
  'run-ad-auction',
  'smart-card',
  'sync-script',
  'trust-token-redemption',
  'unload',
  'vertical-scroll',
]);

/** Retired features per W3C registry §"Retired Features" — kept so legacy configs do not warn. */
export const RETIRED: ReadonlySet<PermissionsPolicyFeature> = new Set<PermissionsPolicyFeature>([
  'document-domain',
  'window-placement',
]);

/** All known features — used to issue UnknownPermissionsPolicyFeature warnings. */
export const KNOWN_FEATURES: ReadonlySet<string> = new Set<string>([
  ...STANDARDIZED,
  ...PROPOSED,
  ...EXPERIMENTAL,
  ...RETIRED,
]);

/**
 * Subset of {@link STANDARDIZED} that is default-denied when the user enables
 * the policy without specifying features. `ch-ua-*` Client Hint features are
 * deliberately excluded — they have a separate opt-in lifecycle managed by
 * the User-Agent Client Hints spec, and default-denying them silently strips
 * downstream `Sec-CH-UA*` request headers in unexpected ways.
 */
const DEFAULT_DENY: ReadonlySet<PermissionsPolicyFeature> = new Set<PermissionsPolicyFeature>(
  Array.from(STANDARDIZED).filter(f => !f.startsWith('ch-ua')) as PermissionsPolicyFeature[],
);

/**
 * Default-deny features when `permissionsPolicy: true` (or the feature is not
 * mentioned by the user). All {@link DEFAULT_DENY} features default to `()`
 * except `sync-xhr` which is `(self)` to preserve backwards compatibility per OWASP.
 */
export function buildDefaultFeatureMap(): Map<string, readonly string[]> {
  const out = new Map<string, readonly string[]>();
  for (const f of DEFAULT_DENY) {
    if (f === 'sync-xhr') out.set(f, Object.freeze(['self']));
    else out.set(f, Object.freeze([]));
  }
  return out;
}
