import type { DecoderFn, MatchFn, MatchState } from '../../types';

import { detectTenantFactor, setTenantFactor, type SegmentNode, type TenantFactor } from '../../tree';
import { walkSharedSubtree } from './factored';

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
    if (cur.paramChild !== null || cur.wildcardStore !== null || cur.store !== null || cur.staticPrefix !== null) {
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
        if (count > 1) {break;}
        onlyKey = k;
        onlyChild = cur.staticChildren[k]!;
      }
    }

    if (count !== 1 || onlyKey === null || onlyChild === null) {break;}

    prefixSegs.push(onlyKey);
    cur = onlyChild;
  }

  if (prefixSegs.length === 0) {return null;}

  const factor = detectTenantFactor(cur);
  if (factor === null) {return null;}

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
function tryDetectPrefixedFactor(root: SegmentNode): { prefixSegs: string[]; factor: TenantFactor } | null {
  const dry = detectPrefixedFactorDry(root);
  if (dry === null) {return null;}
  applyPrefixedFactor(dry.deepNode, dry.factor);
  return { prefixSegs: dry.prefixSegs, factor: dry.factor };
}

/**
 * Walker for the prefixed-factor case: match each segment in `prefixSegs`
 * against the leading URL segments, then perform the factor key lookup,
 * then walk the canonical shared subtree. Body after factor lookup is
 * structurally identical to `createFactoredWalker`.
 */
function createPrefixedFactoredWalker(
  decoder: DecoderFn,
  prefixSegs: string[],
  keyToTerminal: Map<string, number>,
  sharedNext: SegmentNode,
): MatchFn {
  const prefixCount = prefixSegs.length;
  return function walk(url: string, state: MatchState): boolean {
    state.paramCount = 0;
    const len = url.length;

    const afterPrefix = consumeFixedPrefix(prefixSegs, prefixCount, url, 1, len);
    if (afterPrefix < 0 || afterPrefix >= len) {return false;}

    const keyEnd = scanSegmentEnd(url, afterPrefix, len);
    const seg = keyEnd === afterPrefix ? '' : url.substring(afterPrefix, keyEnd);
    const looked = keyToTerminal.get(seg);
    if (looked === undefined) {return false;}

    return walkSharedSubtree(sharedNext, url, keyEnd === len ? len : keyEnd + 1, len, looked, decoder, state);
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
function tryDetectMultiPrefixFactor(root: SegmentNode): Map<string, PrefixedFactorEntry> | null {
  if (root.paramChild !== null || root.wildcardStore !== null || root.store !== null || root.staticPrefix !== null) {
    return null;
  }

  const childMap = root.staticChildren;
  if (childMap === null) {return null;}

  let keyCount = 0;
  for (const _k in childMap) {
    keyCount++;
    if (keyCount > 1) {break;}
  }
  if (keyCount < 2) {return null;}

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
function createMultiPrefixFactoredWalker(decoder: DecoderFn, childMap: Map<string, PrefixedFactorEntry>): MatchFn {
  return function walk(url: string, state: MatchState): boolean {
    state.paramCount = 0;
    const len = url.length;

    if (url === '/') {return false;}

    let slash1 = 1;
    while (slash1 < len && url.charCodeAt(slash1) !== 47) {slash1++;}
    const firstSeg = slash1 === len ? url.substring(1) : url.substring(1, slash1);
    const entry = childMap.get(firstSeg);
    if (entry === undefined) {return false;}

    const afterPrefix = consumeFixedPrefix(
      entry.prefixSegs,
      entry.prefixSegs.length,
      url,
      slash1 === len ? len : slash1 + 1,
      len,
    );
    if (afterPrefix < 0 || afterPrefix >= len) {return false;}

    const keyEnd = scanSegmentEnd(url, afterPrefix, len);
    const seg = keyEnd === afterPrefix ? '' : url.substring(afterPrefix, keyEnd);
    const looked = entry.keyToTerminal.get(seg);
    if (looked === undefined) {return false;}

    return walkSharedSubtree(entry.sharedNext, url, keyEnd === len ? len : keyEnd + 1, len, looked, decoder, state);
  };
}

/** Consume `prefixSegs` against `url` starting at `pos`. Returns the new
 *  position after the prefix matches, or `-1` on mismatch. */
function consumeFixedPrefix(
  prefixSegs: ReadonlyArray<string>,
  prefixCount: number,
  url: string,
  pos: number,
  len: number,
): number {
  for (let i = 0; i < prefixCount; i++) {
    const seg = prefixSegs[i]!;
    const segLen = seg.length;
    const after = pos + segLen;
    if (after > len) {return -1;}
    if (!url.startsWith(seg, pos)) {return -1;}
    if (after < len && url.charCodeAt(after) !== 47) {return -1;}
    pos = after === len ? len : after + 1;
  }
  return pos;
}

/** Scan `url` from `pos` to the next `/` or end. */
function scanSegmentEnd(url: string, pos: number, len: number): number {
  let end = pos;
  while (end < len && url.charCodeAt(end) !== 47) {end++;}
  return end;
}

export {
  consumeFixedPrefix,
  createMultiPrefixFactoredWalker,
  createPrefixedFactoredWalker,
  scanSegmentEnd,
  tryDetectMultiPrefixFactor,
  tryDetectPrefixedFactor,
};
