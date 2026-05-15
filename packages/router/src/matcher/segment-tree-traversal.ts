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
  // 100k 1-entry arrays.
  const prefixIntern = new Map<string, string[]>();
  const internPrefix = (parts: string[]): string[] => {
    const key = parts.join('\x00');
    const existing = prefixIntern.get(key);
    if (existing !== undefined) return existing;
    prefixIntern.set(key, parts);
    return parts;
  };

  // Single-static-child passthrough probe — peeks the inline cache first,
  // then the Record. Avoids any `Object.keys()` allocation.
  function peekSingleStatic(target: SegmentNode): { key: string | null; child: SegmentNode | null; many: boolean } {
    if (target.singleChildKey !== null && target.singleChildNext !== null && target.staticChildren === null) {
      return { key: target.singleChildKey, child: target.singleChildNext, many: false };
    }
    if (target.staticChildren !== null) {
      let only: string | null = null;
      let onlyChild: SegmentNode | null = null;
      let many = false;
      // The Record may contain entries even when an inline child also exists
      // (during build, before promotion); count both.
      if (target.singleChildKey !== null) { only = target.singleChildKey; onlyChild = target.singleChildNext; }
      for (const k in target.staticChildren) {
        if (only === null) { only = k; onlyChild = target.staticChildren[k]!; }
        else { many = true; break; }
      }
      return { key: only, child: onlyChild, many };
    }
    return { key: null, child: null, many: false };
  }

  function foldChainFrom(start: SegmentNode): { target: SegmentNode; folded: string[] } {
    const folded: string[] = [];
    let target = start;
    while (
      hasAnyStaticChild(target) &&
      target.paramChild === null &&
      target.wildcardStore === null &&
      target.store === null &&
      target.staticPrefix === null
    ) {
      const peek = peekSingleStatic(target);
      if (peek.many || peek.key === null || peek.child === null) break;
      folded.push(peek.key);
      target = peek.child;
    }
    return { target, folded };
  }

  function rewireStaticChild(parent: SegmentNode, key: string, target: SegmentNode): void {
    if (parent.singleChildKey === key) {
      parent.singleChildNext = target;
      return;
    }
    if (parent.staticChildren !== null && key in parent.staticChildren) {
      parent.staticChildren[key] = target;
    }
  }

  const stack: SegmentNode[] = [root];
  const visited = new Set<SegmentNode>();
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (visited.has(node)) continue;
    visited.add(node);

    forEachStaticChild(node, (key, child) => {
      const { target, folded } = foldChainFrom(child);
      if (folded.length > 0) {
        const merged = target.staticPrefix === null
          ? internPrefix(folded)
          : internPrefix([...folded, ...target.staticPrefix]);
        target.staticPrefix = merged;
        rewireStaticChild(node, key, target);
      }
      stack.push(target);
    });

    let p = node.paramChild;
    while (p !== null) {
      const { target, folded } = foldChainFrom(p.next);
      if (folded.length > 0) {
        const merged = target.staticPrefix === null
          ? internPrefix(folded)
          : internPrefix([...folded, ...target.staticPrefix]);
        target.staticPrefix = merged;
        p.next = target;
      }
      stack.push(target);
      p = p.nextSibling;
    }
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
