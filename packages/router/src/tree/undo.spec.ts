/**
 * Unit spec for `undo.ts`. The undo log replays tagged records back to
 * their reverse mutations; spec pins each UndoKind branch so a future
 * record-shape change surfaces here.
 */
import { describe, expect, it } from 'bun:test';

import type { PatternTesterFn } from './pattern-tester';
import type { ParamSegment } from './segment-tree';
import type { SegmentTreeUndoLog } from './undo';

import { WildcardOrigin } from '../tree';
import { createSegmentNode } from './segment-tree';
import { UndoKind, applyUndo, pushStaticBucketResetUndo, pushStaticMapDeleteUndo } from './undo';

describe('applyUndo — segment-tree mutations', () => {
  it('StaticChildrenInit clears the staticChildren slot', () => {
    const n = createSegmentNode();
    n.staticChildren = Object.create(null) as Record<string, ReturnType<typeof createSegmentNode>>;
    applyUndo({ k: UndoKind.StaticChildrenInit, n });
    expect(n.staticChildren).toBeNull();
  });

  it('StaticChildAdd deletes the named key from a staticChildren Record', () => {
    const p: Record<string, ReturnType<typeof createSegmentNode>> = Object.create(null);
    const child = createSegmentNode();
    p['users'] = child;
    applyUndo({ k: UndoKind.StaticChildAdd, p, key: 'users' });
    expect('users' in p).toBe(false);
  });

  it('ParamChildSet clears the paramChild slot', () => {
    const n = createSegmentNode();
    n.paramChild = {
      name: 'id',
      tester: null,
      patternSource: null,
      ownerRouteID: 0,
      next: createSegmentNode(),
      nextSibling: null,
    };
    applyUndo({ k: UndoKind.ParamChildSet, n });
    expect(n.paramChild).toBeNull();
  });

  it('ParamSiblingAdd clears the nextSibling pointer on the prev sibling', () => {
    const prev: ParamSegment = {
      name: 'a',
      tester: null,
      patternSource: null,
      ownerRouteID: 0,
      next: createSegmentNode(),
      nextSibling: null,
    };
    prev.nextSibling = {
      name: 'b',
      tester: null,
      patternSource: null,
      ownerRouteID: 0,
      next: createSegmentNode(),
      nextSibling: null,
    };
    applyUndo({ k: UndoKind.ParamSiblingAdd, prev });
    expect(prev.nextSibling).toBeNull();
  });

  it('WildcardSet clears all three wildcard slots on the node', () => {
    const n = createSegmentNode();
    n.wildcardStore = 5;
    n.wildcardName = 'rest';
    n.wildcardOrigin = WildcardOrigin.Star;
    applyUndo({ k: UndoKind.WildcardSet, n });
    expect(n.wildcardStore).toBeNull();
    expect(n.wildcardName).toBeNull();
    expect(n.wildcardOrigin).toBeNull();
  });

  it('StoreSet clears the store slot', () => {
    const n = createSegmentNode();
    n.store = 7;
    applyUndo({ k: UndoKind.StoreSet, n });
    expect(n.store).toBeNull();
  });

  it('TesterAdd deletes the tester cache entry under the supplied key', () => {
    const cache = new Map<string, PatternTesterFn>();
    cache.set('\\d+', (() => 1) as PatternTesterFn);
    applyUndo({ k: UndoKind.TesterAdd, cache, key: '\\d+' });
    expect(cache.size).toBe(0);
  });

  it('SingleChildClear clears the inline single-static-child slot', () => {
    const n = createSegmentNode();
    n.singleChildKey = 'users';
    n.singleChildNext = createSegmentNode();
    applyUndo({ k: UndoKind.SingleChildClear, n });
    expect(n.singleChildKey).toBeNull();
    expect(n.singleChildNext).toBeNull();
  });

  it('SingleChildRestore re-sets the inline slot to the recorded key + next', () => {
    const n = createSegmentNode();
    const next = createSegmentNode();
    applyUndo({ k: UndoKind.SingleChildRestore, n, key: 'users', next });
    expect(n.singleChildKey).toBe('users');
    expect(n.singleChildNext).toBe(next);
  });
});

