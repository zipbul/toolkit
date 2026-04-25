import type { PermissionsPolicyFeature } from '../types';

/** Tier A — universal (Chromium + Firefox + Safari header parsed). */
export const TIER_A: ReadonlySet<PermissionsPolicyFeature> = new Set<PermissionsPolicyFeature>([
  'publickey-credentials-get',
  'publickey-credentials-create',
  'identity-credentials-get',
  'digital-credentials-get',
  'digital-credentials-create',
  'otp-credentials',
]);

/** Tier B — Chromium + Firefox parsed (W3C registry Standardized minus ch-ua-*). */
export const TIER_B: ReadonlySet<PermissionsPolicyFeature> = new Set<PermissionsPolicyFeature>([
  'accelerometer',
  'ambient-light-sensor',
  'attribution-reporting',
  'autoplay',
  'battery',
  'bluetooth',
  'camera',
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
  'idle-detection',
  'keyboard-map',
  'magnetometer',
  'mediasession',
  'microphone',
  'midi',
  'navigation-override',
  'payment',
  'picture-in-picture',
  'screen-wake-lock',
  'serial',
  'storage-access',
  'sync-xhr',
  'usb',
  'web-share',
  'window-management',
  'xr-spatial-tracking',
]);

/** Tier C — Chromium-only stable. */
export const TIER_C: ReadonlySet<PermissionsPolicyFeature> = new Set<PermissionsPolicyFeature>([
  'gamepad',
  'clipboard-read',
  'clipboard-write',
  'local-fonts',
  'unload',
  'browsing-topics',
  'captured-surface-control',
  'smart-card',
  'speaker-selection',
  'all-screens-capture',
  'deferred-fetch',
  'language-model',
  'language-detector',
  'summarizer',
  'translator',
  'writer',
  'rewriter',
  'autofill',
]);

/** All known features — used to issue UnknownPermissionsPolicyFeature warnings. */
export const KNOWN_FEATURES: ReadonlySet<string> = new Set<string>([
  ...TIER_A,
  ...TIER_B,
  ...TIER_C,
]);

/**
 * Default-deny features when `permissionsPolicy: true` (or the feature is not
 * mentioned by the user). All Tier A + B features default to `()` except
 * `sync-xhr` which is `(self)` to preserve backwards compatibility per OWASP.
 */
export function buildDefaultFeatureMap(): Map<string, readonly string[]> {
  const out = new Map<string, readonly string[]>();
  for (const f of TIER_A) out.set(f, Object.freeze([]));
  for (const f of TIER_B) {
    if (f === 'sync-xhr') out.set(f, Object.freeze(['self']));
    else out.set(f, Object.freeze([]));
  }
  return out;
}
