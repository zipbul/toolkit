/**
 * Direct unit specs for tree-helper internals exercised indirectly by
 * the segment-tree insert + traversal code paths. The integration tests
 * cover the whole pipeline; these tests pin the per-helper contract so
 * a regression in one helper surfaces as a single named failure
 * instead of a wide downstream blast.
 */
import { describe, expect, it } from 'bun:test';

import {
  createSegmentNode,
  type SegmentNode,
} from './segment-tree';
import {
  extendStaticPrefix,
  foldStaticChain,
  peekSingleStaticChild,
  rewireStaticChild,
} from './traversal';

function inlineChain(...keys: string[]): SegmentNode {
  // Build a singleChildKey chain `keys[0]` → `keys[1]` → ... → store=0.
  const root = createSegmentNode();
  let cur = root;
  for (const k of keys) {
    const next = createSegmentNode();
    cur.singleChildKey = k;
    cur.singleChildNext = next;
    cur = next;
  }
  cur.store = 0;
  return root;
}

describe('extendStaticPrefix', () => {
  it('returns the folded array unchanged when the target had no prior prefix', () => {
    expect(extendStaticPrefix(['a', 'b'], null)).toEqual(['a', 'b']);
  });

  it('concatenates folded onto an existing prefix', () => {
    expect(extendStaticPrefix(['a', 'b'], ['c', 'd'])).toEqual(['a', 'b', 'c', 'd']);
  });

  it('returns a fresh array (does not mutate either input)', () => {
    const folded = ['a'];
    const existing = ['b'];
    const out = extendStaticPrefix(folded, existing);
    expect(out).not.toBe(folded);
    expect(out).not.toBe(existing);
    expect(folded).toEqual(['a']);
    expect(existing).toEqual(['b']);
  });
});

describe('peekSingleStaticChild', () => {
  it('returns the inline single-child slot when present', () => {
    const node = createSegmentNode();
    const child = createSegmentNode();
    node.singleChildKey = 'users';
    node.singleChildNext = child;
    const peek = peekSingleStaticChild(node);
    expect(peek.key).toBe('users');
    expect(peek.child).toBe(child);
    expect(peek.many).toBe(false);
  });

  it('returns the single Record entry and many=false when the Record has exactly one key', () => {
    const node = createSegmentNode();
    const child = createSegmentNode();
    node.staticChildren = Object.create(null) as Record<string, SegmentNode>;
    node.staticChildren['only'] = child;
    const peek = peekSingleStaticChild(node);
    expect(peek.key).toBe('only');
    expect(peek.child).toBe(child);
    expect(peek.many).toBe(false);
  });

  it('returns many=true when the Record carries 2+ keys', () => {
    const node = createSegmentNode();
    node.staticChildren = Object.create(null) as Record<string, SegmentNode>;
    node.staticChildren['a'] = createSegmentNode();
    node.staticChildren['b'] = createSegmentNode();
    const peek = peekSingleStaticChild(node);
    expect(peek.many).toBe(true);
  });
});

describe('foldStaticChain', () => {
  it('returns target=start with empty folded for a node carrying a store', () => {
    const node = createSegmentNode();
    node.store = 5;
    const out = foldStaticChain(node);
    expect(out.target).toBe(node);
    expect(out.folded).toEqual([]);
  });

  it('walks the chain when each link has exactly one inline child', () => {
    const root = inlineChain('a', 'b', 'c');
    // root → a (no store) → b (no store) → c (store=0). foldStaticChain
    // walks while there's a single static child with no store; it stops
    // at the first node carrying a store.
    const out = foldStaticChain(root.singleChildNext!);
    expect(out.folded).toEqual(['b', 'c']);
    expect(out.target.store).toBe(0);
  });

  it('stops at a node with a paramChild — folds up to but not past the mixed node', () => {
    const root = createSegmentNode();
    const mid = createSegmentNode();
    root.singleChildKey = 'a';
    root.singleChildNext = mid;
    // mid carries a paramChild. foldStaticChain consumes the `a` link
    // (mid is reachable via a single static child of root) but stops at
    // mid because mid itself can't continue folding — it carries a
    // paramChild which disqualifies further chain compression.
    mid.paramChild = {
      name: 'id',
      tester: null,
      patternSource: null,
      ownerRouteID: 0,
      next: createSegmentNode(),
      nextSibling: null,
    };
    const out = foldStaticChain(root);
    expect(out.folded).toEqual(['a']);
    expect(out.target).toBe(mid);
  });
});

describe('rewireStaticChild', () => {
  it('updates the inline-slot pointer when the key matches singleChildKey', () => {
    const parent = createSegmentNode();
    const oldChild = createSegmentNode();
    const newChild = createSegmentNode();
    parent.singleChildKey = 'a';
    parent.singleChildNext = oldChild;
    rewireStaticChild(parent, 'a', newChild);
    expect(parent.singleChildNext).toBe(newChild);
  });

  it('updates the Record entry when the key sits in staticChildren', () => {
    const parent = createSegmentNode();
    const oldChild = createSegmentNode();
    const newChild = createSegmentNode();
    parent.staticChildren = Object.create(null) as Record<string, SegmentNode>;
    parent.staticChildren['a'] = oldChild;
    rewireStaticChild(parent, 'a', newChild);
    expect(parent.staticChildren['a']).toBe(newChild);
  });

  it('is a no-op when the key is unknown to the parent', () => {
    const parent = createSegmentNode();
    rewireStaticChild(parent, 'missing', createSegmentNode());
    expect(parent.singleChildKey).toBeNull();
    expect(parent.staticChildren).toBeNull();
  });
});
