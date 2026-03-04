import { describe, it, expect } from 'bun:test';

import { createRadixNode, createParamNode } from './radix-node';

describe('createRadixNode', () => {
  it('should set part from argument', () => {
    const node = createRadixNode('/users');
    expect(node.part).toBe('/users');
  });

  it('should initialize store as null', () => {
    const node = createRadixNode('');
    expect(node.store).toBeNull();
  });

  it('should initialize inert as null', () => {
    const node = createRadixNode('');
    expect(node.inert).toBeNull();
  });

  it('should initialize params as null', () => {
    const node = createRadixNode('');
    expect(node.params).toBeNull();
  });

  it('should initialize wildcardStore as null', () => {
    const node = createRadixNode('');
    expect(node.wildcardStore).toBeNull();
  });

  it('should initialize wildcardName as null', () => {
    const node = createRadixNode('');
    expect(node.wildcardName).toBeNull();
  });

  it('should initialize wildcardOrigin as null', () => {
    const node = createRadixNode('');
    expect(node.wildcardOrigin).toBeNull();
  });

  it('should create root node with empty string', () => {
    const root = createRadixNode('');
    expect(root.part).toBe('');
  });

  it('should allow mutation of properties', () => {
    const node = createRadixNode('/api');
    node.store = 0;
    node.wildcardStore = 1;
    node.wildcardName = 'path';
    node.wildcardOrigin = 'star';

    expect(node.store).toBe(0);
    expect(node.wildcardStore).toBe(1);
    expect(node.wildcardName).toBe('path');
    expect(node.wildcardOrigin).toBe('star');
  });

  it('should allow building a simple tree structure', () => {
    const root = createRadixNode('');
    const child = createRadixNode('/users');

    root.inert = { [47]: child }; // charCode for '/'

    expect(root.inert[47]).toBe(child);
    expect(root.inert[47]!.part).toBe('/users');
  });
});

describe('createParamNode', () => {
  it('should set name from argument', () => {
    const node = createParamNode('id');
    expect(node.name).toBe('id');
  });

  it('should initialize store as null', () => {
    const node = createParamNode('id');
    expect(node.store).toBeNull();
  });

  it('should initialize inert as null', () => {
    const node = createParamNode('id');
    expect(node.inert).toBeNull();
  });

  it('should initialize pattern as null', () => {
    const node = createParamNode('id');
    expect(node.pattern).toBeNull();
  });

  it('should initialize patternSource as null', () => {
    const node = createParamNode('id');
    expect(node.patternSource).toBeNull();
  });

  it('should initialize next as null', () => {
    const node = createParamNode('id');
    expect(node.next).toBeNull();
  });

  it('should allow mutation of properties', () => {
    const node = createParamNode('id');
    node.store = 5;
    node.pattern = /^\d+$/;
    node.patternSource = '^\\d+$';

    expect(node.store).toBe(5);
    expect(node.pattern).toEqual(/^\d+$/);
    expect(node.patternSource).toBe('^\\d+$');
  });

  it('should support building a chain via next', () => {
    const first = createParamNode('id');
    const second = createParamNode('name');

    first.next = second;

    expect(first.next).toBe(second);
    expect(first.next.name).toBe('name');
    expect(second.next).toBeNull();
  });
});
