import { describe, it, expect } from 'bun:test';

import { isErr } from '@zipbul/result';

import { NodeKind, NODE_STRIDE } from '../schema';
import type { BuilderConfig } from './types';
import { Builder } from './builder';

// ── Fixtures ──

function makeBuilder(overrides: Partial<BuilderConfig> = {}): Builder<number> {
  return new Builder<number>({
    regexSafety: overrides.regexSafety,
    regexAnchorPolicy: overrides.regexAnchorPolicy ?? 'silent',
    optionalParamDefaults: overrides.optionalParamDefaults,
    onWarn: overrides.onWarn,
  });
}

describe('Builder', () => {
  // ---- HP (Happy Path) ----

  describe('add — happy path', () => {
    it('should add a static route and produce correct tree', () => {
      const b = makeBuilder();
      const result = b.add('GET', ['users'], 100);

      expect(isErr(result)).toBe(false);
      expect(b.root.staticChildren.get('users')).toBeDefined();
    });

    it('should add a single param route', () => {
      const b = makeBuilder();
      const result = b.add('GET', [':id'], 200);

      expect(isErr(result)).toBe(false);
      expect(b.root.paramChildren.length).toBe(1);
      expect(b.root.paramChildren[0]!.segment).toBe('id');
    });

    it('should add a wildcard route', () => {
      const b = makeBuilder();
      const result = b.add('GET', ['*path'], 300);

      expect(isErr(result)).toBe(false);
      expect(b.root.wildcardChild).toBeDefined();
      expect(b.root.wildcardChild!.segment).toBe('path');
    });

    it('should add a deep multi-segment route (3+ segments)', () => {
      const b = makeBuilder();
      const result = b.add('GET', ['api', 'v1', 'users'], 400);

      expect(isErr(result)).toBe(false);
      const api = b.root.staticChildren.get('api');
      expect(api).toBeDefined();
      const v1 = api!.staticChildren.get('v1');
      expect(v1).toBeDefined();
      const users = v1!.staticChildren.get('users');
      expect(users).toBeDefined();
      expect(users!.methods.byMethod.has('GET')).toBe(true);
    });

    it('should add a param with regex pattern', () => {
      const b = makeBuilder();
      const result = b.add('GET', [':id{\\d+}'], 500);

      expect(isErr(result)).toBe(false);
      const param = b.root.paramChildren[0];
      expect(param).toBeDefined();
      expect(param!.patternSource).toBe('\\d+');
    });

    it('should add an optional param route', () => {
      const b = makeBuilder();
      const result = b.add('GET', [':lang?', 'docs'], 600);

      expect(isErr(result)).toBe(false);
      // Optional creates both branches: /docs and /:lang/docs
      const docsChild = b.root.staticChildren.get('docs');
      expect(docsChild).toBeDefined();
      expect(b.root.paramChildren.length).toBe(1);
    });

    it('should add a multi-segment param with "+" suffix', () => {
      const b = makeBuilder();
      const result = b.add('GET', [':file+'], 700);

      expect(isErr(result)).toBe(false);
      expect(b.root.wildcardChild).toBeDefined();
      expect(b.root.wildcardChild!.wildcardOrigin).toBe('multi');
    });

    it('should add a zero-or-more param with "*" suffix', () => {
      const b = makeBuilder();
      const result = b.add('GET', [':files*'], 800);

      expect(isErr(result)).toBe(false);
      expect(b.root.wildcardChild).toBeDefined();
      expect(b.root.wildcardChild!.wildcardOrigin).toBe('zero');
    });

    it('should merge into existing static node', () => {
      const b = makeBuilder();
      b.add('GET', ['api', 'users'], 1);
      b.add('POST', ['api', 'users'], 2);

      const api = b.root.staticChildren.get('api');
      expect(api).toBeDefined();
      const users = api!.staticChildren.get('users');
      expect(users).toBeDefined();
      expect(users!.methods.byMethod.has('GET')).toBe(true);
      expect(users!.methods.byMethod.has('POST')).toBe(true);
    });

    it('should build and return a valid BinaryRouterLayout', () => {
      const b = makeBuilder();
      b.add('GET', ['hello'], 0);

      const layout = b.build();

      expect(layout.nodeBuffer).toBeInstanceOf(Uint32Array);
      expect(layout.nodeBuffer.length).toBe(2 * NODE_STRIDE); // root + hello
      expect(layout.rootIndex).toBe(0);
    });
  });

  // ---- NE (Negative/Error) ----

  describe('add — negative', () => {
    it('should return err(route-duplicate) for same method+path', () => {
      const b = makeBuilder();
      b.add('GET', ['users'], 1);
      const result = b.add('GET', ['users'], 2);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.kind).toBe('route-duplicate');
      }
    });

    it('should return err(segment-limit) when depth exceeds MAX_STACK_DEPTH', () => {
      const b = makeBuilder();
      const segments = Array.from({ length: 65 }, (_, i) => `seg${i}`);
      const result = b.add('GET', segments, 1);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.kind).toBe('segment-limit');
      }
    });

    it('should return err(route-conflict) when wildcard added with static siblings', () => {
      const b = makeBuilder();
      b.add('GET', ['api', 'users'], 1);

      const result = b.add('GET', ['api', '*rest'], 2);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.kind).toBe('route-conflict');
      }
    });

    it('should return err(route-parse) when wildcard not last segment', () => {
      const b = makeBuilder();
      const result = b.add('GET', ['*path', 'extra'], 1);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.kind).toBe('route-parse');
      }
    });

    it('should return err(route-conflict) on wildcard name mismatch', () => {
      const b = makeBuilder();
      b.add('GET', ['*path'], 1);
      const result = b.add('POST', ['*other'], 2);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.kind).toBe('route-conflict');
      }
    });

    it('should return err(route-parse) for unclosed regex brace', () => {
      const b = makeBuilder();
      const result = b.add('GET', [':id{\\d+'], 1);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.kind).toBe('route-parse');
      }
    });

    it('should return err(route-parse) for nameless param', () => {
      const b = makeBuilder();
      const result = b.add('GET', [':'], 1);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.kind).toBe('route-parse');
      }
    });

    it('should return err(route-parse) when combining zero-or-more and optional', () => {
      const b = makeBuilder();
      const result = b.add('GET', [':files*?'], 1);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.kind).toBe('route-parse');
      }
    });

    it('should return err(route-parse) when multi-param not last segment', () => {
      const b = makeBuilder();
      const result = b.add('GET', [':file+', 'extra'], 1);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.kind).toBe('route-parse');
      }
    });

    it('should return err(route-conflict) when static added under wildcard', () => {
      const b = makeBuilder();
      b.add('GET', ['*path'], 1);
      const result = b.add('GET', ['extra'], 2);

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.kind).toBe('route-conflict');
      }
    });
  });

  // ---- ED (Edge) ----

  describe('add — edge', () => {
    it('should register route at root with empty segments', () => {
      const b = makeBuilder();
      const result = b.add('GET', [], 0);

      expect(isErr(result)).toBe(false);
      expect(b.root.methods.byMethod.has('GET')).toBe(true);
    });

    it('should default wildcard name to "*" when segment is just "*"', () => {
      const b = makeBuilder();
      b.add('GET', ['*'], 1);

      expect(b.root.wildcardChild!.segment).toBe('*');
    });

    it('should handle existing static with segmentParts via splitStaticChain', () => {
      const b = makeBuilder();
      // First add creates a node; manually add segmentParts to simulate
      b.add('GET', ['abc'], 1);
      const child = b.root.staticChildren.get('abc')!;
      child.segmentParts = ['abc', 'def'];
      child.segment = 'abc';

      // Second add tries to match against segmentParts
      const result = b.add('POST', ['abc'], 2);

      expect(isErr(result)).toBe(false);
    });
  });

  // ---- CO (Corner) ----

  describe('add — corner', () => {
    it('should handle optional param that omits and recurses correctly', () => {
      const b = makeBuilder();
      const result = b.add('GET', [':lang?', 'docs', ':section'], 1);

      expect(isErr(result)).toBe(false);
      // /docs/:section 경로도 등록됨
      const docs = b.root.staticChildren.get('docs');
      expect(docs).toBeDefined();
      expect(docs!.paramChildren.length).toBe(1);
    });

    it('should return err(route-conflict) for zero-or-more with existing wildcard of different type', () => {
      const b = makeBuilder();
      b.add('GET', ['*path'], 1); // star wildcard → origin='star'
      const result = b.add('GET', [':files*'], 2); // zero-or-more → origin='zero'

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.kind).toBe('route-conflict');
      }
    });
  });

  // ---- ST (State Transition) ----

  describe('state transitions', () => {
    it('should grow handlers array on each add()', () => {
      const b = makeBuilder();
      expect(b.handlers.length).toBe(0);

      b.add('GET', ['a'], 10);
      expect(b.handlers.length).toBe(1);
      expect(b.handlers[0]).toBe(10);

      b.add('GET', ['b'], 20);
      expect(b.handlers.length).toBe(2);
      expect(b.handlers[1]).toBe(20);
    });

    it('should not push handler for addForValidation', () => {
      const b = makeBuilder();
      b.addForValidation('GET', ['test']);

      expect(b.handlers.length).toBe(0);
    });

    it('should produce consistent build after multiple adds', () => {
      const b = makeBuilder();
      b.add('GET', ['users'], 1);
      b.add('POST', ['users'], 2);
      b.add('GET', ['posts'], 3);

      const layout = b.build();

      // root + users + posts = 3 nodes
      expect(layout.nodeBuffer.length).toBe(3 * NODE_STRIDE);
    });
  });

  // ---- ID (Idempotency) ----

  describe('idempotency', () => {
    it('should return err on second duplicate add', () => {
      const b = makeBuilder();
      const r1 = b.add('GET', ['x'], 1);
      const r2 = b.add('GET', ['x'], 2);

      expect(isErr(r1)).toBe(false);
      expect(isErr(r2)).toBe(true);
    });

    it('should produce same layout on two build() calls', () => {
      const b = makeBuilder();
      b.add('GET', ['hello'], 1);

      const l1 = b.build();
      const l2 = b.build();

      expect(l1.nodeBuffer.length).toBe(l2.nodeBuffer.length);
      expect(l1.rootIndex).toBe(l2.rootIndex);
    });
  });

  // ---- OR (Ordering) ----

  describe('ordering', () => {
    it('should sort param children (regex before non-regex)', () => {
      const b = makeBuilder();
      b.add('GET', [':id{\\d+}'], 1); // regex param
      b.add('GET', [':slug'], 2);     // non-regex param

      // Regex param should be sorted first
      const first = b.root.paramChildren[0]!;
      expect(first.patternSource).toBeDefined();
    });

    it('should process segments left-to-right', () => {
      const b = makeBuilder();
      b.add('GET', ['a', 'b', 'c'], 1);

      const a = b.root.staticChildren.get('a');
      expect(a).toBeDefined();
      const bNode = a!.staticChildren.get('b');
      expect(bNode).toBeDefined();
      const c = bNode!.staticChildren.get('c');
      expect(c).toBeDefined();
      expect(c!.methods.byMethod.has('GET')).toBe(true);
    });
  });
});
