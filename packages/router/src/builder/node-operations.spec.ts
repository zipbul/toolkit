import { describe, it, expect } from 'bun:test';

import { NodeKind } from '../schema';
import { Node } from './node';
import { NodeFactory } from './node-pool';
import { matchStaticParts, sortParamChildren, splitStaticChain } from './node-operations';

const pool = new NodeFactory();

function makeNode(kind: NodeKind, segment: string): Node {
  return pool.acquire(kind, segment);
}

describe('matchStaticParts', () => {
  it('should return parts.length when all parts match from startIdx', () => {
    const parts = ['a', 'b'];
    const segments = ['a', 'b', 'c'];
    const count = matchStaticParts(parts, segments, 0);

    expect(count).toBe(2);
  });

  it('should return 0 when first part does not match', () => {
    const parts = ['x'];
    const segments = ['a', 'b'];
    const count = matchStaticParts(parts, segments, 0);

    expect(count).toBe(0);
  });

  it('should stop counting at first mismatch and return matched count', () => {
    const parts = ['a', 'z', 'c'];
    const segments = ['a', 'b', 'c'];
    const count = matchStaticParts(parts, segments, 0);

    expect(count).toBe(1);
  });

  it('should match starting from the given startIdx offset', () => {
    const parts = ['b', 'c'];
    const segments = ['a', 'b', 'c'];
    const count = matchStaticParts(parts, segments, 1);

    expect(count).toBe(2);
  });
});

describe('splitStaticChain', () => {
  it('should split node into prefix and suffix at the given index', () => {
    const node = makeNode(NodeKind.Static, 'a/b/c');
    node.segmentParts = ['a', 'b', 'c'];

    splitStaticChain(node, 1, pool);

    expect(node.segment).toBe('a');
    expect(node.segmentParts).toBeUndefined(); // single-part prefix has no segmentParts
    expect(node.staticChildren.size).toBe(1);
  });

  it('should do nothing when segmentParts is undefined', () => {
    const node = makeNode(NodeKind.Static, 'users');
    node.segmentParts = undefined;

    expect(() => splitStaticChain(node, 1, pool)).not.toThrow();
    expect(node.staticChildren.size).toBe(0);
  });

  it('should do nothing when splitIndex is 0', () => {
    const node = makeNode(NodeKind.Static, 'a/b');
    node.segmentParts = ['a', 'b'];

    splitStaticChain(node, 0, pool);

    expect(node.staticChildren.size).toBe(0);
  });

  it('should do nothing when splitIndex equals parts.length', () => {
    const node = makeNode(NodeKind.Static, 'a/b');
    node.segmentParts = ['a', 'b'];

    splitStaticChain(node, 2, pool); // splitIndex === parts.length (2)

    expect(node.staticChildren.size).toBe(0);
  });
});

describe('sortParamChildren', () => {
  it('should do nothing when node has fewer than 2 param children', () => {
    const node = makeNode(NodeKind.Param, ':id');
    node.paramChildren = [makeNode(NodeKind.Param, ':x')];

    sortParamChildren(node);

    expect(node.paramChildren.length).toBe(1);
  });

  it('should sort node with pattern before node without pattern', () => {
    const withPattern = makeNode(NodeKind.Param, ':id');
    withPattern.pattern = /^\d+$/;
    withPattern.patternSource = '\\d+';

    const noPattern = makeNode(NodeKind.Param, ':slug');

    const node = makeNode(NodeKind.Param, ':x');
    node.paramChildren = [noPattern, withPattern];

    sortParamChildren(node);

    expect(node.paramChildren[0]).toBe(withPattern);
    expect(node.paramChildren[1]).toBe(noPattern);
  });

  it('should sort longer patternSource before shorter when both have patterns', () => {
    const longPattern = makeNode(NodeKind.Param, ':id');
    longPattern.pattern = /^[a-zA-Z0-9]+$/;
    longPattern.patternSource = '[a-zA-Z0-9]+'; // 13 chars

    const shortPattern = makeNode(NodeKind.Param, ':code');
    shortPattern.pattern = /^\d+$/;
    shortPattern.patternSource = '\\d+'; // 4 chars

    const node = makeNode(NodeKind.Param, ':x');
    node.paramChildren = [shortPattern, longPattern];

    sortParamChildren(node);

    expect(node.paramChildren[0]).toBe(longPattern);
    expect(node.paramChildren[1]).toBe(shortPattern);
  });
});
