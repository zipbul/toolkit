import type { CspDirectives } from '../interfaces';

/** All fetch directives that fall back through `default-src`. */
export const FETCH_DIRECTIVES: ReadonlySet<keyof CspDirectives> = new Set([
  'defaultSrc',
  'childSrc',
  'connectSrc',
  'fencedFrameSrc',
  'fontSrc',
  'frameSrc',
  'imgSrc',
  'manifestSrc',
  'mediaSrc',
  'objectSrc',
  'scriptSrc',
  'scriptSrcAttr',
  'scriptSrcElem',
  'styleSrc',
  'styleSrcAttr',
  'styleSrcElem',
  'workerSrc',
]);

/** Directives that take a list of sources but never fall back to default-src. */
export const NON_FETCH_LIST_DIRECTIVES: ReadonlySet<keyof CspDirectives> = new Set([
  'baseUri',
  'formAction',
  'frameAncestors',
]);

const CAMEL_TO_KEBAB: Record<keyof CspDirectives, string> = {
  defaultSrc: 'default-src',
  childSrc: 'child-src',
  connectSrc: 'connect-src',
  fencedFrameSrc: 'fenced-frame-src',
  fontSrc: 'font-src',
  frameSrc: 'frame-src',
  imgSrc: 'img-src',
  manifestSrc: 'manifest-src',
  mediaSrc: 'media-src',
  objectSrc: 'object-src',
  scriptSrc: 'script-src',
  scriptSrcAttr: 'script-src-attr',
  scriptSrcElem: 'script-src-elem',
  styleSrc: 'style-src',
  styleSrcAttr: 'style-src-attr',
  styleSrcElem: 'style-src-elem',
  workerSrc: 'worker-src',
  baseUri: 'base-uri',
  sandbox: 'sandbox',
  formAction: 'form-action',
  frameAncestors: 'frame-ancestors',
  reportTo: 'report-to',
  reportUri: 'report-uri',
  webrtc: 'webrtc',
  upgradeInsecureRequests: 'upgrade-insecure-requests',
  requireTrustedTypesFor: 'require-trusted-types-for',
  trustedTypes: 'trusted-types',
};

export function camelToKebab(key: keyof CspDirectives): string {
  return CAMEL_TO_KEBAB[key];
}

/**
 * Emit order matches the OWASP/Mozilla recommended sequence so golden
 * snapshots are stable across versions.
 */
export const EMIT_ORDER: readonly (keyof CspDirectives)[] = [
  'defaultSrc',
  'baseUri',
  'fontSrc',
  'formAction',
  'frameAncestors',
  'frameSrc',
  'fencedFrameSrc',
  'imgSrc',
  'manifestSrc',
  'mediaSrc',
  'objectSrc',
  'connectSrc',
  'childSrc',
  'scriptSrc',
  'scriptSrcAttr',
  'scriptSrcElem',
  'styleSrc',
  'styleSrcAttr',
  'styleSrcElem',
  'workerSrc',
  'webrtc',
  'sandbox',
  'requireTrustedTypesFor',
  'trustedTypes',
  'upgradeInsecureRequests',
  'reportTo',
  'reportUri',
];

export const DEPRECATED_DIRECTIVES: ReadonlySet<string> = new Set([
  'prefetch-src',
  'plugin-types',
  'block-all-mixed-content',
  'referrer',
  'reflected-xss',
  'navigate-to',
]);