describe('applyUndo — array truncation entries', () => {
  it('TerminalArraysTruncate truncates four parallel arrays to a recorded length', () => {
    const t = [1, 2, 3, 4];
    const w = [false, true, false, true];
    const f: Array<unknown> = [{}, {}, {}, {}];
    const b = [0, 0b1, 0b10, 0b11];
    applyUndo({ k: UndoKind.TerminalArraysTruncate, t, w, f, b, len: 2 });
    expect(t).toEqual([1, 2]);
    expect(w).toEqual([false, true]);
    expect(f.length).toBe(2);
    expect(b).toEqual([0, 0b1]);
  });

  it('HandlersTruncate truncates the array to the recorded length', () => {
    const arr: unknown[] = [1, 2, 3, 4, 5];
    applyUndo({ k: UndoKind.HandlersTruncate, arr, len: 3 });
    expect(arr).toEqual([1, 2, 3]);
  });
});

describe('applyUndo — slot delete / reset entries', () => {
  it('SegmentTreeReset removes the entry at the recorded methodCode', () => {
    const trees: Array<ReturnType<typeof createSegmentNode> | null | undefined> = [];
    trees[3] = createSegmentNode();
    applyUndo({ k: UndoKind.SegmentTreeReset, trees, mc: 3 });
    expect(trees[3]).toBeUndefined();
  });

  it('StaticBucketReset removes the bucket at the recorded methodCode', () => {
    const buckets: Array<Record<string, unknown> | undefined> = [];
    buckets[1] = { '/x': 'a' };
    applyUndo({ k: UndoKind.StaticBucketReset, buckets, mc: 1 });
    expect(buckets[1]).toBeUndefined();
  });

  it('StaticMapDelete removes the recorded key from the supplied map', () => {
    const map: Record<string, unknown> = { '/x': 'a' };
    applyUndo({ k: UndoKind.StaticMapDelete, map, key: '/x' });
    expect('/x' in map).toBe(false);
  });
});

describe('applyUndo — StaticPathMaskRestore', () => {
  it('deletes the key when prevMask is 0', () => {
    const map: Record<string, number> = { '/x': 0b101 };
    applyUndo({ k: UndoKind.StaticPathMaskRestore, map, key: '/x', prevMask: 0 });
    expect('/x' in map).toBe(false);
  });

  it('writes prevMask back to the key when non-zero', () => {
    const map: Record<string, number> = { '/x': 0b111 };
    applyUndo({ k: UndoKind.StaticPathMaskRestore, map, key: '/x', prevMask: 0b011 });
    expect(map['/x']).toBe(0b011);
  });
});

describe('applyUndo — PrefixIndexPlan', () => {
  it('invokes the rollback dispatcher with the recorded plan', () => {
    let called: unknown = null;
    const rollback = (plan: unknown) => {
      called = plan;
    };
    const plan = { ops: ['x'] };
    applyUndo({ k: UndoKind.PrefixIndexPlan, rollback, plan });
    expect(called).toBe(plan);
  });
});

describe('typed push helpers', () => {
  it('pushStaticBucketResetUndo widens the bucket array via a single cast', () => {
    const undoLog: SegmentTreeUndoLog = [];
    const buckets: Array<Record<string, number> | undefined> = [];
    buckets[2] = { '/a': 1 };
    pushStaticBucketResetUndo(undoLog, buckets, 2);
    expect(undoLog.length).toBe(1);
    expect(undoLog[0]!.k).toBe(UndoKind.StaticBucketReset);
    applyUndo(undoLog[0]!);
    expect(buckets[2]).toBeUndefined();
  });

  it('pushStaticMapDeleteUndo widens the map via a single cast', () => {
    const undoLog: SegmentTreeUndoLog = [];
    const map: Record<string, number> = { '/x': 7 };
    pushStaticMapDeleteUndo(undoLog, map, '/x');
    expect(undoLog.length).toBe(1);
    expect(undoLog[0]!.k).toBe(UndoKind.StaticMapDelete);
    applyUndo(undoLog[0]!);
    expect('/x' in map).toBe(false);
  });
});
