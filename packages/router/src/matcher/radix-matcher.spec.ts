import { describe, it, expect } from 'bun:test';

import { countNodes } from './radix-matcher';
import { createRadixNode, createParamNode } from '../builder/radix-node';

describe('countNodes', () => {
  it('should count a single root node', () => {
    const root = createRadixNode('');
    expect(countNodes(root)).toBe(1);
  });

  it('should count root + inert children', () => {
    const root = createRadixNode('');
    root.inert = {
      [47]: createRadixNode('/users'),
      [97]: createRadixNode('api'),
    };

    expect(countNodes(root)).toBe(3);
  });

  it('should count param nodes', () => {
    const root = createRadixNode('');
    root.params = createParamNode('id');

    expect(countNodes(root)).toBe(2);
  });

  it('should count param chain', () => {
    const root = createRadixNode('');
    root.params = createParamNode('id');
    root.params.next = createParamNode('name');

    expect(countNodes(root)).toBe(3);
  });

  it('should count deeply nested tree', () => {
    const root = createRadixNode('');
    const child = createRadixNode('/users/');
    child.params = createParamNode('id');
    child.params.inert = createRadixNode('/posts');

    root.inert = { [47]: child };

    // root(1) + child(1) + param(1) + param.inert(1) = 4
    expect(countNodes(root)).toBe(4);
  });
});
