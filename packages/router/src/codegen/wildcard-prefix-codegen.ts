import type { MatchFn } from '../matcher/match-state';
import type { SegmentNode } from '../tree/segment-tree';

import { detectWildCodegenSpec } from './walker-strategy';

/**
 * Generate a walker function via `new Function()` for the static-prefix
 * wildcard pattern. Each prefix gets a `startsWith(prefix + '/', 1)` probe.
 * Returns null when the spec disqualifies (no wildcard subtree, or more
 * than 8 prefixes — beyond which the linear probe chain is no longer
 * cheaper than the iterative walker).
 */
export function tryCodegenStaticPrefixWildcard(root: SegmentNode): MatchFn | null {
  const entries = detectWildCodegenSpec(root);

  if (entries === null || entries.length > 8) return null;

  let body = `
    'use strict';
    return function compiledWildWalk(url, state) {
      var len = url.length;
      if (len < 2 || url.charCodeAt(0) !== 47) return false;
  `;

  for (const e of entries) {
    const prefixWithSlash = e.prefix + '/';
    const prefixLen = prefixWithSlash.length;
    const minLen = e.wildcardOrigin === 'multi' ? prefixLen + 1 : prefixLen;
    const sliceStart = prefixLen + 1;

    body += `
      if (len >= ${minLen + 1} && url.startsWith(${JSON.stringify(prefixWithSlash)}, 1)) {
        state.paramOffsets[0] = ${sliceStart};
        state.paramOffsets[1] = len;
        state.paramCount = 1;
        state.handlerIndex = ${e.wildcardStore};
        return true;
      }`;

    if (e.wildcardOrigin === 'star') {
      body += `
      if (len === ${e.prefix.length + 1} && url.startsWith(${JSON.stringify(e.prefix)}, 1)) {
        state.paramOffsets[0] = len;
        state.paramOffsets[1] = len;
        state.paramCount = 1;
        state.handlerIndex = ${e.wildcardStore};
        return true;
      }`;
    }
  }

  body += `
      return false;
    };
  `;

  return new Function(body)() as MatchFn;
}
