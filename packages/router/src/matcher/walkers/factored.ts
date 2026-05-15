import type { MatchFn, MatchState } from '../match-state';
import type { DecoderFn } from '../decoder';
import type { SegmentNode } from '../../tree/segment-tree';

import { TESTER_PASS } from '../../tree/pattern-tester';

/**
 * Tenant-factored walker variant. Used when `getTenantFactor(root)` returned
 * a descriptor: dispatches first-segment via `keyToTerminal` Map, then walks
 * the canonical shared subtree, finally overriding the leaf store with the
 * looked-up handler index. Identical body to the iterative walker apart
 * from the entry dispatch and the override applied at the terminal/wildcard
 * branches.
 *
 * Inner walk loop is intentionally inlined (not extracted to a helper) —
 * each tenant-factor variant must keep its own monomorphic IC; sharing
 * the body would push the call site polymorphic and regress hot-path
 * latency observed in prior bench rounds.
 */
export function createFactoredWalker(
  root: SegmentNode,
  decoder: DecoderFn,
  keyToTerminal: Map<string, number>,
  sharedNext: SegmentNode,
): MatchFn {
  return function walk(url: string, state: MatchState): boolean {
    state.paramCount = 0;
    const len = url.length;

    if (url === '/') {
      if (root.store !== null) {
        state.handlerIndex = root.store;
        return true;
      }
      return false;
    }

    let slash1 = 1;
    while (slash1 < len && url.charCodeAt(slash1) !== 47) slash1++;
    const firstSeg = slash1 === len ? url.substring(1) : url.substring(1, slash1);
    const looked = keyToTerminal.get(firstSeg);
    if (looked === undefined) return false;
    const storeOverride = looked;

    let node = sharedNext;
    let pos = slash1 === len ? len : slash1 + 1;

    while (pos < len) {
      if (node.staticPrefix !== null) {
        const sp = node.staticPrefix;
        let ok = true;
        for (let i = 0; i < sp.length; i++) {
          const seg = sp[i]!;
          const segLen = seg.length;
          const after = pos + segLen;
          if (after > len) { ok = false; break; }
          if (!url.startsWith(seg, pos)) { ok = false; break; }
          if (after < len && url.charCodeAt(after) !== 47) { ok = false; break; }
          pos = after === len ? len : after + 1;
        }
        if (!ok) return false;
        if (pos >= len) break;
      }

      let end = pos;
      while (end < len && url.charCodeAt(end) !== 47) end++;
      const segLen = end - pos;

      const sck = node.singleChildKey;
      if (
        sck !== null &&
        node.singleChildNext !== null &&
        sck.length === segLen &&
        url.startsWith(sck, pos)
      ) {
        node = node.singleChildNext;
        pos = end === len ? len : end + 1;
        continue;
      }
      if (node.staticChildren !== null) {
        const seg = url.substring(pos, end);
        const child = node.staticChildren[seg];
        if (child !== undefined) {
          node = child;
          pos = end === len ? len : end + 1;
          continue;
        }
      }

      if (node.paramChild !== null && segLen > 0) {
        if (node.paramChild.tester !== null) {
          const decoded = decoder(url.substring(pos, end));
          if (node.paramChild.tester(decoded) !== TESTER_PASS) return false;
        }
        const pc = state.paramCount * 2;
        state.paramOffsets[pc] = pos;
        state.paramOffsets[pc + 1] = end;
        state.paramCount++;
        node = node.paramChild.next;
        pos = end === len ? len : end + 1;
        continue;
      }

      if (node.wildcardStore !== null) {
        if (node.wildcardOrigin === 'multi' && pos >= len) return false;
        const pc = state.paramCount * 2;
        state.paramOffsets[pc] = pos;
        state.paramOffsets[pc + 1] = len;
        state.paramCount++;
        state.handlerIndex = storeOverride;
        return true;
      }

      return false;
    }

    if (node.store !== null) {
      state.handlerIndex = storeOverride;
      return true;
    }

    if (node.wildcardStore !== null && node.wildcardOrigin === 'star') {
      const pc = state.paramCount * 2;
      state.paramOffsets[pc] = len;
      state.paramOffsets[pc + 1] = len;
      state.paramCount++;
      state.handlerIndex = storeOverride;
      return true;
    }

    return false;
  };
}
