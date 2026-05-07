import type { Result } from '@zipbul/result';
import type { RouterErrorData } from '../types';
import type { PatternTesterFn } from './pattern-tester';
import type { PathPart } from '../builder/path-parser';

import { err } from '@zipbul/result';
import { buildPatternTester } from './pattern-tester';

const MAX_REGEX_SIBLINGS_PER_SEGMENT = 32;

/**
 * Segment-based route tree. Each node corresponds to one URL segment
 * (no intra-segment splits). Built at Router.build() directly from
 * registered route parts.
 */
export interface SegmentNode {
  /** Terminal handler index when the URL ends here exactly. */
  store: number | null;
  /** Static children keyed by segment literal. NullProtoObj for property-access
   *  speed (no Map.get function-call dispatch, no prototype-chain lookup). */
  staticChildren: Record<string, SegmentNode> | null;
  /** Head of the param-alternative chain at this position. */
  paramChild: ParamSegment | null;
  /** Wildcard at this position. */
  wildcardStore: number | null;
  wildcardName: string | null;
  wildcardOrigin: 'star' | 'multi' | null;
}

export interface ParamSegment {
  name: string;
  tester: PatternTesterFn | null;
  /** Source pattern string (or null for unconstrained). Used to detect
   *  same-name conflicts at registration time without comparing compiled
   *  tester object identity. */
  patternSource: string | null;
  /** First routeID that introduced this param. Two siblings sharing the
   *  same ownerRouteID come from one route's optional-param expansion (e.g.
   *  `/users/:a?/:b?` deliberately creates `:a` and `:b` siblings under the
   *  same route) and bypass the unreachable-sibling check below. */
  ownerRouteID: number;
  /** Subtree rooted at this param. */
  next: SegmentNode;
  /** Linked-list pointer to the next param alternative at the same position. */
  nextSibling: ParamSegment | null;
}

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
  /** Restore static-map slot prior values. */
  StaticMapRestore = 12,
  /** Static-map slot delete (was undefined before). */
  StaticMapDelete = 13,
}

export type UndoRecord =
  | { k: UndoKind.StaticChildrenInit; n: SegmentNode }
  | { k: UndoKind.StaticChildAdd; p: Record<string, SegmentNode>; key: string }
  | { k: UndoKind.ParamChildSet; n: SegmentNode }
  | { k: UndoKind.ParamSiblingAdd; prev: ParamSegment }
  | { k: UndoKind.WildcardSet; n: SegmentNode }
  | { k: UndoKind.StoreSet; n: SegmentNode }
  | { k: UndoKind.TesterAdd; cache: Map<string, PatternTesterFn>; key: string }
  | { k: UndoKind.PrefixIndexPlan; plan: unknown }
  | { k: UndoKind.TerminalArraysTruncate; t: number[]; w: boolean[]; f: Array<unknown>; len: number }
  | { k: UndoKind.HandlersTruncate; arr: unknown[]; len: number }
  | { k: UndoKind.SegmentTreeReset; trees: Array<SegmentNode | null | undefined>; mc: number }
  | { k: UndoKind.StaticMapRestore; arr: unknown[]; reg: boolean[]; mc: number; prevValue: unknown; prevReg: boolean }
  | { k: UndoKind.StaticMapDelete; map: Record<string, unknown>; reg: Record<string, unknown>; key: string };

export type SegmentTreeUndoEntry = UndoRecord | (() => void);
export type SegmentTreeUndoLog = SegmentTreeUndoEntry[];

let prefixIndexRollback: ((plan: unknown) => void) | null = null;

/**
 * Wire the prefix-index rollback dispatcher. Called once at module
 * initialization from `pipeline/registration.ts`. Decouples the matcher
 * from the pipeline so segment-tree.ts has no upward dependency.
 */
export function setPrefixIndexRollback(fn: (plan: unknown) => void): void {
  prefixIndexRollback = fn;
}

export function applyUndo(entry: SegmentTreeUndoEntry): void {
  if (typeof entry === 'function') { entry(); return; }
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
      // Dispatched by registration's caller (which knows the prefix-index
      // module). The matcher layer must not depend on pipeline, so the
      // dispatcher is registered via setPrefixIndexRollback().
      prefixIndexRollback!(entry.plan);
      return;
    case UndoKind.TerminalArraysTruncate:
      entry.t.length = entry.len;
      entry.w.length = entry.len;
      entry.f.length = entry.len;
      return;
    case UndoKind.HandlersTruncate:
      entry.arr.length = entry.len;
      return;
    case UndoKind.SegmentTreeReset:
      delete entry.trees[entry.mc];
      return;
    case UndoKind.StaticMapRestore:
      entry.arr[entry.mc] = entry.prevValue;
      entry.reg[entry.mc] = entry.prevReg;
      return;
    case UndoKind.StaticMapDelete:
      delete entry.map[entry.key];
      delete entry.reg[entry.key];
      return;
  }
}

