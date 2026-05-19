import { describe, expect, it } from 'bun:test';

import type { PatternTesterFn } from './pattern-tester';
import type { SegmentNode } from './segment-tree';
import type { SegmentTreeUndoLog } from './undo';

import { PathPartType, WildcardOrigin } from '../tree';
import { RouterErrorKind } from '../types';
import {
  attachStoreTerminal,
  attachWildcardTerminal,
  createSegmentNode,
  insertParamPart,
  insertStaticSegments,
  isResolvedTesterError,
  resolveOrCompileTester,
} from './segment-tree';

const newUndo = (): SegmentTreeUndoLog => [];
const newCache = (): Map<string, PatternTesterFn> => new Map();

describe('isResolvedTesterError', () => {
  it('returns false for null', () => {
    expect(isResolvedTesterError(null)).toBe(false);
  });

  it('returns false for a function (PatternTesterFn)', () => {
    const fn: PatternTesterFn = () => 1 as const;
    expect(isResolvedTesterError(fn)).toBe(false);
  });

  it('returns true for an object carrying a `kind` field (RouterErrorData)', () => {
    expect(isResolvedTesterError({ kind: RouterErrorKind.RouteParse, message: 'x', suggestion: 'fix' })).toBe(true);
  });
});

describe('resolveOrCompileTester', () => {
  it('returns null for an unconstrained param (pattern === null)', () => {
    const tester = resolveOrCompileTester({ name: 'id', pattern: null }, newCache(), newUndo());
    expect(tester).toBeNull();
  });

  it('compiles a fresh tester and caches it on first sight', () => {
    const cache = newCache();
    const undo = newUndo();
    const t = resolveOrCompileTester({ name: 'id', pattern: '\\d+' }, cache, undo);
    expect(typeof t).toBe('function');
    expect(cache.size).toBe(1);
    expect(undo).toHaveLength(1);
  });

  it('returns the cached tester (no fresh push) on a repeat lookup', () => {
    const cache = newCache();
    const undo = newUndo();
    const first = resolveOrCompileTester({ name: 'id', pattern: '\\d+' }, cache, undo);
    const second = resolveOrCompileTester({ name: 'id', pattern: '\\d+' }, cache, undo);
    expect(second).toBe(first);
    expect(undo).toHaveLength(1);
  });

  it('returns route-parse error data for an invalid regex pattern', () => {
    const out = resolveOrCompileTester({ name: 'id', pattern: '[unclosed' }, newCache(), newUndo());
    expect(isResolvedTesterError(out)).toBe(true);
    if (isResolvedTesterError(out)) {
      expect(out.kind).toBe(RouterErrorKind.RouteParse);
      expect(out.message).toContain('Invalid regex');
    }
  });
});

describe('insertStaticSegments', () => {
  it('returns the descended node and stores the inline single-static slot on first insert', () => {
    const root = createSegmentNode();
    const undo = newUndo();
    const out = insertStaticSegments(root, ['users'], undo);
    expect(out).not.toHaveProperty('kind');
    expect(root.singleChildKey).toBe('users');
    expect(root.singleChildNext).toBe(out as SegmentNode);
    expect(undo).toHaveLength(1);
  });

  it('reuses the existing singleChildKey slot on a matching second insert', () => {
    const root = createSegmentNode();
    const undo = newUndo();
    const a = insertStaticSegments(root, ['users'], undo) as SegmentNode;
    const b = insertStaticSegments(root, ['users'], undo) as SegmentNode;
    expect(a).toBe(b);
  });

  it('promotes inline slot to a Record on second distinct insert', () => {
    const root = createSegmentNode();
    const undo = newUndo();
    insertStaticSegments(root, ['users'], undo);
    insertStaticSegments(root, ['posts'], undo);
    expect(root.singleChildKey).toBeNull();
    expect(root.staticChildren).not.toBeNull();
    expect(Object.keys(root.staticChildren!).sort()).toEqual(['posts', 'users']);
  });

  it('returns a route-conflict error when descending into a node that already has a wildcard at the same position', () => {
    const root = createSegmentNode();
    root.wildcardStore = 1;
    root.wildcardName = 'rest';
    root.wildcardOrigin = WildcardOrigin.Star;
    const out = insertStaticSegments(root, ['users'], newUndo());
    expect(out).toHaveProperty('kind');
    if ('kind' in out && out.kind === RouterErrorKind.RouteConflict) {
      expect(out.conflictsWith).toBe('*rest');
    }
  });
});

