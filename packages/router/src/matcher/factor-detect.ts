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
export interface TenantFactor {
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

export function getTenantFactor(node: SegmentNode): TenantFactor | undefined {
  return tenantFactorStore.get(node);
}

export function setTenantFactor(node: SegmentNode, factor: TenantFactor): void {
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
export function detectTenantFactor(root: SegmentNode, minSiblings = 1000): TenantFactor | null {
  if (root.store !== null) return null;
  if (root.paramChild !== null || root.wildcardStore !== null) return null;
  if (root.staticChildren === null) return null;

  const keys: string[] = [];
  for (const k in root.staticChildren) keys.push(k);
  if (keys.length < minSiblings) return null;

  const firstChild = root.staticChildren[keys[0]!]!;
  const baseStore = leafStoreOf(firstChild);
  if (baseStore === null) return null;

  const keyToTerminal = new Map<string, number>();
  keyToTerminal.set(keys[0]!, baseStore);
  for (let i = 1; i < keys.length; i++) {
    const k = keys[i]!;
    const child = root.staticChildren[k]!;
    if (!subtreeShapesEqual(firstChild, child)) return null;
    const store = leafStoreOf(child);
    if (store === null) return null;
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
  // differ only by an intermediate `store` (e.g. one tenant adds a
  // mid-route `/data/:type` while every other tenant only registers
  // `/data/:type/:item`) are NOT factor-equivalent: the factored
  // walker would fold them under one canonical subtree and override
  // every leaf with the same handler index, miscompiling matches at
  // the differing position. The handler value itself differs per
  // sibling — only presence must match.
  if ((a.store === null) !== (b.store === null)) return false;
  if ((a.wildcardStore === null) !== (b.wildcardStore === null)) return false;
  if (a.wildcardName !== b.wildcardName) return false;
  if (a.wildcardOrigin !== b.wildcardOrigin) return false;

  const ap = a.staticPrefix;
  const bp = b.staticPrefix;
  if ((ap === null) !== (bp === null)) return false;
  if (ap !== null && bp !== null) {
    if (ap.length !== bp.length) return false;
    for (let i = 0; i < ap.length; i++) if (ap[i] !== bp[i]) return false;
  }

  if ((a.singleChildKey === null) !== (b.singleChildKey === null)) return false;
  if (a.singleChildKey !== null) {
    if (a.singleChildKey !== b.singleChildKey) return false;
    if (!subtreeShapesEqual(a.singleChildNext!, b.singleChildNext!)) return false;
  }

  const ac = a.staticChildren;
  const bc = b.staticChildren;
  if ((ac === null) !== (bc === null)) return false;
  if (ac !== null && bc !== null) {
    const aKeys: string[] = [];
    const bKeys: string[] = [];
    for (const k in ac) aKeys.push(k);
    for (const k in bc) bKeys.push(k);
    if (aKeys.length !== bKeys.length) return false;
    aKeys.sort();
    bKeys.sort();
    for (let i = 0; i < aKeys.length; i++) {
      const ak = aKeys[i]!;
      if (ak !== bKeys[i]) return false;
      if (!subtreeShapesEqual(ac[ak]!, bc[ak]!)) return false;
    }
  }

  let p1 = a.paramChild;
  let p2 = b.paramChild;
  while (p1 !== null && p2 !== null) {
    if (p1.name !== p2.name) return false;
    if (p1.patternSource !== p2.patternSource) return false;
    if (!subtreeShapesEqual(p1.next, p2.next)) return false;
    p1 = p1.nextSibling;
    p2 = p2.nextSibling;
  }
  if (p1 !== null || p2 !== null) return false;

  return true;
}

/**
 * Hard ceiling on chain-walk depth in `leafStoreOf`. Production paths
 * never approach this (median depth ≤ 6); the cap is a safety net for
 * malformed trees that would otherwise loop until the runtime stack
 * pops. Increasing it only changes the depth at which the safety net
 * trips — no other code reads this value.
 */
const LEAF_STORE_MAX_DEPTH = 64;

/**
 * Walk to the unique terminal node and return its `store`. Returns null
 * if there is no unique terminal (multiple stores on the path) or if an
 * intermediate node carries both a store and descendants (multi-terminal
 * subtree — not factor-safe).
 */
function leafStoreOf(node: SegmentNode): number | null {
  let cur: SegmentNode = node;
  let depth = 0;
  while (depth++ < LEAF_STORE_MAX_DEPTH) {
    if (cur.store !== null) {
      // Multi-terminal subtree (intermediate node carries a store AND
      // has descendants) is not factor-safe: the factored walker keeps
      // a single `storeOverride` per tenant key, so the override would
      // be applied to every descendant terminal instead of only the
      // one this routine reached. Return null and let the detector
      // reject the factor candidate.
      if (
        cur.paramChild !== null ||
        cur.singleChildKey !== null ||
        cur.staticChildren !== null ||
        cur.wildcardStore !== null
      ) {
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
    if (cur.staticChildren !== null) {
      let only: SegmentNode | null = null;
      let many = false;
      for (const k in cur.staticChildren) {
        if (only === null) only = cur.staticChildren[k]!;
        else { many = true; break; }
      }
      if (many || only === null) return null;
      cur = only;
      continue;
    }
    return null;
  }
  return null;
}
