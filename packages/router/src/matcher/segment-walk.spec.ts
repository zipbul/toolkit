import { describe, expect, it } from 'bun:test';

import type { SegmentNode } from '../tree';

import { WildcardOrigin, createSegmentNode, setTenantFactor } from '../tree';
import { createMatchState } from './match-state';
import { createSegmentWalker } from './segment-walk';

const identityDecoder = (s: string) => s;

function leafWithStore(store: number): SegmentNode {
  const node = createSegmentNode();
  node.store = store;
  return node;
}

function manyStaticChildren(count: number, makeChild: (i: number) => SegmentNode): SegmentNode {
  const root = createSegmentNode();
  root.staticChildren = Object.create(null) as Record<string, SegmentNode>;
  for (let i = 0; i < count; i++) {
    root.staticChildren[`k${i}`] = makeChild(i);
  }
  return root;
}

describe('createSegmentWalker — factored tier (root has stored TenantFactor)', () => {
  it('uses the factor descriptor to dispatch by first segment + walk shared subtree', () => {
    const root = createSegmentNode();
    const shared = leafWithStore(0);
    const keyToTerminal = new Map<string, number>([
      ['tenant-0', 100],
      ['tenant-1', 101],
    ]);
    setTenantFactor(root, { keyToTerminal, sharedNext: shared });

    const walker = createSegmentWalker(root, identityDecoder, createMatchState(2));
    const state = createMatchState(2);
    expect(walker('/tenant-0', state)).toBe(true);
    expect(state.handlerIndex).toBe(100);

    const state2 = createMatchState(2);
    expect(walker('/tenant-1', state2)).toBe(true);
    expect(state2.handlerIndex).toBe(101);

    const state3 = createMatchState(2);
    expect(walker('/tenant-9999', state3)).toBe(false);
  });
});

describe('createSegmentWalker — static-prefix wildcard codegen tier', () => {
  it('returns the compiled walker for a /<prefix>/*tail topology', () => {
    const root = createSegmentNode();
    root.staticChildren = Object.create(null) as Record<string, SegmentNode>;
    const child = createSegmentNode();
    child.wildcardStore = 7;
    child.wildcardName = 'path';
    child.wildcardOrigin = WildcardOrigin.Star;
    root.staticChildren['files'] = child;

    const walker = createSegmentWalker(root, identityDecoder, createMatchState(2));
    expect(walker.name).toBe('compiledWildWalk');

    const state = createMatchState(2);
    expect(walker('/files/a/b', state)).toBe(true);
    expect(state.handlerIndex).toBe(7);
  });
});

describe('createSegmentWalker — iterative tier (non-ambiguous, exceeds codegen budget)', () => {
  it('falls back to the iterative walker for wide non-ambiguous fanout', () => {
    const root = manyStaticChildren(400, i => leafWithStore(i + 1000));

    const walker = createSegmentWalker(root, identityDecoder, createMatchState(2));
    expect(walker.name).toBe('walk');

    const state = createMatchState(2);
    expect(walker('/k0', state)).toBe(true);
    expect(state.handlerIndex).toBe(1000);

    const state2 = createMatchState(2);
    expect(walker('/k399', state2)).toBe(true);
    expect(state2.handlerIndex).toBe(1399);
  });
});

describe('createSegmentWalker — recursive tier (ambiguous tree)', () => {
  it('falls back to the recursive walker for trees that need backtracking', () => {
    const root = createSegmentNode();
    root.staticChildren = Object.create(null) as Record<string, SegmentNode>;
    const apiStatic = createSegmentNode();
    apiStatic.singleChildKey = 'v1';
    const v1Node = createSegmentNode();
    v1Node.store = 1;
    apiStatic.singleChildNext = v1Node;
    root.staticChildren['api'] = apiStatic;

    root.paramChild = {
      name: 'ver',
      tester: null,
      patternSource: null,
      ownerRouteID: 0,
      next: (() => {
        const n = createSegmentNode();
        n.singleChildKey = 'users';
        const users = leafWithStore(2);
        n.singleChildNext = users;
        return n;
      })(),
      nextSibling: null,
    };

    const walker = createSegmentWalker(root, identityDecoder, createMatchState(4));
    expect(walker.name).toBe('walk');
  });
});

describe('createSegmentWalker — segment-tree codegen tier (small mixed tree)', () => {
  it('returns the compiledSegmentWalk codegen for a small param-bearing tree', () => {
    const root = createSegmentNode();
    root.singleChildKey = 'users';
    const usersNode = createSegmentNode();
    usersNode.paramChild = {
      name: 'id',
      tester: null,
      patternSource: null,
      ownerRouteID: 0,
      next: leafWithStore(5),
      nextSibling: null,
    };
    root.singleChildNext = usersNode;

    const walker = createSegmentWalker(root, identityDecoder, createMatchState(2));
    expect(walker.name).toBe('compiledSegmentWalk');
  });
});