export function createSegmentNode(): SegmentNode {
  return {
    store: null,
    staticChildren: null,
    paramChild: null,
    wildcardStore: null,
    wildcardName: null,
    wildcardOrigin: null,
  };
}

/**
 * Detect whether the segment tree has any node where the same URL segment
 * could simultaneously match multiple alternatives — a static child *and* a
 * param/wildcard, or two sibling params. When false, a non-recursive
 * iterative walker can be used safely; otherwise the recursive walker (with
 * backtracking) must run.
 */
export function hasAmbiguousNode(root: SegmentNode): boolean {
  const stack: SegmentNode[] = [root];

  while (stack.length > 0) {
    const node = stack.pop()!;

    if (node.staticChildren !== null && (node.paramChild !== null || node.wildcardStore !== null)) {
      return true;
    }

    if (node.paramChild !== null && node.paramChild.nextSibling !== null) {
      return true;
    }

    if (node.staticChildren !== null) {
      for (const k in node.staticChildren) stack.push(node.staticChildren[k]!);
    }

    let p = node.paramChild;

    while (p !== null) {
      stack.push(p.next);
      p = p.nextSibling;
    }
  }

  return false;
}

function rollbackUndo(undo: SegmentTreeUndoLog, start: number): void {
  for (let i = undo.length - 1; i >= start; i--) applyUndo(undo[i]!);
  undo.length = start;
}

/**
 * Insert one expanded route (no optional markers) into the segment tree.
 *
 * Hot-path notes:
 *  - Error paths call the free `rollbackUndo()` helper rather than closing
 *    over a per-call `fail` arrow; allocating one closure per route was
 *    observable GC pressure on large builds.
 *  - The literal-segment branch is structured so the common case (existing
 *    literal child on a non-wildcard node) takes a single hash lookup and
 *    no allocation.
 */
