import type { SegmentNode } from './segment-tree';

interface TenantFactor {
  keyToTerminal: Map<string, number>;
  sharedNext: SegmentNode;
}

const tenantFactorStore = new WeakMap<SegmentNode, TenantFactor>();

function getTenantFactor(node: SegmentNode): TenantFactor | undefined {
  return tenantFactorStore.get(node);
}

function setTenantFactor(node: SegmentNode, factor: TenantFactor): void {
  tenantFactorStore.set(node, factor);
}

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

function subtreeShapesEqual(a: SegmentNode, b: SegmentNode): boolean {
  if ((a.store === null) !== (b.store === null)) {
    return false;
  }
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

function leafStoreOf(node: SegmentNode): number | null {
  let cur: SegmentNode = node;
  while (true) {
    if (cur.store !== null) {
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
    return null;
  }
}

export { detectTenantFactor, getTenantFactor, setTenantFactor };
export type { TenantFactor };
