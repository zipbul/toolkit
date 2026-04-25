import { HttpHeader } from '@zipbul/shared';

import { HelmetErrorReason, HelmetWarningReason } from '../enums';
import type { ClearSiteDataDirective, ClearSiteDataOptions } from '../interfaces';
import type { HelmetWarning, ViolationDetail } from '../interfaces';
import { serializeString } from '../structured-fields/serialize';
import type { ResolvedClearSiteDataOptions } from '../types';

import type { HeaderEntry } from '../simple-headers/serialize';

const STANDARD_TOKENS = new Set<string>([
  'cache',
  'cookies',
  'storage',
  'executionContexts',
  'clientHints',
  '*',
]);
const CHROMIUM_ONLY = new Set<string>(['prefetchCache', 'prerenderCache']);

export function resolveClearSiteData(
  input: boolean | ClearSiteDataOptions | undefined,
): ResolvedClearSiteDataOptions | undefined | false {
  if (input === undefined) return undefined;
  if (input === false) return false;
  if (input === true) {
    return Object.freeze({ directives: Object.freeze(['cache', 'cookies', 'storage']) });
  }
  return Object.freeze({
    directives: Object.freeze((input.directives ?? ['cache', 'cookies', 'storage']).slice()),
  });
}

export function validateClearSiteData(
  resolved: ResolvedClearSiteDataOptions,
  path: string,
  warnings: HelmetWarning[],
): ViolationDetail[] {
  const out: ViolationDetail[] = [];
  for (let i = 0; i < resolved.directives.length; i++) {
    const t = resolved.directives[i];
    if (t === undefined) continue;
    if (STANDARD_TOKENS.has(t)) continue;
    if (CHROMIUM_ONLY.has(t)) {
      warnings.push({
        reason: HelmetWarningReason.NonStandardClearSiteDataToken,
        path: `${path}.directives[${i}]`,
        message: `Clear-Site-Data token "${t}" is non-standard (Chromium-only)`,
      });
      continue;
    }
    out.push({
      reason: HelmetErrorReason.InvalidClearSiteDataDirective,
      path: `${path}.directives[${i}]`,
      message: 'unknown Clear-Site-Data directive',
    });
  }
  return out;
}

export function serializeClearSiteData(opts: ResolvedClearSiteDataOptions): HeaderEntry {
  // RFC 9651 List of sf-string. We use serializeString for proper escape semantics.
  const value = opts.directives.map(d => serializeString(d)).join(', ');
  return [HttpHeader.ClearSiteData, value];
}

export type { ClearSiteDataDirective };
