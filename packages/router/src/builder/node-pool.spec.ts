import { describe, it, expect } from 'bun:test';

import { NodeKind } from '../schema';
import { NodeFactory } from './node-pool';

describe('NodeFactory', () => {
  it('should acquire a Static node with correct kind and segment', () => {
    const factory = new NodeFactory();
    const node = factory.acquire(NodeKind.Static, 'users');

    expect(node.kind).toBe(NodeKind.Static);
    expect(node.segment).toBe('users');
  });

  it('should acquire a Param node with correct kind and segment', () => {
    const factory = new NodeFactory();
    const node = factory.acquire(NodeKind.Param, ':id');

    expect(node.kind).toBe(NodeKind.Param);
    expect(node.segment).toBe(':id');
  });

  it('should acquire a Wildcard node with correct kind and segment', () => {
    const factory = new NodeFactory();
    const node = factory.acquire(NodeKind.Wildcard, '*');

    expect(node.kind).toBe(NodeKind.Wildcard);
    expect(node.segment).toBe('*');
  });

  it('should return a fresh node with empty staticChildren, paramChildren and no wildcardChild', () => {
    const factory = new NodeFactory();
    const node = factory.acquire(NodeKind.Static, 'clean');

    expect(node.staticChildren.size).toBe(0);
    expect(node.paramChildren).toEqual([]);
    expect(node.wildcardChild).toBeUndefined();
  });
});
