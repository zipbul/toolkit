import type { SegmentNode } from './segment-tree';

import { forEachStaticChild, hasAnyStaticChild } from './segment-tree';

export function compactSegmentTree(root: SegmentNode): void {
  const prefixIntern = new Map<string, string[]>();
  const internPrefix = (parts: string[]): string[] => {
    const key = parts.join('\x00');
    const existing = prefixIntern.get(key);
    if (existing !== undefined) {
      return existing;
    }
    prefixIntern.set(key, parts);
    return parts;
  };

  const stack: SegmentNode[] = [root];
  const visited = new Set<SegmentNode>();
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (visited.has(node)) {
      continue;
    }
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

export function peekSingleStaticChild(target: SegmentNode): { key: string; child: SegmentNode; many: boolean } {
  if (target.singleChildKey !== null && target.singleChildNext !== null) {
    return { key: target.singleChildKey, child: target.singleChildNext, many: false };
  }
  let only: string | null = null;
  let onlyChild: SegmentNode | null = null;
  let many = false;
  for (const k in target.staticChildren!) {
    if (only === null) {
      only = k;
      onlyChild = target.staticChildren![k]!;
    } else {
      many = true;
      break;
    }
  }
  return { key: only!, child: onlyChild!, many };
}

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
    if (peek.many || peek.key === null || peek.child === null) {
      break;
    }
    folded.push(peek.key);
    target = peek.child;
  }
  return { target, folded };
}

export function extendStaticPrefix(folded: string[], existing: string[] | null): string[] {
  return existing === null ? folded : [...folded, ...existing];
}

export function rewireStaticChild(parent: SegmentNode, key: string, target: SegmentNode): void {
  if (parent.singleChildKey === key) {
    parent.singleChildNext = target;
    return;
  }
  if (parent.staticChildren !== null && key in parent.staticChildren) {
    parent.staticChildren[key] = target;
  }
}

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

    forEachStaticChild(node, (_, child) => {
      stack.push(child);
    });

    let p = node.paramChild;

    while (p !== null) {
      stack.push(p.next);
      p = p.nextSibling;
    }
  }

  return false;
}
