import { describe, it, expect } from 'bun:test';

import { createRadixWalker } from './radix-walk';
import { createMatchState } from './match-state';
import { createRadixNode, createParamNode } from '../builder/radix-node';
import { buildDecoder } from '../processor/decoder';

const decoder = buildDecoder();

function walk(fn: ReturnType<typeof createRadixWalker>, url: string) {
  const state = createMatchState();
  const result = fn(url, 0, state);

  if (state.errorKind) throw new Error(`Walk error: ${state.errorKind}: ${state.errorMessage}`);
  if (!result) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < state.paramCount; i++) {
    params[state.paramNames[i]!] = state.paramValues[i]!;
  }

  return { handlerIndex: state.handlerIndex, params };
}

describe('createRadixWalker', () => {
  it('should return a function', () => {
    const root = createRadixNode('');
    const fn = createRadixWalker(root, [], decoder, true);
    expect(typeof fn).toBe('function');
  });

  describe('static matching', () => {
    it('should match a static route', () => {
      const root = createRadixNode('');
      const child = createRadixNode('/users');
      child.store = 0;
      root.inert = { [47]: child };

      const fn = createRadixWalker(root, [], decoder, true);
      const result = walk(fn, '/users');

      expect(result).not.toBeNull();
      expect(result!.handlerIndex).toBe(0);
    });

    it('should return false for non-matching path', () => {
      const root = createRadixNode('');
      const child = createRadixNode('/users');
      child.store = 0;
      root.inert = { [47]: child };

      const fn = createRadixWalker(root, [], decoder, true);
      const result = walk(fn, '/posts');

      expect(result).toBeNull();
    });

    it('should match with LCP-split tree', () => {
      const root = createRadixNode('');
      const uNode = createRadixNode('/u');
      uNode.inert = {};

      const sersNode = createRadixNode('sers');
      sersNode.store = 0;
      uNode.inert['s'.charCodeAt(0)] = sersNode;

      const tilsNode = createRadixNode('tils');
      tilsNode.store = 1;
      uNode.inert['t'.charCodeAt(0)] = tilsNode;

      root.inert = { [47]: uNode };

      const fn = createRadixWalker(root, [], decoder, true);

      const r1 = walk(fn, '/users');
      expect(r1).not.toBeNull();
      expect(r1!.handlerIndex).toBe(0);

      const r2 = walk(fn, '/utils');
      expect(r2).not.toBeNull();
      expect(r2!.handlerIndex).toBe(1);
    });
  });

  describe('param matching', () => {
    it('should match param and extract value', () => {
      const root = createRadixNode('');
      const usersNode = createRadixNode('/users/');
      usersNode.params = createParamNode('id');
      usersNode.params.store = 0;

      root.inert = { [47]: usersNode };

      const fn = createRadixWalker(root, [], decoder, true);
      const result = walk(fn, '/users/42');

      expect(result).not.toBeNull();
      expect(result!.handlerIndex).toBe(0);
      expect(result!.params.id).toBe('42');
    });

    it('should decode percent-encoded param values', () => {
      const root = createRadixNode('');
      const usersNode = createRadixNode('/users/');
      usersNode.params = createParamNode('name');
      usersNode.params.store = 0;

      root.inert = { [47]: usersNode };

      const fn = createRadixWalker(root, [], decoder, true);
      const result = walk(fn, '/users/hello%20world');

      expect(result).not.toBeNull();
      expect(result!.params.name).toBe('hello world');
    });

    it('should not decode when decodeParams=false', () => {
      const root = createRadixNode('');
      const usersNode = createRadixNode('/users/');
      usersNode.params = createParamNode('name');
      usersNode.params.store = 0;

      root.inert = { [47]: usersNode };

      const fn = createRadixWalker(root, [], decoder, false);
      const result = walk(fn, '/users/hello%20world');

      expect(result).not.toBeNull();
      expect(result!.params.name).toBe('hello%20world');
    });

    it('should match nested params', () => {
      const root = createRadixNode('');
      const usersNode = createRadixNode('/users/');
      usersNode.params = createParamNode('userId');
      usersNode.params.inert = createRadixNode('/posts/');
      usersNode.params.inert.params = createParamNode('postId');
      usersNode.params.inert.params.store = 0;

      root.inert = { [47]: usersNode };

      const fn = createRadixWalker(root, [], decoder, true);
      const result = walk(fn, '/users/1/posts/2');

      expect(result).not.toBeNull();
      expect(result!.handlerIndex).toBe(0);
      expect(result!.params.userId).toBe('1');
      expect(result!.params.postId).toBe('2');
    });
  });

  describe('wildcard matching', () => {
    it('should match star wildcard with value', () => {
      const root = createRadixNode('');
      const filesNode = createRadixNode('/files/');
      filesNode.wildcardStore = 0;
      filesNode.wildcardName = 'path';
      filesNode.wildcardOrigin = 'star';

      root.inert = { [47]: filesNode };

      const fn = createRadixWalker(root, [], decoder, true);
      const result = walk(fn, '/files/a/b/c');

      expect(result).not.toBeNull();
      expect(result!.params.path).toBe('a/b/c');
    });

    it('should match star wildcard with empty value', () => {
      const root = createRadixNode('');
      const filesNode = createRadixNode('/files');
      filesNode.wildcardStore = 0;
      filesNode.wildcardName = 'path';
      filesNode.wildcardOrigin = 'star';

      root.inert = { [47]: filesNode };

      const fn = createRadixWalker(root, [], decoder, true);
      const result = walk(fn, '/files');

      expect(result).not.toBeNull();
      expect(result!.params.path).toBe('');
    });

    it('should reject multi wildcard with empty value', () => {
      const root = createRadixNode('');
      const filesNode = createRadixNode('/files');
      filesNode.wildcardStore = 0;
      filesNode.wildcardName = 'path';
      filesNode.wildcardOrigin = 'multi';

      root.inert = { [47]: filesNode };

      const fn = createRadixWalker(root, [], decoder, true);
      const result = walk(fn, '/files');

      expect(result).toBeNull();
    });
  });

  describe('priority', () => {
    it('should prefer static children over param', () => {
      const root = createRadixNode('');
      const prefixNode = createRadixNode('/items/');

      // Static child
      const adminNode = createRadixNode('admin');
      adminNode.store = 0;
      prefixNode.inert = { ['a'.charCodeAt(0)]: adminNode };

      // Param child
      prefixNode.params = createParamNode('id');
      prefixNode.params.store = 1;

      root.inert = { [47]: prefixNode };

      const fn = createRadixWalker(root, [], decoder, true);

      const staticResult = walk(fn, '/items/admin');
      expect(staticResult).not.toBeNull();
      expect(staticResult!.handlerIndex).toBe(0);

      const paramResult = walk(fn, '/items/xyz');
      expect(paramResult).not.toBeNull();
      expect(paramResult!.handlerIndex).toBe(1);
    });

    it('should prefer param over wildcard', () => {
      const root = createRadixNode('');
      const prefixNode = createRadixNode('/files/');

      // Param child
      prefixNode.params = createParamNode('name');
      prefixNode.params.store = 0;

      // Wildcard
      prefixNode.wildcardStore = 1;
      prefixNode.wildcardName = 'rest';
      prefixNode.wildcardOrigin = 'star';

      root.inert = { [47]: prefixNode };

      const fn = createRadixWalker(root, [], decoder, true);

      const result = walk(fn, '/files/test');
      expect(result).not.toBeNull();
      // Param should match before wildcard for single-segment values
      expect(result!.handlerIndex).toBe(0);
    });
  });
});
