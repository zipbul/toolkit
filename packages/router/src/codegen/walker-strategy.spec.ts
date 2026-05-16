/**
 * Unit specs for `walker-strategy.ts` — `detectWildCodegenSpec` decides
 * whether a root SegmentNode matches the static-prefix wildcard codegen
 * shape (file-server topology). Spec pins each disqualifier so a future
 * tree-shape change surfaces here.
 */
import { describe, expect, it } from 'bun:test';

import { createSegmentNode } from '../tree';
import { detectWildCodegenSpec } from './walker-strategy';

describe('detectWildCodegenSpec', () => {
  function rootWithStaticChild(key: string, child = createSegmentNode()) {
    const root = createSegmentNode();
    root.staticChildren = Object.create(null) as Record<string, ReturnType<typeof createSegmentNode>>;
    root.staticChildren[key] = child;
    return root;
  }

  it('returns null when root has a paramChild (mixed shape)', () => {
    const root = rootWithStaticChild('files');
    root.paramChild = {
      name: 'id',
      tester: null,
      patternSource: null,
      ownerRouteID: 0,
      next: createSegmentNode(),
      nextSibling: null,
    };
    expect(detectWildCodegenSpec(root)).toBeNull();
  });

  it('returns null when root has a wildcardStore (no static layer)', () => {
    const root = rootWithStaticChild('files');
    root.wildcardStore = 1;
    expect(detectWildCodegenSpec(root)).toBeNull();
  });

  it('returns null when root carries its own store (root-terminal collides with prefix shape)', () => {
    const root = rootWithStaticChild('files');
    root.store = 1;
    expect(detectWildCodegenSpec(root)).toBeNull();
  });

  it('returns null when root has no staticChildren at all', () => {
    const root = createSegmentNode();
    expect(detectWildCodegenSpec(root)).toBeNull();
  });

  it('returns null when a child has its own staticChildren below the prefix', () => {
    const child = createSegmentNode();
    child.staticChildren = Object.create(null) as Record<string, ReturnType<typeof createSegmentNode>>;
    child.staticChildren['extra'] = createSegmentNode();
    expect(detectWildCodegenSpec(rootWithStaticChild('files', child))).toBeNull();
  });

  it('returns null when a child has a paramChild below the prefix', () => {
    const child = createSegmentNode();
    child.paramChild = {
      name: 'id',
      tester: null,
      patternSource: null,
      ownerRouteID: 0,
      next: createSegmentNode(),
      nextSibling: null,
    };
    expect(detectWildCodegenSpec(rootWithStaticChild('files', child))).toBeNull();
  });

  it('returns null when a child carries its own store (terminal sibling, not wildcard)', () => {
    const child = createSegmentNode();
    child.store = 5;
    expect(detectWildCodegenSpec(rootWithStaticChild('files', child))).toBeNull();
  });

  it('returns null when a child has no wildcardStore', () => {
    const child = createSegmentNode();
    expect(detectWildCodegenSpec(rootWithStaticChild('files', child))).toBeNull();
  });

  it('returns the entry list when each child is purely a wildcard terminal', () => {
    const child = createSegmentNode();
    child.wildcardStore = 7;
    child.wildcardName = 'path';
    child.wildcardOrigin = 'star';
    const spec = detectWildCodegenSpec(rootWithStaticChild('files', child));
    expect(spec).not.toBeNull();
    expect(spec).toHaveLength(1);
    expect(spec![0]).toEqual({
      prefix: 'files',
      wildcardOrigin: 'star',
      wildcardName: 'path',
      wildcardStore: 7,
    });
  });

  it('returns one entry per prefix when multiple prefixes share the shape', () => {
    const a = createSegmentNode();
    a.wildcardStore = 1;
    a.wildcardName = 'p1';
    a.wildcardOrigin = 'multi';
    const b = createSegmentNode();
    b.wildcardStore = 2;
    b.wildcardName = 'p2';
    b.wildcardOrigin = 'star';
    const root = createSegmentNode();
    root.staticChildren = Object.create(null) as Record<string, ReturnType<typeof createSegmentNode>>;
    root.staticChildren['static'] = a;
    root.staticChildren['files'] = b;
    const spec = detectWildCodegenSpec(root);
    expect(spec).toHaveLength(2);
  });

  it('returns null when staticChildren is empty after key enumeration', () => {
    const root = createSegmentNode();
    root.staticChildren = Object.create(null) as Record<string, ReturnType<typeof createSegmentNode>>;
    expect(detectWildCodegenSpec(root)).toBeNull();
  });
});