describe('insertParamPart', () => {
  it('creates a fresh paramChild on first insertion and returns the descended node', () => {
    const root = createSegmentNode();
    const undo = newUndo();
    const out = insertParamPart(
      root,
      { type: PathPartType.Param, name: 'id', pattern: null, optional: false },
      newCache(),
      0,
      undo,
    );
    expect(out).not.toHaveProperty('kind');
    expect(root.paramChild).not.toBeNull();
    expect(root.paramChild!.name).toBe('id');
    expect(undo).toHaveLength(1);
  });

  it('reuses the matching same-name same-pattern paramChild on a second insertion', () => {
    const root = createSegmentNode();
    const undo = newUndo();
    const cache = newCache();
    const part = { type: PathPartType.Param as const, name: 'id', pattern: null, optional: false };
    const a = insertParamPart(root, part, cache, 0, undo);
    const b = insertParamPart(root, part, cache, 0, undo);
    if ('node' in a && 'node' in b) {
      expect(a.node).toBe(b.node);
    }
    expect(undo).toHaveLength(1);
  });

  it('returns route-conflict when registering a wildcard-positioned node first', () => {
    const root = createSegmentNode();
    root.wildcardStore = 1;
    root.wildcardName = 'rest';
    root.wildcardOrigin = WildcardOrigin.Star;
    const out = insertParamPart(
      root,
      { type: PathPartType.Param, name: 'id', pattern: null, optional: false },
      newCache(),
      0,
      newUndo(),
    );
    expect(out).toHaveProperty('kind');
    if ('kind' in out && out.kind === RouterErrorKind.RouteConflict) {
      expect(out.conflictsWith).toBe('*rest');
    }
  });
});

describe('attachWildcardTerminal', () => {
  it('writes the wildcard slot and pushes one undo entry on success', () => {
    const node = createSegmentNode();
    const undo = newUndo();
    const out = attachWildcardTerminal(node, { type: PathPartType.Wildcard, name: 'rest', origin: WildcardOrigin.Star }, 7, undo);
    expect(out).toBeUndefined();
    expect(node.wildcardStore).toBe(7);
    expect(node.wildcardName).toBe('rest');
    expect(node.wildcardOrigin).toBe(WildcardOrigin.Star);
    expect(undo).toHaveLength(1);
  });

  it('returns route-conflict when an existing wildcard at the same position has a different name', () => {
    const node = createSegmentNode();
    node.wildcardStore = 1;
    node.wildcardName = 'first';
    node.wildcardOrigin = WildcardOrigin.Star;
    const out = attachWildcardTerminal(
      node,
      { type: PathPartType.Wildcard, name: 'second', origin: WildcardOrigin.Star },
      9,
      newUndo(),
    );
    expect(out).toBeDefined();
    if (out) {
      expect(out.kind).toBe(RouterErrorKind.RouteConflict);
    }
  });

  it('returns route-duplicate when an existing wildcard has the same name', () => {
    const node = createSegmentNode();
    node.wildcardStore = 1;
    node.wildcardName = 'rest';
    node.wildcardOrigin = WildcardOrigin.Star;
    const out = attachWildcardTerminal(
      node,
      { type: PathPartType.Wildcard, name: 'rest', origin: WildcardOrigin.Star },
      9,
      newUndo(),
    );
    expect(out).toBeDefined();
    if (out) {
      expect(out.kind).toBe(RouterErrorKind.RouteDuplicate);
    }
  });

  it('returns route-conflict when a paramChild already occupies the position', () => {
    const node = createSegmentNode();
    node.paramChild = {
      name: 'id',
      tester: null,
      patternSource: null,
      ownerRouteID: 0,
      next: createSegmentNode(),
      nextSibling: null,
    };
    const out = attachWildcardTerminal(
      node,
      { type: PathPartType.Wildcard, name: 'rest', origin: WildcardOrigin.Star },
      9,
      newUndo(),
    );
    expect(out).toBeDefined();
    if (out) {
      expect(out.kind).toBe(RouterErrorKind.RouteConflict);
    }
  });
});

describe('attachStoreTerminal', () => {
  it('writes the store and pushes one undo entry on success', () => {
    const node = createSegmentNode();
    const undo = newUndo();
    const out = attachStoreTerminal(node, 5, undo);
    expect(out).toBeUndefined();
    expect(node.store).toBe(5);
    expect(undo).toHaveLength(1);
  });

  it('returns route-duplicate when the node already has a store', () => {
    const node = createSegmentNode();
    node.store = 1;
    const out = attachStoreTerminal(node, 2, newUndo());
    expect(out).toBeDefined();
    if (out) {
      expect(out.kind).toBe(RouterErrorKind.RouteDuplicate);
    }
  });
});
