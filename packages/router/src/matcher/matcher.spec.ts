import { describe, it, expect, beforeEach } from 'bun:test';

import { isErr } from '@zipbul/result';

import { NodeKind, METHOD_OFFSET } from '../schema';
import type { BinaryRouterLayout } from '../schema';
import type { MatcherConfig, PatternTesterFn } from '../types';
import { Node } from '../builder/node';
import { flatten } from '../builder/flattener';
import { Matcher } from './matcher';

// ── Fixtures ──

function makeConfig(overrides: Partial<MatcherConfig> = {}): MatcherConfig {
  return {
    patternTesters: overrides.patternTesters ?? [],
    encodedSlashBehavior: overrides.encodedSlashBehavior ?? 'preserve',
    failFastOnBadEncoding: overrides.failFastOnBadEncoding ?? false,
    methodCodes: overrides.methodCodes,
  };
}

function buildLayout(rootSetup: (root: Node) => void): BinaryRouterLayout {
  const root = new Node(NodeKind.Static, '/');
  rootSetup(root);

  return flatten(root);
}

function buildMatcher(
  rootSetup: (root: Node) => void,
  configOverrides: Partial<MatcherConfig> = {},
): Matcher {
  const layout = buildLayout(rootSetup);
  const config = makeConfig(configOverrides);

  return new Matcher(layout, config);
}

// ── Tests ──

