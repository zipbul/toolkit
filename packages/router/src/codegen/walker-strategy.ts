import type { SegmentNode } from '../tree';

/*
 * ─── Walker-strategy decisions ──────────────────────────────────────
 *
 * The router's match path takes the Generic shape:
 *
 *   1. Generic — emitter generic codegen. The default matchImpl shape:
 *      method dispatch + path preprocess + static lookup + cache +
 *      dynamic walk + cache write.
 *
 *   2. Iterative — segment-walk's `createIterativeWalker`. Used by
 *      `createSegmentWalker` when codegen bails (size budget, fanout)
 *      and the tree is *not* ambiguous (no static + param/wildcard
 *      alternation at the same node).
 *
 *   3. Recursive — segment-walk's recursive backtracking walker. Last
 *      resort for ambiguous trees that need backtracking the iterative
 *      walker doesn't generate.
 *
 * Decisions are staged: `createSegmentWalker` chooses among
 * codegen / Iterative / Recursive per method via a try-cascade.
 */

/**
 * Static-prefix wildcard codegen entry. Built when a method's tree
 * shape qualifies for inline `startsWith(prefix + '/', 1)` dispatch
 * (file-server / asset-CDN style routers).
 */
export interface WildCodegenEntry {
  prefix: string;
  wildcardOrigin: 'star' | 'multi';
  wildcardName: string;
  wildcardStore: number;
}

/**
 * Detect whether `root` matches the static-prefix wildcard shape:
 *   root -> staticChildren[name] -> wildcardStore (no deeper structure)
 *
 * Returns the entry list when the shape matches, null otherwise. Used
 * by segment-walk's in-walker codegen (`tryCodegenStaticPrefixWildcard`).
 */
export function detectWildCodegenSpec(root: SegmentNode): WildCodegenEntry[] | null {
  if (root.paramChild !== null || root.wildcardStore !== null || root.store !== null) {
    return null;
  }
  if (root.staticChildren === null) {
    return null;
  }

  const entries: WildCodegenEntry[] = [];

  for (const key in root.staticChildren) {
    const child = root.staticChildren[key]!;

    if (child.staticChildren !== null) {
      return null;
    }
    if (child.paramChild !== null) {
      return null;
    }
    if (child.store !== null) {
      return null;
    }
    if (child.wildcardStore === null) {
      return null;
    }

    entries.push({
      prefix: key,
      wildcardOrigin: child.wildcardOrigin!,
      wildcardName: child.wildcardName!,
      wildcardStore: child.wildcardStore,
    });
  }

  if (entries.length === 0) {
    return null;
  }

  return entries;
}
