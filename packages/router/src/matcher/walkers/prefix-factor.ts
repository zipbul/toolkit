import type { MatchFn, MatchState } from '../match-state';
import type { DecoderFn } from '../decoder';
import type { SegmentNode, TenantFactor } from '../segment-tree';

import { TESTER_PASS } from '../pattern-tester';
import { detectTenantFactor, setTenantFactor } from '../segment-tree';

/**
 * Dry-run variant: detects but does not mutate. Returns the deepest
 * reachable node along with the factor candidate so the caller can
 * decide whether to commit. Mutation is split out into
 * `applyPrefixedFactor` so partial-success batch detection (multi-
 * prefix factor below) can roll back cleanly when any sibling fails.
 */
function detectPrefixedFactorDry(
  root: SegmentNode,
): { prefixSegs: string[]; factor: TenantFactor; deepNode: SegmentNode } | null {
  const prefixSegs: string[] = [];
  let cur: SegmentNode = root;

  // Bound the descent to keep this O(prefix depth) rather than O(tree).
  for (let depth = 0; depth < 32; depth++) {
    if (
      cur.paramChild !== null ||
      cur.wildcardStore !== null ||
      cur.store !== null ||
      cur.staticPrefix !== null
    ) {
      break;
    }

    let onlyKey: string | null = null;
    let onlyChild: SegmentNode | null = null;
    let count = 0;

    if (cur.singleChildKey !== null && cur.singleChildNext !== null && cur.staticChildren === null) {
      onlyKey = cur.singleChildKey;
      onlyChild = cur.singleChildNext;
      count = 1;
    } else if (cur.staticChildren !== null) {
      for (const k in cur.staticChildren) {
        count++;
        if (count > 1) break;
        onlyKey = k;
        onlyChild = cur.staticChildren[k]!;
      }
    }

    if (count !== 1 || onlyKey === null || onlyChild === null) break;

    prefixSegs.push(onlyKey);
    cur = onlyChild;
  }

  if (prefixSegs.length === 0) return null;

  const factor = detectTenantFactor(cur);
  if (factor === null) return null;

  return { prefixSegs, factor, deepNode: cur };
}

function applyPrefixedFactor(deepNode: SegmentNode, factor: TenantFactor): void {
  setTenantFactor(deepNode, factor);
  deepNode.staticChildren = null;
  deepNode.singleChildKey = null;
  deepNode.singleChildNext = null;
}

/**
 * Locate a tenant-factor candidate beneath a single-static-chain root
 * prefix. Walks every single-child static node from `root` and tries
 * `detectTenantFactor` at the deepest reachable node. Workloads like
 * `/users/${i}/posts/:postId` (root.staticChildren = {users}) reject
 * the root-level detector because the fanout lives one chain hop
 * deeper — this scan recovers them. On hit, mutates the deep node
 * to attach the factor and clear its staticChildren/singleChild slots
 * so the prefixed factored walker owns dispatch.
 */
export function tryDetectPrefixedFactor(
  root: SegmentNode,
): { prefixSegs: string[]; factor: TenantFactor } | null {
  const dry = detectPrefixedFactorDry(root);
  if (dry === null) return null;
  applyPrefixedFactor(dry.deepNode, dry.factor);
  return { prefixSegs: dry.prefixSegs, factor: dry.factor };
}

/**
 * Walker for the prefixed-factor case: match each segment in `prefixSegs`
 * against the leading URL segments, then perform the factor key lookup,
 * then walk the canonical shared subtree. Body after factor lookup is
 * structurally identical to `createFactoredWalker`.
 */