describe('Matcher', () => {
  // ---- HP (Happy Path) ----

  describe('match — happy path', () => {
    it('should match a static-only route (single segment)', () => {
      const m = buildMatcher((root) => {
        const child = new Node(NodeKind.Static, 'users');
        child.methods.byMethod.set('GET', 0);
        root.staticChildren.set('users', child);
      });

      const result = m.match('GET', ['users'], '/users', undefined, false);

      expect(isErr(result)).toBe(false);
      expect(result).toBe(true);
      expect(m.getHandlerIndex()).toBe(0);
    });

    it('should match a param route with decoded param', () => {
      const m = buildMatcher((root) => {
        const param = new Node(NodeKind.Param, 'id');
        param.methods.byMethod.set('GET', 1);
        root.paramChildren.push(param);
      });

      const result = m.match('GET', ['42'], '/42', undefined, false);

      expect(result).toBe(true);
      expect(m.getParams()).toEqual({ id: '42' });
    });

    it('should match a wildcard route capturing suffix', () => {
      const m = buildMatcher((root) => {
        const wc = new Node(NodeKind.Wildcard, 'path');
        wc.methods.byMethod.set('GET', 2);
        root.wildcardChild = wc;
      });

      const result = m.match('GET', ['docs', 'readme.md'], '/docs/readme.md', undefined, false);

      expect(result).toBe(true);
      expect(m.getParams()['path']).toBeDefined();
    });

    it('should match a multi-param route (2+ params)', () => {
      const m = buildMatcher((root) => {
        const users = new Node(NodeKind.Static, 'users');
        root.staticChildren.set('users', users);

        const idParam = new Node(NodeKind.Param, 'userId');
        users.paramChildren.push(idParam);

        const posts = new Node(NodeKind.Static, 'posts');
        idParam.staticChildren.set('posts', posts);

        const postParam = new Node(NodeKind.Param, 'postId');
        postParam.methods.byMethod.set('GET', 3);
        posts.paramChildren.push(postParam);
      });

      const result = m.match('GET', ['users', '42', 'posts', '7'], '/users/42/posts/7', undefined, false);

      expect(result).toBe(true);
      const params = m.getParams();
      expect(params['userId']).toBe('42');
      expect(params['postId']).toBe('7');
    });

    it('should match a regex-constrained param route', () => {
      const digitTester: PatternTesterFn = (v) => /^\d+$/.test(v);

      const m = buildMatcher((root) => {
        const param = new Node(NodeKind.Param, 'id');
        param.pattern = /^\d+$/;
        param.patternSource = '\\d+';
        param.methods.byMethod.set('GET', 4);
        root.paramChildren.push(param);
      }, { patternTesters: [digitTester] });

      const result = m.match('GET', ['123'], '/123', undefined, false);

      expect(result).toBe(true);
      expect(m.getParams()['id']).toBe('123');
    });

    it('should match a deep nested static path (3+ segments)', () => {
      const m = buildMatcher((root) => {
        const api = new Node(NodeKind.Static, 'api');
        root.staticChildren.set('api', api);
        const v1 = new Node(NodeKind.Static, 'v1');
        api.staticChildren.set('v1', v1);
        const users = new Node(NodeKind.Static, 'users');
        users.methods.byMethod.set('GET', 5);
        v1.staticChildren.set('users', users);
      });

      const result = m.match('GET', ['api', 'v1', 'users'], '/api/v1/users', undefined, false);

      expect(result).toBe(true);
      expect(m.getHandlerIndex()).toBe(5);
    });

    it('should return stored handler index via getHandlerIndex', () => {
      const m = buildMatcher((root) => {
        const child = new Node(NodeKind.Static, 'x');
        child.methods.byMethod.set('GET', 42);
        root.staticChildren.set('x', child);
      });

      m.match('GET', ['x'], '/x', undefined, false);

      expect(m.getHandlerIndex()).toBe(42);
    });

    it('should return populated params via getParams', () => {
      const m = buildMatcher((root) => {
        const param = new Node(NodeKind.Param, 'name');
        param.methods.byMethod.set('GET', 0);
        root.paramChildren.push(param);
      });

      m.match('GET', ['alice'], '/alice', undefined, false);

      expect(m.getParams()).toEqual({ name: 'alice' });
    });
  });

  // ---- NE (Negative/Error) ----

  describe('match — negative', () => {
    it('should return false when method code is unknown', () => {
      const m = buildMatcher((root) => {
        const child = new Node(NodeKind.Static, 'x');
        child.methods.byMethod.set('GET', 0);
        root.staticChildren.set('x', child);
      });

      // 'PURGE'는 METHOD_OFFSET에 없으므로 code=undefined
      const result = m.match('PURGE' as any, ['x'], '/x', undefined, false);

      expect(result).toBe(false);
    });

    it('should return false when no route matches', () => {
      const m = buildMatcher((root) => {
        const child = new Node(NodeKind.Static, 'exists');
        child.methods.byMethod.set('GET', 0);
        root.staticChildren.set('exists', child);
      });

      const result = m.match('GET', ['notexists'], '/notexists', undefined, false);

      expect(result).toBe(false);
    });

    it('should propagate decode error from param decoding', () => {
      const m = buildMatcher((root) => {
        const param = new Node(NodeKind.Param, 'id');
        param.methods.byMethod.set('GET', 0);
        root.paramChildren.push(param);
      }, {
        encodedSlashBehavior: 'reject',
        failFastOnBadEncoding: true,
      });

      // %2F should be rejected with 'reject' behavior
      const hints = new Uint8Array([1]);
      const result = m.match('GET', ['%2F'], '/%2F', hints, true);

      expect(isErr(result)).toBe(true);
    });

    it('should return err(regex-timeout) when pattern tester throws', () => {
      const throwingTester: PatternTesterFn = () => {
        throw new Error('regex timeout');
      };

      const m = buildMatcher((root) => {
        const param = new Node(NodeKind.Param, 'id');
        param.pattern = /test/;
        param.patternSource = 'test';
        param.methods.byMethod.set('GET', 0);
        root.paramChildren.push(param);
      }, { patternTesters: [throwingTester] });

      const result = m.match('GET', ['abc'], '/abc', undefined, false);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.kind).toBe('regex-timeout');
      }
    });

    it('should return false when pattern test rejects value', () => {
      const digitOnly: PatternTesterFn = (v) => /^\d+$/.test(v);

      const m = buildMatcher((root) => {
        const param = new Node(NodeKind.Param, 'id');
        param.pattern = /^\d+$/;
        param.patternSource = '\\d+';
        param.methods.byMethod.set('GET', 0);
        root.paramChildren.push(param);
      }, { patternTesters: [digitOnly] });

      const result = m.match('GET', ['abc'], '/abc', undefined, false);

      expect(result).toBe(false);
    });

    it('should return null from checkTerminal when no methods registered', () => {
      const m = buildMatcher((root) => {
        const child = new Node(NodeKind.Static, 'x');
        // No methods registered
        root.staticChildren.set('x', child);
      });

      const result = m.match('GET', ['x'], '/x', undefined, false);

      expect(result).toBe(false);
    });

    it('should return null from checkTerminal when method mask not set', () => {
      const m = buildMatcher((root) => {
        const child = new Node(NodeKind.Static, 'x');
        child.methods.byMethod.set('POST', 0);
        root.staticChildren.set('x', child);
      });

      // GET method doesn't match POST
      const result = m.match('GET', ['x'], '/x', undefined, false);

      expect(result).toBe(false);
    });

    it('should return null from tryWildcard when wildcardPtr is 0', () => {
      const m = buildMatcher((root) => {
        // No wildcard child
        const child = new Node(NodeKind.Static, 'x');
        child.methods.byMethod.set('GET', 0);
        root.staticChildren.set('x', child);
      });

      const result = m.match('GET', ['nope'], '/nope', undefined, false);

      expect(result).toBe(false);
    });

    it('should return null from tryWildcard when origin=multi and suffix empty', () => {
      const m = buildMatcher((root) => {
        const wc = new Node(NodeKind.Wildcard, 'path');
        wc.wildcardOrigin = 'multi';
        wc.methods.byMethod.set('GET', 0);
        root.wildcardChild = wc;
      });

      // Empty suffix (segIdx === segments.length → value='')
      // with origin=multi (code 1), empty value should return null
      const result = m.match('GET', [], '/', undefined, false);

      // Root has no methods → checkTerminal returns null
      // Then STAGE_WILDCARD → tryWildcard → origin===1 && value.length===0 → null
      // → backtrack → no match → false
      expect(result).toBe(false);
    });
  });

  // ---- ED (Edge) ----

  describe('match — edge', () => {
    it('should match root terminal with empty segments', () => {
      const m = buildMatcher((root) => {
        root.methods.byMethod.set('GET', 10);
      });

      const result = m.match('GET', [], '/', undefined, false);

      expect(result).toBe(true);
      expect(m.getHandlerIndex()).toBe(10);
    });

    it('should handle single segment path', () => {
      const m = buildMatcher((root) => {
        const a = new Node(NodeKind.Static, 'a');
        a.methods.byMethod.set('GET', 11);
        root.staticChildren.set('a', a);
      });

      const result = m.match('GET', ['a'], '/a', undefined, false);

      expect(result).toBe(true);
      expect(m.getHandlerIndex()).toBe(11);
    });

    it('should use binary search for 6+ static children', () => {
      const m = buildMatcher((root) => {
        for (let i = 0; i < 7; i++) {
          const seg = `child${i}`;
          const child = new Node(NodeKind.Static, seg);
          child.methods.byMethod.set('GET', i);
          root.staticChildren.set(seg, child);
        }
      });

      const result = m.match('GET', ['child5'], '/child5', undefined, false);

      expect(result).toBe(true);
      expect(m.getHandlerIndex()).toBe(5);
    });

    it('should use linear scan for 3-5 static children', () => {
      const m = buildMatcher((root) => {
        for (let i = 0; i < 4; i++) {
          const seg = `item${i}`;
          const child = new Node(NodeKind.Static, seg);
          child.methods.byMethod.set('GET', 20 + i);
          root.staticChildren.set(seg, child);
        }
      });

      const result = m.match('GET', ['item2'], '/item2', undefined, false);

      expect(result).toBe(true);
      expect(m.getHandlerIndex()).toBe(22);
    });
  });

  // ---- CO (Corner) ----

  describe('match — corner', () => {
    it('should handle empty segments + wildcard route with zero origin', () => {
      // Root with a wildcard child using 'zero' origin (allows empty)
      const m = buildMatcher((root) => {
        const wc = new Node(NodeKind.Wildcard, 'rest');
        wc.wildcardOrigin = 'zero';
        wc.methods.byMethod.set('GET', 30);
        root.wildcardChild = wc;
      });

      const result = m.match('GET', [], '/', undefined, false);

      // Root has no terminal methods → checkTerminal returns null
      // → STAGE_WILDCARD → tryWildcard → origin is zero (code=2, not 1)
      // → origin!==1, so empty suffix is allowed → match
      expect(result).toBe(true);
    });

    it('should backtrack from param failure to try next param child', () => {
      // Two param children: first doesn't match the terminal, second does
      const m = buildMatcher((root) => {
        const p1 = new Node(NodeKind.Param, 'first');
        // no methods → won't match terminal
        root.paramChildren.push(p1);

        const p2 = new Node(NodeKind.Param, 'second');
        p2.methods.byMethod.set('GET', 31);
        root.paramChildren.push(p2);
      });

      const result = m.match('GET', ['val'], '/val', undefined, false);

      expect(result).toBe(true);
      expect(m.getParams()['second']).toBe('val');
    });

    it('should backtrack from static miss to param stage', () => {
      const m = buildMatcher((root) => {
        // Static child exists but doesn't match
        const staticChild = new Node(NodeKind.Static, 'known');
        staticChild.methods.byMethod.set('GET', 0);
        root.staticChildren.set('known', staticChild);

        // Param child should catch fallthrough
        const param = new Node(NodeKind.Param, 'id');
        param.methods.byMethod.set('GET', 32);
        root.paramChildren.push(param);
      });

      const result = m.match('GET', ['unknown'], '/unknown', undefined, false);

      expect(result).toBe(true);
      expect(m.getParams()['id']).toBe('unknown');
      expect(m.getHandlerIndex()).toBe(32);
    });
  });

  // ---- ST (State Transition) ----

  describe('match — state', () => {
    it('should reset state cleanly on second match call', () => {
      const m = buildMatcher((root) => {
        const param = new Node(NodeKind.Param, 'name');
        param.methods.byMethod.set('GET', 0);
        root.paramChildren.push(param);
      });

      m.match('GET', ['alice'], '/alice', undefined, false);
      expect(m.getParams()['name']).toBe('alice');

      m.match('GET', ['bob'], '/bob', undefined, false);
      expect(m.getParams()['name']).toBe('bob');
    });

    it('should increment paramCacheGen on each match call', () => {
      const m = buildMatcher((root) => {
        const child = new Node(NodeKind.Static, 'x');
        child.methods.byMethod.set('GET', 0);
        root.staticChildren.set('x', child);
      });

      // First match
      m.match('GET', ['x'], '/x', undefined, false);
      expect(m.getHandlerIndex()).toBe(0);

      // Second match — no stale cache
      m.match('GET', ['x'], '/x', undefined, false);
      expect(m.getHandlerIndex()).toBe(0);
    });
  });

  // ---- ID (Idempotency) ----

  describe('match — idempotency', () => {
    it('should return same result for two identical match calls', () => {
      const m = buildMatcher((root) => {
        const child = new Node(NodeKind.Static, 'stable');
        child.methods.byMethod.set('GET', 50);
        root.staticChildren.set('stable', child);
      });

      const r1 = m.match('GET', ['stable'], '/stable', undefined, false);
      const h1 = m.getHandlerIndex();

      const r2 = m.match('GET', ['stable'], '/stable', undefined, false);
      const h2 = m.getHandlerIndex();

      expect(r1).toBe(r2);
      expect(h1).toBe(h2);
    });

    it('should return stable getHandlerIndex across reads', () => {
      const m = buildMatcher((root) => {
        const child = new Node(NodeKind.Static, 'z');
        child.methods.byMethod.set('GET', 99);
        root.staticChildren.set('z', child);
      });

      m.match('GET', ['z'], '/z', undefined, false);

      expect(m.getHandlerIndex()).toBe(99);
      expect(m.getHandlerIndex()).toBe(99);
      expect(m.getHandlerIndex()).toBe(99);
    });
  });

  // ---- OR (Ordering) ----

  describe('match — ordering', () => {
    it('should try static children before param children', () => {
      const m = buildMatcher((root) => {
        // Static "users" with handler 60
        const staticChild = new Node(NodeKind.Static, 'users');
        staticChild.methods.byMethod.set('GET', 60);
        root.staticChildren.set('users', staticChild);

        // Param slug with handler 61
        const param = new Node(NodeKind.Param, 'slug');
        param.methods.byMethod.set('GET', 61);
        root.paramChildren.push(param);
      });

      // "users" should match static first
      const result = m.match('GET', ['users'], '/users', undefined, false);

      expect(result).toBe(true);
      expect(m.getHandlerIndex()).toBe(60);
    });

    it('should try param children before wildcard', () => {
      const m = buildMatcher((root) => {
        // Param id with handler 70
        const param = new Node(NodeKind.Param, 'id');
        param.methods.byMethod.set('GET', 70);
        root.paramChildren.push(param);

        // Wildcard rest with handler 71
        const wc = new Node(NodeKind.Wildcard, 'rest');
        wc.methods.byMethod.set('GET', 71);
        root.wildcardChild = wc;
      });

      // Single segment "42" should match param first
      const result = m.match('GET', ['42'], '/42', undefined, false);

      expect(result).toBe(true);
      expect(m.getHandlerIndex()).toBe(70);
    });
  });
});
