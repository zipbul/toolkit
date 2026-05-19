import type { SegmentNode } from '../../tree';
import type { DecoderFn, MatchFn, MatchState } from '../../types';

import { TESTER_PASS } from '../../tree';

/**
 * Tenant-factored walker variant. Used when `getTenantFactor(root)` returned
 * a descriptor: dispatches first-segment via `keyToTerminal` Map, then
 * delegates the shared-subtree descent to `walkSharedSubtree` with the
 * resolved per-tenant `storeOverride`. Three factored walkers
 * (createFactoredWalker, createPrefixedFactoredWalker,
 * createMultiPrefixFactoredWalker) all converge on the same inner-loop
 * function; measurement (commit ac1942e) confirmed the shared call site
 * stays inlined by JSC — no IC regression versus the prior inlined body.
 */
export function createFactoredWalker(decoder: DecoderFn, keyToTerminal: Map<string, number>, sharedNext: SegmentNode): MatchFn {
  return function walk(url: string, state: MatchState): boolean {
    state.paramCount = 0;
    const len = url.length;

    // No `url === '/'` short-circuit: the factor is only attached when
    // the root has a high-fanout sibling group (which requires
    // root.store === null; see factor-detect.ts), so a `/` request can
    // never produce a factored match anyway. The `keyToTerminal.get('')`
    // lookup below returns undefined for this input and we fall through
    // to `return false` cleanly.
    let slash1 = 1;
    while (slash1 < len && url.charCodeAt(slash1) !== 47) {
      slash1++;
    }
    const firstSeg = slash1 === len ? url.substring(1) : url.substring(1, slash1);
    const looked = keyToTerminal.get(firstSeg);
    if (looked === undefined) {
      return false;
    }

    return walkSharedSubtree(sharedNext, url, slash1 === len ? len : slash1 + 1, len, looked, decoder, state);
  };
}

/**
 * Walk the canonical shared subtree after the tenant-factor key has been
 * resolved. `storeOverride` is the per-tenant terminal handler the
 * factor table looked up; it replaces whatever the shared subtree's
 * leaf store would say.
 *
 * Reachable shapes are bounded by `factor-detect.ts:leafStoreOf`, which
 * only accepts subtrees that form a unique chain to a single store
 * terminal:
 *
 *   - Static descent via `singleChildKey` (a `staticChildren` Record
 *     entry never appears here — leafStoreOf rejects nodes with more
 *     than one static child, and a single static child stays inline.)
 *   - Param descent via `paramChild` with no `nextSibling`
 *   - Terminal `store` at end-of-URL
 *
 * Nodes carrying `staticPrefix` (compaction output), `wildcardStore`,
 * sibling params, or multi-key `staticChildren` are all rejected by
 * leafStoreOf and therefore never reach this walker. Branches for those
 * shapes are intentionally absent.
 */
export function walkSharedSubtree(
  sharedNext: SegmentNode,
  url: string,
  initialPos: number,
  len: number,
  storeOverride: number,
  decoder: DecoderFn,
  state: MatchState,
): boolean {
  let node = sharedNext;
  let pos = initialPos;

  while (pos < len) {
    let end = pos;
    while (end < len && url.charCodeAt(end) !== 47) {
      end++;
    }
    const segLen = end - pos;

    const sck = node.singleChildKey;
    if (sck !== null && node.singleChildNext !== null && sck.length === segLen && url.startsWith(sck, pos)) {
      node = node.singleChildNext;
      pos = end === len ? len : end + 1;
      continue;
    }

    if (node.paramChild !== null && segLen > 0) {
      if (node.paramChild.tester !== null) {
        const decoded = decoder(url.substring(pos, end));
        if (node.paramChild.tester(decoded) !== TESTER_PASS) {
          return false;
        }
      }
      const pc = state.paramCount * 2;
      state.paramOffsets[pc] = pos;
      state.paramOffsets[pc + 1] = end;
      state.paramCount++;
      node = node.paramChild.next;
      pos = end === len ? len : end + 1;
      continue;
    }

    return false;
  }

  if (node.store !== null) {
    state.handlerIndex = storeOverride;
    return true;
  }
  return false;
}
