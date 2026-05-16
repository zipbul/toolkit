/**
 * Unit spec for `factor-detect.ts`. Targets the WeakMap-backed factor
 * store + the `detectTenantFactor` pure function. Operates on raw
 * SegmentNode fixtures so each branch is exercised in isolation.
 */
import { describe, expect, it } from 'bun:test';

import { createSegmentNode, type SegmentNode } from './segment-tree';
import {
  detectTenantFactor,
  getTenantFactor,
  setTenantFactor,
} from './factor-detect';

function leafWithStore(store: number): SegmentNode {
  const node = createSegmentNode();
  node.store = store;
  return node;
}

function rootWithSiblings(count: number, makeLeaf: (i: number) => SegmentNode): SegmentNode {
  const root = createSegmentNode();
  root.staticChildren = Object.create(null) as Record<string, SegmentNode>;
  for (let i = 0; i < count; i++) {
    root.staticChildren[`tenant-${i}`] = makeLeaf(i);
  }
  return root;
}

describe('getTenantFactor / setTenantFactor', () => {
  it('returns undefined when no factor is stored for the node', () => {
    const node = createSegmentNode();
    expect(getTenantFactor(node)).toBeUndefined();
  });

  it('returns the stored factor after setTenantFactor', () => {
    const node = createSegmentNode();
    const factor = { keyToTerminal: new Map<string, number>(), sharedNext: createSegmentNode() };
    setTenantFactor(node, factor);
    expect(getTenantFactor(node)).toBe(factor);
  });

  it('stores factors per-node (no cross-node leakage)', () => {
    const a = createSegmentNode();
    const b = createSegmentNode();
    const factorA = { keyToTerminal: new Map<string, number>(), sharedNext: createSegmentNode() };
    setTenantFactor(a, factorA);
    expect(getTenantFactor(b)).toBeUndefined();
  });
});

describe('detectTenantFactor — disqualifiers', () => {
  it('returns null when root has a store of its own', () => {
    const root = rootWithSiblings(1000, leafWithStore);
    root.store = 1;
    expect(detectTenantFactor(root)).toBeNull();
  });

  it('returns null when root has a paramChild', () => {
    const root = rootWithSiblings(1000, leafWithStore);
    root.paramChild = {
      name: 'id',
      tester: null,
      patternSource: null,
      ownerRouteID: 0,
      next: createSegmentNode(),
      nextSibling: null,
    };
    expect(detectTenantFactor(root)).toBeNull();
  });

  it('returns null when root has a wildcardStore', () => {
    const root = rootWithSiblings(1000, leafWithStore);
    root.wildcardStore = 1;
    expect(detectTenantFactor(root)).toBeNull();
  });

  it('returns null when root has no staticChildren', () => {
    const root = createSegmentNode();
    expect(detectTenantFactor(root)).toBeNull();
  });

  it('returns null when sibling count is below the minSiblings threshold', () => {
    const root = rootWithSiblings(500, leafWithStore);
    expect(detectTenantFactor(root, 1000)).toBeNull();
  });

  it('returns null when one sibling has no unique terminal store', () => {
    const root = rootWithSiblings(1000, leafWithStore);
    // Mutate one sibling to remove the leaf store
    (root.staticChildren!['tenant-5']!).store = null;
    expect(detectTenantFactor(root)).toBeNull();
  });

  it('returns null when sibling subtree shapes differ (one has paramChild, others do not)', () => {
    const root = rootWithSiblings(1000, leafWithStore);
    const odd = createSegmentNode();
    odd.paramChild = {
      name: 'id',
      tester: null,
      patternSource: null,
      ownerRouteID: 0,
      next: leafWithStore(99),
      nextSibling: null,
    };
    root.staticChildren!['tenant-7'] = odd;
    expect(detectTenantFactor(root)).toBeNull();
  });
});

describe('detectTenantFactor — happy path', () => {
  it('returns a factor mapping every key to its leaf store', () => {
    const root = rootWithSiblings(1500, (i) => leafWithStore(i + 100));
    const factor = detectTenantFactor(root);
    expect(factor).not.toBeNull();
    expect(factor!.keyToTerminal.size).toBe(1500);
    expect(factor!.keyToTerminal.get('tenant-0')).toBe(100);
    expect(factor!.keyToTerminal.get('tenant-1499')).toBe(1599);
  });

  it('uses the first sibling as the canonical sharedNext', () => {
    const root = rootWithSiblings(1500, leafWithStore);
    const first = root.staticChildren!['tenant-0']!;
    const factor = detectTenantFactor(root);
    expect(factor!.sharedNext).toBe(first);
  });

  it('honors a custom minSiblings threshold', () => {
    const root = rootWithSiblings(500, leafWithStore);
    expect(detectTenantFactor(root, 100)).not.toBeNull();
  });
});

describe('detectTenantFactor — leafStoreOf descent shapes', () => {
  it('walks through a single paramChild chain to the unique terminal store', () => {
    const root = rootWithSiblings(1500, (i) => {
      const top = createSegmentNode();
      top.paramChild = {
        name: 'id',
        tester: null,
        patternSource: null,
        ownerRouteID: 0,
        next: leafWithStore(i),
        nextSibling: null,
      };
      return top;
    });
    expect(detectTenantFactor(root)).not.toBeNull();
  });

  it('walks through a singleChildKey static chain to the unique terminal store', () => {
    const root = rootWithSiblings(1500, (i) => {
      const top = createSegmentNode();
      top.singleChildKey = 'users';
      top.singleChildNext = leafWithStore(i);
      return top;
    });
    expect(detectTenantFactor(root)).not.toBeNull();
  });

  it('rejects subtrees whose intermediate node carries both a store and descendants', () => {
    const root = rootWithSiblings(1500, (i) => {
      const intermediate = createSegmentNode();
      intermediate.store = i;
      intermediate.singleChildKey = 'users';
      intermediate.singleChildNext = leafWithStore(i + 10000);
      return intermediate;
    });
    expect(detectTenantFactor(root)).toBeNull();
  });
});
