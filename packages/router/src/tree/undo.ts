import type { ParamSegment, SegmentNode } from './segment-tree';
import type { PatternTesterFn } from './pattern-tester';

/**
 * Tagged-record undo log entries. Hot insertions on `100k wildcard-heavy`
 * historically allocated one closure per mutation (~300k closures per build);
 * each new closure freshly captured the surrounding scope and dominated GC.
 * Replacing the closures with monomorphic plain-object records keeps the
 * memory shape stable (one hidden class per kind) and lets the rollback
 * loop dispatch via a tag instead of a function call.
 */
export const enum UndoKind {
  StaticChildrenInit = 1,
  StaticChildAdd = 2,
  ParamChildSet = 3,
  ParamSiblingAdd = 4,
  WildcardSet = 5,
  StoreSet = 6,
  TesterAdd = 7,
  /**
   * Inverse of WildcardPrefixIndex.commit(). Stored as a tagged record
   * carrying the `CommitPlan` so the registration rollback path does not
   * have to allocate a closure per route during high-volume builds.
   */
  PrefixIndexPlan = 8,
  /** Truncate three parallel state arrays back to a recorded length (terminalHandlers, isWildcardByTerminal, paramsFactories). */
  TerminalArraysTruncate = 9,
  /** Truncate handlers array back to a recorded length. */
  HandlersTruncate = 10,
  /** Truncate state.segmentTrees[mc] back to undefined. */
  SegmentTreeReset = 11,
  /** Truncate state.staticByMethod[mc] back to undefined. */
  StaticBucketReset = 17,
  /** Static-map slot delete (was undefined before). */
  StaticMapDelete = 13,
  /** Inverse of inline single-static-child set: clear key + next on the parent. */
  SingleChildClear = 14,
  /** Inverse of single-static-child promotion to Record: re-set key + next. */
  SingleChildRestore = 15,
  /** Restore a `staticPathMethodMask` entry — set to prevMask (0 means delete). */
  StaticPathMaskRestore = 16,
}

export type UndoRecord =
  | { k: UndoKind.StaticChildrenInit; n: SegmentNode }
  | { k: UndoKind.StaticChildAdd; p: Record<string, SegmentNode>; key: string }
  | { k: UndoKind.ParamChildSet; n: SegmentNode }
  | { k: UndoKind.ParamSiblingAdd; prev: ParamSegment }
  | { k: UndoKind.WildcardSet; n: SegmentNode }
  | { k: UndoKind.StoreSet; n: SegmentNode }
  | { k: UndoKind.TesterAdd; cache: Map<string, PatternTesterFn>; key: string }
  | { k: UndoKind.PrefixIndexPlan; rollback: (plan: unknown) => void; plan: unknown }
  | { k: UndoKind.TerminalArraysTruncate; t: number[]; w: boolean[]; f: Array<unknown>; b: number[]; len: number }
  | { k: UndoKind.HandlersTruncate; arr: unknown[]; len: number }
  | { k: UndoKind.SegmentTreeReset; trees: Array<SegmentNode | null | undefined>; mc: number }
  | { k: UndoKind.StaticBucketReset; buckets: Array<Record<string, unknown> | undefined>; mc: number }
  | { k: UndoKind.StaticMapDelete; map: Record<string, unknown>; key: string }
  | { k: UndoKind.SingleChildClear; n: SegmentNode }
  | { k: UndoKind.SingleChildRestore; n: SegmentNode; key: string; next: SegmentNode }
  | { k: UndoKind.StaticPathMaskRestore; map: Record<string, number>; key: string; prevMask: number };

// All undo entries are tagged records — closures were eliminated to
// keep the entry shape monomorphic and avoid per-entry scope alloc.
export type SegmentTreeUndoLog = UndoRecord[];

/**
 * Type-safe push for `UndoKind.StaticBucketReset`. The undo log stores
 * buckets as `Array<Record<string, unknown>>` because it is shape-only
 * carrier (it never reads the values) — call sites with a typed
 * `Array<Record<string, T>>` would otherwise need a `as unknown as`
 * widening cast at every push. This helper performs the widening once
 * inside the undo module.
 */
export function pushStaticBucketResetUndo<T>(
  undoLog: SegmentTreeUndoLog,
  buckets: Array<Record<string, T> | undefined>,
  mc: number,
): void {
  undoLog.push({
    k: UndoKind.StaticBucketReset,
    buckets: buckets as unknown as Array<Record<string, unknown> | undefined>,
    mc,
  });
}

/**
 * Type-safe push for `UndoKind.StaticMapDelete`. Same rationale as
 * `pushStaticBucketResetUndo` — collapses the `T → unknown` boundary
 * cast into one location.
 */
export function pushStaticMapDeleteUndo<T>(
  undoLog: SegmentTreeUndoLog,
  map: Record<string, T>,
  key: string,
): void {
  undoLog.push({
    k: UndoKind.StaticMapDelete,
    map: map as unknown as Record<string, unknown>,
    key,
  });
}

export function applyUndo(entry: UndoRecord): void {
  switch (entry.k) {
    case UndoKind.StaticChildrenInit:
      entry.n.staticChildren = null;
      return;
    case UndoKind.StaticChildAdd:
      delete entry.p[entry.key];
      return;
    case UndoKind.ParamChildSet:
      entry.n.paramChild = null;
      return;
    case UndoKind.ParamSiblingAdd:
      entry.prev.nextSibling = null;
      return;
    case UndoKind.WildcardSet:
      entry.n.wildcardStore = null;
      entry.n.wildcardName = null;
      entry.n.wildcardOrigin = null;
      return;
    case UndoKind.StoreSet:
      entry.n.store = null;
      return;
    case UndoKind.TesterAdd:
      entry.cache.delete(entry.key);
      return;
    case UndoKind.PrefixIndexPlan:
      // Each entry carries its own rollback dispatcher reference, so the
      // matcher layer never imports the prefix-index module. Caller
      // (registration.ts) bakes `rollbackPlan` into the entry at push time.
      entry.rollback(entry.plan);
      return;
    case UndoKind.TerminalArraysTruncate:
      entry.t.length = entry.len;
      entry.w.length = entry.len;
      entry.f.length = entry.len;
      entry.b.length = entry.len;
      return;
    case UndoKind.HandlersTruncate:
      entry.arr.length = entry.len;
      return;
    case UndoKind.SegmentTreeReset:
      delete entry.trees[entry.mc];
      return;
    case UndoKind.StaticBucketReset:
      delete entry.buckets[entry.mc];
      return;
    case UndoKind.StaticMapDelete:
      delete entry.map[entry.key];
      return;
    case UndoKind.SingleChildClear:
      entry.n.singleChildKey = null;
      entry.n.singleChildNext = null;
      return;
    case UndoKind.SingleChildRestore:
      entry.n.singleChildKey = entry.key;
      entry.n.singleChildNext = entry.next;
      return;
    case UndoKind.StaticPathMaskRestore:
      if (entry.prevMask === 0) delete entry.map[entry.key];
      else entry.map[entry.key] = entry.prevMask;
      return;
  }
}
