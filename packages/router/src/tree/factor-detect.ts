import type { SegmentNode } from './segment-tree';

/**
 * Tenant-prefix factor descriptor. When a method's root has many static
 * children (e.g. `tenant-0`, `tenant-1`, ..., `tenant-99999`) whose subtrees
 * are structurally identical except for the terminal handler index, those
 * branches collapse onto a single canonical subtree plus a hash table
 * mapping each first-segment key to its terminal handler index. The walker
 * then resolves match in two steps: hash lookup → walk shared subtree →
 * override leaf store with the looked-up index.
 *
 * Empirical (100k tenant `/tenant-${i}/users/:id/posts/:postId`):
 * 100k separate root branches → 1 shared subtree + 100k Map entries.
 * Object count drops from ~706k to ~103k; RSS drops from 220 MB to ~60 MB.
 */
interface TenantFactor {
  /** First-segment key → terminal handler index. */
  keyToTerminal: Map<string, number>;
  /** Canonical shared subtree the walker descends after first segment matches. */
  sharedNext: SegmentNode;
}

/**
 * Sidecar storage so we don't widen `SegmentNode`'s hidden class for the
 * common case (most nodes don't have a factor). The walker probes this
 * WeakMap only at root, so it's off the per-segment hot path.
 */
const tenantFactorStore = new WeakMap<SegmentNode, TenantFactor>();

function getTenantFactor(node: SegmentNode): TenantFactor | undefined {
  return tenantFactorStore.get(node);
}

function setTenantFactor(node: SegmentNode, factor: TenantFactor): void {
  tenantFactorStore.set(node, factor);
}

/**
 * Detect whether `root.staticChildren` collapses to a tenant factor:
 * many sibling branches with identical structural shape and a single
 * distinct terminal store per branch. Returns the factor descriptor on
 * success, `null` otherwise. Threshold defaults to 1000 siblings to
 * avoid factoring small fanouts (the WeakMap probe + hash lookup costs
 * ~5 ns extra; only worth it when the savings outweigh the per-match
 * tax).
 */
function detectTenantFactor(root: SegmentNode, minSiblings = 1000): TenantFactor | null {
  if (root.store !== null) {
    return null;
  }
  if (root.paramChild !== null || root.wildcardStore !== null) {
    return null;
  }
  if (root.staticChildren === null) {
    return null;
  }

  const keys: string[] = [];
  for (const k in root.staticChildren) {
    keys.push(k);
  }
  if (keys.length < minSiblings) {
    return null;
  }

  const firstChild = root.staticChildren[keys[0]!]!;
  const baseStore = leafStoreOf(firstChild);
  if (baseStore === null) {
    return null;
  }

  const keyToTerminal = new Map<string, number>();
  keyToTerminal.set(keys[0]!, baseStore);
  for (let i = 1; i < keys.length; i++) {
    const k = keys[i]!;
    const child = root.staticChildren[k]!;
    if (!subtreeShapesEqual(firstChild, child)) {
      return null;
    }
    const store = leafStoreOf(child);
    if (store === null) {
      return null;
    }
    keyToTerminal.set(k, store);
  }
  return { keyToTerminal, sharedNext: firstChild };
}

/**
 * Direct structural compare — skips the string-build hash that
 * `subtreeShape()` returned. The detector only ever needs to verify
 * every sibling subtree matches the canonical first one; allocating an
 * O(N) string per sibling (with `parts.join`) was empirically 18% of
 * the 100k-tenant build profile (cpu-prof: subtreeShape + join hot).
 */
function subtreeShapesEqual(a: SegmentNode, b: SegmentNode): boolean {
  // Terminal-store presence must match. Two siblings whose subtrees
  // differ only by an intermediate `store` are NOT factor-equivalent:
  // the factored walker would fold them under one canonical subtree
  // and override every leaf with the same handler index, miscompiling
  // matches at the differing position. The handler value itself differs
  // per sibling — only presence must match.
  if ((a.store === null) !== (b.store === null)) {
    return false;
  }
  // wildcardStore / staticPrefix / staticChildren Record fields are
  // ignored: leafStoreOf rejects every subtree carrying any of them
  // before this comparison runs (compaction does not touch factor
  // candidates, and Record/wildcard nodes never produce a unique
  // chain to a single store).
  if ((a.singleChildKey === null) !== (b.singleChildKey === null)) {
    return false;
  }
  if (a.singleChildKey !== null) {
    if (a.singleChildKey !== b.singleChildKey) {
      return false;
    }
    if (!subtreeShapesEqual(a.singleChildNext!, b.singleChildNext!)) {
      return false;
    }
  }

  let p1 = a.paramChild;
  let p2 = b.paramChild;
  while (p1 !== null && p2 !== null) {
    if (p1.name !== p2.name) {
      return false;
    }
    if (p1.patternSource !== p2.patternSource) {
      return false;
    }
    if (!subtreeShapesEqual(p1.next, p2.next)) {
      return false;
    }
    p1 = p1.nextSibling;
    p2 = p2.nextSibling;
  }
  if (p1 !== null || p2 !== null) {
    return false;
  }

  return true;
}

/**
 * Walk to the unique terminal node and return its `store`. Returns null
 * if there is no unique terminal (multiple stores on the path) or if an
 * intermediate node carries both a store and descendants (multi-terminal
 * subtree — not factor-safe).
 *
 * No depth cap: the segment tree is constructed exclusively by
 * `insertIntoSegmentTree`, which only ever attaches fresh nodes from
 * `createSegmentNode()`. There is no rewiring path that could form a
 * cycle, so the descent terminates on every reachable shape (param-,
 * single-static-, or store-terminating chain) without an arbitrary
 * limit. A previous 64-depth ceiling silently rejected any route with
 * 64+ segments from the factor optimization — that ceiling is gone.
 */
function leafStoreOf(node: SegmentNode): number | null {
  let cur: SegmentNode = node;
  while (true) {
    if (cur.store !== null) {
      // Multi-terminal subtree (intermediate node carries a store AND
      // has descendants) is not factor-safe: the factored walker keeps
      // a single `storeOverride` per tenant key, so the override would
      // be applied to every descendant terminal instead of only the
      // one this routine reached. Return null and let the detector
      // reject the factor candidate.
      if (cur.paramChild !== null || cur.singleChildKey !== null || cur.staticChildren !== null || cur.wildcardStore !== null) {
        return null;
      }
      return cur.store;
    }
    if (cur.paramChild !== null && cur.paramChild.nextSibling === null) {
      cur = cur.paramChild.next;
      continue;
    }
    if (cur.singleChildKey !== null && cur.singleChildNext !== null && cur.staticChildren === null) {
      cur = cur.singleChildNext;
      continue;
    }
    // No further descent is possible from this node:
    //   - `staticChildren` Record always carries 2+ keys (insert promotes
    //     from inline only when adding a *second* sibling), so a factor-
    //     able unique chain cannot continue through it.
    //   - `wildcardStore`-only nodes have no chainable child.
    //   - `paramChild` with `nextSibling` (multiple param alternatives)
    //     was already filtered out above.
    return null;
  }
}

export { detectTenantFactor, getTenantFactor, setTenantFactor };
export type { TenantFactor };