export function insertIntoSegmentTree(
  root: SegmentNode,
  parts: PathPart[],
  handlerIndex: number,
  testerCache: Map<string, PatternTesterFn>,
  routeID: number,
  undoLog?: SegmentTreeUndoLog,
): Result<void, RouterErrorData> {
  let node = root;
  const undo = undoLog ?? [];
  const undoStart = undo.length;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;

    if (part.type === 'static') {
      const segs = part.segments;

      for (let s = 0; s < segs.length; s++) {
        const seg = segs[s]!;
        // Fast path: existing literal child on a non-wildcard node.
        const sc = node.staticChildren;
        if (sc !== null && node.wildcardStore === null) {
          const child = sc[seg];
          if (child !== undefined) { node = child; continue; }
        }

        if (node.wildcardStore !== null) {
          rollbackUndo(undo, undoStart);
          return err({
            kind: 'route-conflict',
            message: `Static route conflicts with existing wildcard '*${node.wildcardName}' at the same position`,
            segment: seg,
            conflictsWith: `*${node.wildcardName}`,
          });
        }

        let children = node.staticChildren;
        if (children === null) {
          children = Object.create(null) as Record<string, SegmentNode>;
          node.staticChildren = children;
          undo.push({ k: UndoKind.StaticChildrenInit, n: node });
        }

        const fresh = createSegmentNode();
        children[seg] = fresh;
        undo.push({ k: UndoKind.StaticChildAdd, p: children, key: seg });
        node = fresh;
      }
    } else if (part.type === 'param') {
      if (node.wildcardStore !== null) {
        rollbackUndo(undo, undoStart);
        return err({
          kind: 'route-conflict',
          message: `Parameter ':${part.name}' conflicts with existing wildcard '*${node.wildcardName}' at the same position`,
          segment: part.name,
          conflictsWith: `*${node.wildcardName}`,
        });
      }

      let tester: PatternTesterFn | null = null;

      if (part.pattern !== null) {
        const cached = testerCache.get(part.pattern);

        if (cached !== undefined) {
          tester = cached;
        } else {
          try {
            const compiled = new RegExp(`^(?:${part.pattern})$`);

            tester = buildPatternTester(part.pattern, compiled);
            testerCache.set(part.pattern, tester);
            undo.push({ k: UndoKind.TesterAdd, cache: testerCache, key: part.pattern });
          } catch (e) {
            rollbackUndo(undo, undoStart);
            return err({
              kind: 'route-parse',
              message: `Invalid regex pattern in parameter ':${part.name}': ${e instanceof Error ? e.message : String(e)}`,
              segment: part.name,
              suggestion: 'Fix the regex syntax. Anchors are stripped automatically; do not include ^ or $.',
            });
          }
        }
      }

      if (node.paramChild === null) {
        const created: ParamSegment = {
          name: part.name,
          tester,
          patternSource: part.pattern,
          ownerRouteID: routeID,
          next: createSegmentNode(),
          nextSibling: null,
        };
        node.paramChild = created;
        undo.push({ k: UndoKind.ParamChildSet, n: node });
        node = created.next;
      } else {
        let p: ParamSegment | null = node.paramChild;
        let prev: ParamSegment | null = null;
        let matched: ParamSegment | null = null;

        while (p !== null) {
          if (p.name === part.name && p.patternSource === part.pattern) {
            matched = p;
            break;
          }

          if (p.name === part.name && p.patternSource !== part.pattern) {
            rollbackUndo(undo, undoStart);
            return err({
              kind: 'route-conflict',
              message: `Parameter ':${part.name}' has conflicting regex patterns`,
              segment: part.name,
              conflictsWith: `:${p.name}${p.patternSource !== null ? `(${p.patternSource})` : ''}`,
            });
          }

          if (p.patternSource === null && p.ownerRouteID !== routeID) {
            rollbackUndo(undo, undoStart);
            return err({
              kind: 'route-conflict',
              message: `Parameter ':${part.name}' is unreachable — earlier sibling ':${p.name}' (registered by a different route) has no regex pattern and matches every value at this position. Add a regex pattern to disambiguate, or remove this route.`,
              segment: part.name,
              conflictsWith: p.name,
            });
          }

          prev = p;
          p = p.nextSibling;
        }

        if (matched === null) {
          let siblingCount = 1;
          let cursor: ParamSegment | null = node.paramChild;
          while (cursor !== null) { siblingCount++; cursor = cursor.nextSibling; }
          if (siblingCount > MAX_REGEX_SIBLINGS_PER_SEGMENT) {
            rollbackUndo(undo, undoStart);
            return err({
              kind: 'regex-sibling-limit',
              message: `Too many regex/param siblings at the same position (cap ${MAX_REGEX_SIBLINGS_PER_SEGMENT}).`,
              segment: part.name,
              suggestion: `Reduce the number of distinct regex constraints sharing this segment to ${MAX_REGEX_SIBLINGS_PER_SEGMENT} or fewer.`,
            });
          }
          const fresh: ParamSegment = {
            name: part.name,
            tester,
            patternSource: part.pattern,
            ownerRouteID: routeID,
            next: createSegmentNode(),
            nextSibling: null,
          };
          const tail = prev!;
          tail.nextSibling = fresh;
          undo.push({ k: UndoKind.ParamSiblingAdd, prev: tail });
          node = fresh.next;
        } else {
          node = matched.next;
        }
      }
    } else {
      // wildcard — terminal
      if (node.wildcardStore !== null) {
        if (node.wildcardName !== part.name) {
          rollbackUndo(undo, undoStart);
          return err({
            kind: 'route-conflict',
            message: `Wildcard '*${part.name}' conflicts with existing wildcard '*${node.wildcardName}'`,
            segment: part.name,
            conflictsWith: `*${node.wildcardName}`,
          });
        }

        rollbackUndo(undo, undoStart);
        return err({
          kind: 'route-duplicate',
          message: 'Wildcard route already exists at this position',
          suggestion: 'Use a different path or HTTP method',
        });
      }

      if (node.paramChild !== null) {
        rollbackUndo(undo, undoStart);
        return err({
          kind: 'route-conflict',
          message: `Wildcard '*${part.name}' conflicts with existing parameter at the same position`,
          segment: part.name,
          conflictsWith: `:${node.paramChild.name}`,
        });
      }

      node.wildcardStore = handlerIndex;
      node.wildcardName = part.name;
      node.wildcardOrigin = part.origin;
      undo.push({ k: UndoKind.WildcardSet, n: node });

      return;
    }
  }

  if (node.store !== null) {
    rollbackUndo(undo, undoStart);
    return err({
      kind: 'route-duplicate',
      message: 'Terminal route already exists at this position',
      suggestion: 'Use a different path or HTTP method',
    });
  }

  node.store = handlerIndex;
  undo.push({ k: UndoKind.StoreSet, n: node });
}