export function createPrefixedFactoredWalker(
  decoder: DecoderFn,
  prefixSegs: string[],
  keyToTerminal: Map<string, number>,
  sharedNext: SegmentNode,
): MatchFn {
  const prefixCount = prefixSegs.length;
  return function walk(url: string, state: MatchState): boolean {
    state.paramCount = 0;
    const len = url.length;

    let pos = 1;
    for (let i = 0; i < prefixCount; i++) {
      const seg = prefixSegs[i]!;
      const segLen = seg.length;
      const after = pos + segLen;
      if (after > len) return false;
      if (!url.startsWith(seg, pos)) return false;
      if (after < len && url.charCodeAt(after) !== 47) return false;
      pos = after === len ? len : after + 1;
    }

    if (pos >= len) return false;

    let end = pos;
    while (end < len && url.charCodeAt(end) !== 47) end++;
    const seg = end === pos ? '' : url.substring(pos, end);
    const looked = keyToTerminal.get(seg);
    if (looked === undefined) return false;
    const storeOverride = looked;

    let node = sharedNext;
    pos = end === len ? len : end + 1;

    while (pos < len) {
      if (node.staticPrefix !== null) {
        const sp = node.staticPrefix;
        let ok = true;
        for (let i = 0; i < sp.length; i++) {
          const s = sp[i]!;
          const sLen = s.length;
          const after = pos + sLen;
          if (after > len) { ok = false; break; }
          if (!url.startsWith(s, pos)) { ok = false; break; }
          if (after < len && url.charCodeAt(after) !== 47) { ok = false; break; }
          pos = after === len ? len : after + 1;
        }
        if (!ok) return false;
        if (pos >= len) break;
      }

      let endInner = pos;
      while (endInner < len && url.charCodeAt(endInner) !== 47) endInner++;
      const segLen = endInner - pos;

      const sck = node.singleChildKey;
      if (
        sck !== null &&
        node.singleChildNext !== null &&
        sck.length === segLen &&
        url.startsWith(sck, pos)
      ) {
        node = node.singleChildNext;
        pos = endInner === len ? len : endInner + 1;
        continue;
      }
      if (node.staticChildren !== null) {
        const segStr = url.substring(pos, endInner);
        const child = node.staticChildren[segStr];
        if (child !== undefined) {
          node = child;
          pos = endInner === len ? len : endInner + 1;
          continue;
        }
      }

      if (node.paramChild !== null && segLen > 0) {
        if (node.paramChild.tester !== null) {
          const decoded = decoder(url.substring(pos, endInner));
          if (node.paramChild.tester(decoded) !== TESTER_PASS) return false;
        }
        const pc = state.paramCount * 2;
        state.paramOffsets[pc] = pos;
        state.paramOffsets[pc + 1] = endInner;
        state.paramCount++;
        node = node.paramChild.next;
        pos = endInner === len ? len : endInner + 1;
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

interface PrefixedFactorEntry {
  prefixSegs: string[];
  keyToTerminal: Map<string, number>;
  sharedNext: SegmentNode;
}

/**
 * Detect prefixed-factor descriptors for every direct static child of
 * `root`. Returns the per-key map only if (a) root has multiple static
 * children and no other dispatch features (param/wildcard/store), and
 * (b) every child yields a non-null prefixed-factor result. Partial
 * application would force a fall-through walker which the IC cannot
 * unify, so we treat partial as "decline".
 */
export function tryDetectMultiPrefixFactor(root: SegmentNode): Map<string, PrefixedFactorEntry> | null {
  if (
    root.paramChild !== null ||
    root.wildcardStore !== null ||
    root.store !== null ||
    root.staticPrefix !== null
  ) {
    return null;
  }

  const childMap = root.staticChildren;
  if (childMap === null) return null;

  let keyCount = 0;
  for (const _k in childMap) {
    keyCount++;
    if (keyCount > 1) break;
  }
  if (keyCount < 2) return null;

  // Phase 1: dry-run every child, abort with tree intact on first failure.
  // Without phase split, a partially-mutated tree would feed the
  // fall-through walker tier and silently miscompile.
  type Pending =
    | { type: 'prefixed'; key: string; deepNode: SegmentNode; factor: TenantFactor; prefixSegs: string[] }
    | { type: 'direct'; key: string; child: SegmentNode; factor: TenantFactor };
  const pending: Pending[] = [];
  for (const k in childMap) {
    const child = childMap[k]!;
    const dryPrefixed = detectPrefixedFactorDry(child);
    if (dryPrefixed !== null) {
      pending.push({
        type: 'prefixed',
        key: k,
        deepNode: dryPrefixed.deepNode,
        factor: dryPrefixed.factor,
        prefixSegs: dryPrefixed.prefixSegs,
      });
      continue;
    }
    const direct = detectTenantFactor(child);
    if (direct !== null) {
      pending.push({ type: 'direct', key: k, child, factor: direct });
      continue;
    }
    return null;
  }

  // Phase 2: every sibling produced a candidate; commit the mutations.
  const out = new Map<string, PrefixedFactorEntry>();
  for (const p of pending) {
    if (p.type === 'prefixed') {
      applyPrefixedFactor(p.deepNode, p.factor);
      out.set(p.key, {
        prefixSegs: p.prefixSegs,
        keyToTerminal: p.factor.keyToTerminal,
        sharedNext: p.factor.sharedNext,
      });
    } else {
      applyPrefixedFactor(p.child, p.factor);
      out.set(p.key, {
        prefixSegs: [],
        keyToTerminal: p.factor.keyToTerminal,
        sharedNext: p.factor.sharedNext,
      });
    }
  }
  return out;
}

/**
 * Walker for the multi-prefix factor case. Dispatches on the first URL
 * segment to one of the per-child prefixed-factor entries, then walks
 * that entry's prefix segments, looks up the factor key, and walks the
 * shared subtree.
 */
export function createMultiPrefixFactoredWalker(
  decoder: DecoderFn,
  childMap: Map<string, PrefixedFactorEntry>,
): MatchFn {
  return function walk(url: string, state: MatchState): boolean {
    state.paramCount = 0;
    const len = url.length;

    if (url === '/') return false;

    let slash1 = 1;
    while (slash1 < len && url.charCodeAt(slash1) !== 47) slash1++;
    const firstSeg = slash1 === len ? url.substring(1) : url.substring(1, slash1);
    const entry = childMap.get(firstSeg);
    if (entry === undefined) return false;

    const prefixSegs = entry.prefixSegs;
    const prefixCount = prefixSegs.length;
    let pos = slash1 === len ? len : slash1 + 1;

    for (let i = 0; i < prefixCount; i++) {
      const seg = prefixSegs[i]!;
      const segLen = seg.length;
      const after = pos + segLen;
      if (after > len) return false;
      if (!url.startsWith(seg, pos)) return false;
      if (after < len && url.charCodeAt(after) !== 47) return false;
      pos = after === len ? len : after + 1;
    }

    if (pos >= len) return false;

    let end = pos;
    while (end < len && url.charCodeAt(end) !== 47) end++;
    const seg = end === pos ? '' : url.substring(pos, end);
    const looked = entry.keyToTerminal.get(seg);
    if (looked === undefined) return false;
    const storeOverride = looked;

    let node = entry.sharedNext;
    pos = end === len ? len : end + 1;

    while (pos < len) {
      if (node.staticPrefix !== null) {
        const sp = node.staticPrefix;
        let ok = true;
        for (let i = 0; i < sp.length; i++) {
          const s = sp[i]!;
          const sLen = s.length;
          const after = pos + sLen;
          if (after > len) { ok = false; break; }
          if (!url.startsWith(s, pos)) { ok = false; break; }
          if (after < len && url.charCodeAt(after) !== 47) { ok = false; break; }
          pos = after === len ? len : after + 1;
        }
        if (!ok) return false;
        if (pos >= len) break;
      }

      let endInner = pos;
      while (endInner < len && url.charCodeAt(endInner) !== 47) endInner++;
      const segLen = endInner - pos;

      const sck = node.singleChildKey;
      if (
        sck !== null &&
        node.singleChildNext !== null &&
        sck.length === segLen &&
        url.startsWith(sck, pos)
      ) {
        node = node.singleChildNext;
        pos = endInner === len ? len : endInner + 1;
        continue;
      }
      if (node.staticChildren !== null) {
        const segStr = url.substring(pos, endInner);
        const child = node.staticChildren[segStr];
        if (child !== undefined) {
          node = child;
          pos = endInner === len ? len : endInner + 1;
          continue;
        }
      }

      if (node.paramChild !== null && segLen > 0) {
        if (node.paramChild.tester !== null) {
          const decoded = decoder(url.substring(pos, endInner));
          if (node.paramChild.tester(decoded) !== TESTER_PASS) return false;
        }
        const pc = state.paramCount * 2;
        state.paramOffsets[pc] = pos;
        state.paramOffsets[pc + 1] = endInner;
        state.paramCount++;
        node = node.paramChild.next;
        pos = endInner === len ? len : endInner + 1;
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
