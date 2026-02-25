import { describe, it, expect } from 'bun:test';

import {
  NodeKind,
  NODE_STRIDE,
  NODE_OFFSET_METHODS_PTR,
  NODE_OFFSET_METHOD_MASK,
  NODE_OFFSET_STATIC_CHILD_PTR,
  NODE_OFFSET_STATIC_CHILD_COUNT,
  METHOD_OFFSET,
} from '../schema';
import { Node } from './node';
import { flatten } from './flattener';

function makeNode(kind: NodeKind, segment: string): Node {
  return new Node(kind, segment);
}

describe('flatten()', () => {
  describe('single root node', () => {
    it('should produce nodeBuffer with exactly NODE_STRIDE words for a single node', () => {
      const root = makeNode(NodeKind.Static, '/');
      const layout = flatten(root);
      expect(layout.nodeBuffer.length).toBe(NODE_STRIDE);
    });

    it('should have rootIndex = 0', () => {
      const root = makeNode(NodeKind.Static, '/');
      const layout = flatten(root);
      expect(layout.rootIndex).toBe(0);
    });

    it('should produce an empty methodsBuffer sentinel of 1 word for node without methods', () => {
      const root = makeNode(NodeKind.Static, '/');
      const layout = flatten(root);
      // methodsBuffer[0] is the sentinel (0)
      expect(layout.methodsBuffer[0]).toBe(0);
      // METHODS_PTR in nodeBuffer should point to sentinel (0)
      expect(layout.nodeBuffer[NODE_OFFSET_METHODS_PTR]).toBe(0);
    });
  });

  describe('node with methods', () => {
    it('should set methodMask bit for GET method', () => {
      const root = makeNode(NodeKind.Static, '/');
      root.methods.byMethod.set('GET', 42);
      const layout = flatten(root);
      const methodMask = layout.nodeBuffer[NODE_OFFSET_METHOD_MASK]!;
      expect(methodMask & (1 << METHOD_OFFSET.GET)).toBeTruthy();
    });

    it('should write method entries to methodsBuffer', () => {
      const root = makeNode(NodeKind.Static, '/');
      root.methods.byMethod.set('POST', 99);
      const layout = flatten(root);
      const ptr = layout.nodeBuffer[NODE_OFFSET_METHODS_PTR]!;
      expect(ptr).toBeGreaterThan(0);
      // methodsBuffer[ptr] = method code (POST=1), [ptr+1] = key=99
      expect(layout.methodsBuffer[ptr]).toBe(METHOD_OFFSET.POST);
      expect(layout.methodsBuffer[ptr + 1]).toBe(99);
    });

    it('should set multiple method bits in methodMask', () => {
      const root = makeNode(NodeKind.Static, '/');
      root.methods.byMethod.set('GET', 1);
      root.methods.byMethod.set('POST', 2);
      const layout = flatten(root);
      const mask = layout.nodeBuffer[NODE_OFFSET_METHOD_MASK]!;
      expect(mask & (1 << METHOD_OFFSET.GET)).toBeTruthy();
      expect(mask & (1 << METHOD_OFFSET.POST)).toBeTruthy();
    });
  });

  describe('node with static children', () => {
    it('should record static child count in nodeBuffer', () => {
      const root = makeNode(NodeKind.Static, '/');
      const child = makeNode(NodeKind.Static, 'api');
      root.staticChildren.set('api', child);
      const layout = flatten(root);
      expect(layout.nodeBuffer[NODE_OFFSET_STATIC_CHILD_COUNT]).toBe(1);
    });

    it('should set static child pointer in nodeBuffer', () => {
      const root = makeNode(NodeKind.Static, '/');
      const child = makeNode(NodeKind.Static, 'v1');
      root.staticChildren.set('v1', child);
      const layout = flatten(root);
      const ptr = layout.nodeBuffer[NODE_OFFSET_STATIC_CHILD_PTR]!;
      expect(ptr).toBeGreaterThanOrEqual(0);
      expect(layout.staticChildrenBuffer.length).toBeGreaterThan(0);
    });

    it('should produce nodeBuffer for both root and child', () => {
      const root = makeNode(NodeKind.Static, '/');
      const child = makeNode(NodeKind.Static, 'users');
      root.staticChildren.set('users', child);
      const layout = flatten(root);
      // 2 nodes × NODE_STRIDE words
      expect(layout.nodeBuffer.length).toBe(2 * NODE_STRIDE);
    });
  });

  describe('param node', () => {
    it('should include param node in nodeBuffer', () => {
      const root = makeNode(NodeKind.Static, '/');
      const param = makeNode(NodeKind.Param, ':id');
      root.paramChildren.push(param);
      const layout = flatten(root);
      expect(layout.nodeBuffer.length).toBe(2 * NODE_STRIDE);
    });
  });

  describe('string table', () => {
    it('should produce a Uint8Array stringTable', () => {
      const root = makeNode(NodeKind.Static, '/');
      const child = makeNode(NodeKind.Static, 'hello');
      root.staticChildren.set('hello', child);
      const layout = flatten(root);
      expect(layout.stringTable).toBeInstanceOf(Uint8Array);
      expect(layout.stringTable.length).toBeGreaterThan(0);
    });

    it('should include decodedStrings array', () => {
      const root = makeNode(NodeKind.Static, '/');
      root.staticChildren.set('world', makeNode(NodeKind.Static, 'world'));
      const layout = flatten(root);
      expect(layout.decodedStrings).toContain('world');
    });
  });
});
