import type { ParamSegment, SegmentNode } from './node-types';
import type { PatternTesterFn } from './pattern-tester';

export enum UndoKind {
  StaticChildrenInit = 1,
  StaticChildAdd = 2,
  ParamChildSet = 3,
  ParamSiblingAdd = 4,
  WildcardSet = 5,
  StoreSet = 6,
  TesterAdd = 7,
  PrefixIndexPlan = 8,
  TerminalArraysTruncate = 9,
  HandlersTruncate = 10,
  SegmentTreeReset = 11,
  StaticBucketReset = 12,
  StaticMapDelete = 13,
  SingleChildClear = 14,
  SingleChildRestore = 15,
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

export type SegmentTreeUndoLog = UndoRecord[];

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

export function pushStaticMapDeleteUndo<T>(undoLog: SegmentTreeUndoLog, map: Record<string, T>, key: string): void {
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
      if (entry.prevMask === 0) {
        delete entry.map[entry.key];
      } else {
        entry.map[entry.key] = entry.prevMask;
      }
      return;
    default: {
      const _exhaustive: never = entry;
      void _exhaustive;
    }
  }
}
