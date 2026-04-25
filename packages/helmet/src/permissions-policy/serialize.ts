import { HttpHeader } from '@zipbul/shared';

import { LIMITS, RESERVED_KEYS } from '../constants';
import { HelmetErrorReason, HelmetWarningReason } from '../enums';
import type { HelmetWarning, PermissionsPolicyOptions, ViolationDetail } from '../interfaces';
import { serializeDictionary, serializeString, token } from '../structured-fields/serialize';
import type { ResolvedPermissionsPolicyOptions } from '../types';

import type { HeaderEntry } from '../simple-headers/serialize';
import { KNOWN_FEATURES, buildDefaultFeatureMap } from './features';

const FEATURE_NAME_RE = /^[a-z][a-z0-9-]{0,63}$/;

export function resolvePermissionsPolicy(
  input: boolean | PermissionsPolicyOptions | undefined,
): ResolvedPermissionsPolicyOptions | false {
  if (input === false) return false;
  if (input === undefined || input === true) {
    return Object.freeze({ features: buildDefaultFeatureMap() });
  }

  const features = buildDefaultFeatureMap();
  if (input.features) {
    // Prototype pollution guard: detect __proto__ override (sets prototype, not
    // an own property — invisible to Object.entries).
    const proto = Object.getPrototypeOf(input.features);
    if (proto !== null && proto !== Object.prototype) {
      features.set('__proto__', Object.freeze([]));
    }
    for (const [name, allowlist] of Object.entries(input.features)) {
      features.set(name, Object.freeze(allowlist.slice()));
    }
  }
  return Object.freeze({ features });
}

export function validatePermissionsPolicy(
  resolved: ResolvedPermissionsPolicyOptions,
  path: string,
  warnings: HelmetWarning[],
): ViolationDetail[] {
  const out: ViolationDetail[] = [];
  if (resolved.features.size > LIMITS.permissionsPolicyFeatures) {
    out.push({
      reason: HelmetErrorReason.InputTooLarge,
      path: `${path}.features`,
      message: `too many Permissions-Policy features (${resolved.features.size} > ${LIMITS.permissionsPolicyFeatures})`,
    });
  }
  for (const [name, allowlist] of resolved.features) {
    if (RESERVED_KEYS.has(name)) {
      out.push({
        reason: HelmetErrorReason.ReservedKeyDenied,
        path: `${path}.features.${name}`,
        message: 'reserved key denied (prototype pollution guard)',
      });
      continue;
    }
    if (!FEATURE_NAME_RE.test(name)) {
      out.push({
        reason: HelmetErrorReason.InvalidPermissionsPolicyToken,
        path: `${path}.features.${name}`,
        message: 'Permissions-Policy feature name must match [a-z][a-z0-9-]{0,63}',
      });
      continue;
    }
    if (!KNOWN_FEATURES.has(name)) {
      warnings.push({
        reason: HelmetWarningReason.UnknownPermissionsPolicyFeature,
        path: `${path}.features.${name}`,
        message: `unknown Permissions-Policy feature "${name}" (W3C registry / typo?)`,
      });
    }
    if (allowlist.length > LIMITS.permissionsPolicyAllowlist) {
      out.push({
        reason: HelmetErrorReason.InputTooLarge,
        path: `${path}.features.${name}`,
        message: `allowlist too long (${allowlist.length} > ${LIMITS.permissionsPolicyAllowlist})`,
      });
    }
    for (let i = 0; i < allowlist.length; i++) {
      const v = allowlist[i];
      if (typeof v !== 'string') {
        out.push({
          reason: HelmetErrorReason.InvalidPermissionsPolicyOrigin,
          path: `${path}.features.${name}[${i}]`,
          message: 'allowlist entries must be strings',
        });
        continue;
      }
      if (v === '*' || v === 'self') continue;
      try {
        const url = new URL(v);
        if (url.origin === 'null' || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
          out.push({
            reason: HelmetErrorReason.InvalidPermissionsPolicyOrigin,
            path: `${path}.features.${name}[${i}]`,
            message: 'origin must be an http(s) URL with a non-null origin',
          });
        }
      } catch {
        out.push({
          reason: HelmetErrorReason.InvalidPermissionsPolicyOrigin,
          path: `${path}.features.${name}[${i}]`,
          message: 'invalid origin URL',
        });
      }
    }
  }
  return out;
}

export function serializePermissionsPolicy(
  opts: ResolvedPermissionsPolicyOptions,
): HeaderEntry | undefined {
  if (opts.features.size === 0) return undefined;
  const dict = new Map<string, never>();
  for (const [name, allowlist] of opts.features) {
    if (allowlist.length === 0) {
      dict.set(name, { innerList: [] } as never);
      continue;
    }
    if (allowlist.length === 1 && allowlist[0] === '*') {
      dict.set(name, token('*') as never);
      continue;
    }
    const items: unknown[] = [];
    for (const v of allowlist) {
      if (v === 'self' || v === '*') items.push(token(v));
      else {
        // Origin — emit as sf-string (double-quoted) per Permissions-Policy spec
        items.push(new URL(v).origin);
      }
    }
    dict.set(name, { innerList: items } as never);
  }
  return [HttpHeader.PermissionsPolicy, serializeDictionary(dict as never)];
}

export function serializePermissionsPolicyReportOnly(
  opts: ResolvedPermissionsPolicyOptions,
): HeaderEntry | undefined {
  const entry = serializePermissionsPolicy(opts);
  if (entry === undefined) return undefined;
  return [HttpHeader.PermissionsPolicyReportOnly, entry[1]];
}

// Strings appear in inner lists via serializeItem dispatch — re-export
// serializeString to keep the import surface tidy.
export { serializeString };
