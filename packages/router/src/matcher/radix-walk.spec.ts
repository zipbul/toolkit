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

    it('should match long labels (>=15 chars) using substring comparison', () => {
      const root = createRadixNode('');
      const longLabel = '/very-long-label-exceeding-fifteen';
      const child = createRadixNode(longLabel);
      child.store = 0;
      root.inert = { [47]: child };

      const fn = createRadixWalker(root, [], decoder, true);
      const result = walk(fn, longLabel);

      expect(result).not.toBeNull();
      expect(result!.handlerIndex).toBe(0);
    });

    it('should fail long label when mismatch', () => {
      const root = createRadixNode('');
      const longLabel = '/very-long-label-exceeding-fifteen';
      const child = createRadixNode(longLabel);
      child.store = 0;
      root.inert = { [47]: child };

      const fn = createRadixWalker(root, [], decoder, true);
      const result = walk(fn, '/very-long-label-exceeding-fiftXX');

      expect(result).toBeNull();
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

    it('should return null when terminal param has inert continuation but URL is exhausted', () => {
      const root = createRadixNode('');
      const usersNode = createRadixNode('/users/');
      usersNode.params = createParamNode('id');
      // param has no store, only inert continuation
      usersNode.params.inert = createRadixNode('/posts');
      usersNode.params.inert.store = 0;

      root.inert = { [47]: usersNode };

      const fn = createRadixWalker(root, [], decoder, true);
      // URL exhausts at param — inert continuation /posts can't match
      const result = walk(fn, '/users/123');

      expect(result).toBeNull();
    });

    it('should return null when param value is empty (slash at pos)', () => {
      const root = createRadixNode('');
      const usersNode = createRadixNode('/users/');
      usersNode.params = createParamNode('id');
      usersNode.params.store = 0;

      root.inert = { [47]: usersNode };

      const fn = createRadixWalker(root, [], decoder, true);
      // "/users/" — param pos starts at 7, slash at 7 → endIdx === pos → no match
      const result = walk(fn, '/users/');

      expect(result).toBeNull();
    });
  });

  describe('pattern tester', () => {
    it('should match param with passing tester', () => {
      const root = createRadixNode('');
      const usersNode = createRadixNode('/users/');
      usersNode.params = createParamNode('id');
      usersNode.params.pattern = /^\d+$/;
      usersNode.params.store = 0;

      root.inert = { [47]: usersNode };

      const digitTester = (v: string) => /^\d+$/.test(v);
      const fn = createRadixWalker(root, [digitTester], decoder, true);
      const result = walk(fn, '/users/42');

      expect(result).not.toBeNull();
      expect(result!.params.id).toBe('42');
    });

    it('should reject param when tester returns false', () => {
      const root = createRadixNode('');
      const usersNode = createRadixNode('/users/');
      usersNode.params = createParamNode('id');
      usersNode.params.pattern = /^\d+$/;
      usersNode.params.store = 0;

      root.inert = { [47]: usersNode };

      const digitTester = (v: string) => /^\d+$/.test(v);
      const fn = createRadixWalker(root, [digitTester], decoder, true);
      const result = walk(fn, '/users/abc');

      expect(result).toBeNull();
    });

    it('should set errorKind when tester throws', () => {
      const root = createRadixNode('');
      const usersNode = createRadixNode('/users/');
      usersNode.params = createParamNode('id');
      usersNode.params.pattern = /^\d+$/;
      usersNode.params.store = 0;

      root.inert = { [47]: usersNode };

      const throwingTester = () => { throw new Error('regex timeout!'); };
      const fn = createRadixWalker(root, [throwingTester], decoder, true);

      const state = createMatchState();
      const result = fn('/users/123', 0, state);

      expect(result).toBe(false);
      expect(state.errorKind).toBe('regex-timeout');
      expect(state.errorMessage).toBe('regex timeout!');
    });

    it('should set errorMessage from non-Error throw', () => {
      const root = createRadixNode('');
      const usersNode = createRadixNode('/users/');
      usersNode.params = createParamNode('id');
      usersNode.params.pattern = /^\d+$/;
      usersNode.params.store = 0;

      root.inert = { [47]: usersNode };

      const throwingTester = () => { throw 'string error'; };
      const fn = createRadixWalker(root, [throwingTester], decoder, true);

      const state = createMatchState();
      const result = fn('/users/123', 0, state);

      expect(result).toBe(false);
      expect(state.errorKind).toBe('regex-timeout');
      expect(state.errorMessage).toBe('string error');
    });

    it('should propagate error from static child when node has alternatives', () => {
      const root = createRadixNode('');
      const prefixNode = createRadixNode('/items/');

      // Static child that leads to a param with throwing tester
      const staticChild = createRadixNode('special/');
      staticChild.params = createParamNode('id');
      staticChild.params.pattern = /^\d+$/;
      staticChild.params.store = 0;
      prefixNode.inert = { ['s'.charCodeAt(0)]: staticChild };

      // Also has a param fallback → triggers slow path (backtracking)
      prefixNode.params = createParamNode('name');
      prefixNode.params.store = 1;

      root.inert = { [47]: prefixNode };

      const throwingTester = () => { throw new Error('timeout!'); };
      const fn = createRadixWalker(root, [throwingTester], decoder, true);

      const state = createMatchState();
      const result = fn('/items/special/abc', 0, state);

      expect(result).toBe(false);
      expect(state.errorKind).toBe('regex-timeout');
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

    it('should match star wildcard with empty via trailing-slash edge case', () => {
      // Label "/files/", URL "/files" — trailing slash stripped by preNormalize
      const root = createRadixNode('');
      const filesNode = createRadixNode('/files/');
      filesNode.wildcardStore = 0;
      filesNode.wildcardName = 'path';
      filesNode.wildcardOrigin = 'star';

      root.inert = { [47]: filesNode };

      const fn = createRadixWalker(root, [], decoder, true);
      const result = walk(fn, '/files');

      expect(result).not.toBeNull();
      expect(result!.params.path).toBe('');
    });

    it('should reject trailing-slash edge case for non-star wildcard', () => {
      const root = createRadixNode('');
      const filesNode = createRadixNode('/files/');
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

    it('should backtrack from static child to param when static fails', () => {
      const root = createRadixNode('');
      const prefixNode = createRadixNode('/api/');

      // Static child that requires a deeper continuation
      const staticChild = createRadixNode('admin/');
      staticChild.params = createParamNode('section');
      staticChild.params.store = 0;
      prefixNode.inert = { ['a'.charCodeAt(0)]: staticChild };

      // Param fallback
      prefixNode.params = createParamNode('resource');
      prefixNode.params.store = 1;

      root.inert = { [47]: prefixNode };

      const fn = createRadixWalker(root, [], decoder, true);

      // "admin" starts with 'a' so static child is tried first,
      // but "admin" alone doesn't match "admin/" (needs more chars)
      // So backtrack to param
      const result = walk(fn, '/api/admin');
      expect(result).not.toBeNull();
      expect(result!.handlerIndex).toBe(1);
      expect(result!.params.resource).toBe('admin');
    });
  });
});
