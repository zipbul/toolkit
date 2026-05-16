import type { SegmentNode } from './segment-tree';
import { forEachStaticChild, hasAnyStaticChild } from './segment-tree';

/**
 * Post-seal compaction. Walks the tree and folds every chain of nodes that
 * each have exactly one static child (and no param/wildcard/store) into the
 * deepest node, recording the path on `staticPrefix`.
 */
export function compactSegmentTree(root: SegmentNode): void {
  // Intern shared `staticPrefix` arrays so 100k nodes carrying the same
  // single-element prefix share one array reference instead of allocating
  // 100k 1-entry arrays. Closure-scoped because the intern map dies with
  // the call — the runtime walker only reads the deduped array refs.
  const prefixIntern = new Map<string, string[]>();
  const internPrefix = (parts: string[]): string[] => {
    const key = parts.join('\x00');
    const existing = prefixIntern.get(key);
    if (existing !== undefined) return existing;
    prefixIntern.set(key, parts);
    return parts;
  };

  const stack: SegmentNode[] = [root];
  const visited = new Set<SegmentNode>();
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (visited.has(node)) continue;
    visited.add(node);

    forEachStaticChild(node, (key, child) => {
      const { target, folded } = foldStaticChain(child);
      if (folded.length > 0) {
        target.staticPrefix = internPrefix(extendStaticPrefix(folded, target.staticPrefix));
        rewireStaticChild(node, key, target);
      }
      stack.push(target);
    });

    let p = node.paramChild;
    while (p !== null) {
      const { target, folded } = foldStaticChain(p.next);
      if (folded.length > 0) {
        target.staticPrefix = internPrefix(extendStaticPrefix(folded, target.staticPrefix));
        p.next = target;
      }
      stack.push(target);
      p = p.nextSibling;
    }
  }
}

/**
 * Single-static-child passthrough probe — peeks the inline slot first,
 * then the Record. Avoids any `Object.keys()` allocation.
 *
 * `insertIntoSegmentTree` clears the inline slot whenever it promotes to
 * a Record (the inline-and-Record-coexist transient does not survive a
 * single insert call), so the two slots are mutually exclusive at the
 * point compaction reaches each node. The caller (`foldStaticChain`)
 * also runs only on nodes where `hasAnyStaticChild` is true, so the
 * "no static at all" outcome cannot reach this function.
 */
export function peekSingleStaticChild(
  target: SegmentNode,
): { key: string; child: SegmentNode; many: boolean } {
  if (target.singleChildKey !== null && target.singleChildNext !== null) {
    return { key: target.singleChildKey, child: target.singleChildNext, many: false };
  }
  // staticChildren Record exclusively from here. Promote always installs
  // 2+ keys, so the loop short-circuits on the second iteration.
  let only: string | null = null;
  let onlyChild: SegmentNode | null = null;
  let many = false;
  for (const k in target.staticChildren!) {
    if (only === null) { only = k; onlyChild = target.staticChildren![k]!; }
    else { many = true; break; }
  }
  return { key: only!, child: onlyChild!, many };
}

/** Walk the single-static-chain starting at `start`, returning the
 *  deepest reachable node plus the keys that were folded away. */
export function foldStaticChain(start: SegmentNode): { target: SegmentNode; folded: string[] } {
  const folded: string[] = [];
  let target = start;
  while (
    hasAnyStaticChild(target) &&
    target.paramChild === null &&
    target.wildcardStore === null &&
    target.store === null &&
    target.staticPrefix === null
  ) {
    const peek = peekSingleStaticChild(target);
    if (peek.many || peek.key === null || peek.child === null) break;
    folded.push(peek.key);
    target = peek.child;
  }
  return { target, folded };
}

/** Compose the new staticPrefix array from freshly folded keys plus
 *  any prefix the deepest node already carried. */
export function extendStaticPrefix(folded: string[], existing: string[] | null): string[] {
  return existing === null ? folded : [...folded, ...existing];
}

/** Re-attach `key` on `parent` to point at `target`, regardless of
 *  whether the slot lives in the inline cache or the promoted Record. */
export function rewireStaticChild(parent: SegmentNode, key: string, target: SegmentNode): void {
  if (parent.singleChildKey === key) {
    parent.singleChildNext = target;
    return;
  }
  if (parent.staticChildren !== null && key in parent.staticChildren) {
    parent.staticChildren[key] = target;
  }
}

/**
 * Detect whether the segment tree has any node where the same URL segment
 * could simultaneously match multiple alternatives — a static child *and* a
 * param/wildcard, or two sibling params. When false, a non-recursive
 * iterative walker can be used safely; otherwise the recursive walker (with
 * backtracking) must run.
 */
export function hasAmbiguousNode(root: SegmentNode): boolean {
  const stack: SegmentNode[] = [root];

  while (stack.length > 0) {
    const node = stack.pop()!;

    if (hasAnyStaticChild(node) && (node.paramChild !== null || node.wildcardStore !== null)) {
      return true;
    }

    if (node.paramChild !== null && node.paramChild.nextSibling !== null) {
      return true;
    }

    forEachStaticChild(node, (_, child) => { stack.push(child); });

    let p = node.paramChild;

    while (p !== null) {
      stack.push(p.next);
      p = p.nextSibling;
    }
  }

  return false;
}
