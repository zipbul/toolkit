import type { Result } from '@zipbul/result';
import type { RouterErrorData } from '../types';
import type { PatternTesterFn } from './pattern-tester';
import type { PathPart } from './path-part';

import { err } from '@zipbul/result';
import { buildPatternTester } from './pattern-tester';
import { UndoKind, applyUndo, type SegmentTreeUndoLog } from './undo';


/**
 * Segment-based route tree. Each node corresponds to one URL segment
 * (no intra-segment splits). Built at Router.build() directly from
 * registered route parts.
 */
export interface SegmentNode {
  /** Terminal handler index when the URL ends here exactly. */
  store: number | null;
  /** Static children keyed by segment literal. NullProtoObj for property-access
   *  speed. `null` when the node has no static children OR when the only
   *  static child is held in the inline `singleChildKey` slot below. */
  staticChildren: Record<string, SegmentNode> | null;
  /**
   * Inline single-static-child cache. When a node has exactly one static
   * child, the key/next pair lives here rather than in a 1-entry
   * `staticChildren` Record. Saves one `Object.create(null)` per such
   * node and lets the walker resolve via a single string compare instead
   * of a hash lookup. On the second static-child insertion the inline
   * entry is promoted into `staticChildren` and these slots are cleared.
   */
  singleChildKey: string | null;
  singleChildNext: SegmentNode | null;
  /** Head of the param-alternative chain at this position. */
  paramChild: ParamSegment | null;
  /** Wildcard at this position. */
  wildcardStore: number | null;
  wildcardName: string | null;
  wildcardOrigin: 'star' | 'multi' | null;
  /**
   * Compacted single-static-chain prefix produced by post-seal compaction.
   * When set, the matcher must consume each segment in order against the
   * input path before evaluating this node's children. Saves one
   * SegmentNode + one staticChildren map per chain link removed. `null`
   * for un-compacted nodes.
   */
  staticPrefix: string[] | null;
}

/** True when the node holds at least one static child (inline or Record). */
export function hasAnyStaticChild(node: SegmentNode): boolean {
  return node.singleChildKey !== null || node.staticChildren !== null;
}

/** Iterate every static child of `node` regardless of whether the entry
 *  is in the inline cache or the promoted `staticChildren` Record. */
export function forEachStaticChild(
  node: SegmentNode,
  fn: (key: string, child: SegmentNode) => void,
): void {
  if (node.singleChildKey !== null && node.singleChildNext !== null) {
    fn(node.singleChildKey, node.singleChildNext);
  }
  if (node.staticChildren !== null) {
    for (const k in node.staticChildren) fn(k, node.staticChildren[k]!);
  }
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

export function createSegmentNode(): SegmentNode {
  return {
    store: null,
    staticChildren: null,
    singleChildKey: null,
    singleChildNext: null,
    paramChild: null,
    wildcardStore: null,
    wildcardName: null,
    wildcardOrigin: null,
    staticPrefix: null,
  };
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
  undoLog: SegmentTreeUndoLog,
): Result<void, RouterErrorData> {
  let node = root;
  const undoStart = undoLog.length;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;

    if (part.type === 'static') {
      const result = insertStaticSegments(node, part.segments, undoLog);
      if (typeof result === 'object' && 'kind' in result) {
        rollbackUndo(undoLog, undoStart);
        return err(result);
      }
      node = result;
    } else if (part.type === 'param') {
      const result = insertParamPart(node, part, testerCache, routeID, undoLog);
      if ('kind' in result) {
        rollbackUndo(undoLog, undoStart);
        return err(result);
      }
      node = result.node;
    } else {
      // wildcard — terminal
      const fail = attachWildcardTerminal(node, part, handlerIndex, undoLog);
      if (fail !== undefined) {
        rollbackUndo(undoLog, undoStart);
        return err(fail);
      }
      return;
    }
  }

  const fail = attachStoreTerminal(node, handlerIndex, undoLog);
  if (fail !== undefined) {
    rollbackUndo(undoLog, undoStart);
    return err(fail);
  }
}

/**
 * Walk a sequence of literal segments from `node`, creating fresh nodes
 * for missing children. Returns the descended node on success, or a
 * `RouterErrorData` carrier (no Result wrapper — caller runs rollback).
 */
function insertStaticSegments(
  node: SegmentNode,
  segs: ReadonlyArray<string>,
  undoLog: SegmentTreeUndoLog,
): SegmentNode | RouterErrorData {
  for (let s = 0; s < segs.length; s++) {
    const seg = segs[s]!;
    // Fast path 1: inline single-static-child cache hit (string compare).
    if (node.singleChildKey === seg && node.singleChildNext !== null && node.wildcardStore === null) {
      node = node.singleChildNext;
      continue;
    }
    // Fast path 2: promoted staticChildren Record hit.
    const sc = node.staticChildren;
    if (sc !== null && node.wildcardStore === null) {
      const child = sc[seg];
      if (child !== undefined) { node = child; continue; }
    }

    if (node.wildcardStore !== null) {
      return {
        kind: 'route-conflict',
        message: `Static route conflicts with existing wildcard '*${node.wildcardName}' at the same position`,
        segment: seg,
        conflictsWith: `*${node.wildcardName}`,
      };
    }

    // Inline-cache slot is empty AND no Record yet: store the child inline so
    // a node with exactly one static child never allocates a Record.
    if (node.singleChildKey === null && node.staticChildren === null) {
      const fresh = createSegmentNode();
      node.singleChildKey = seg;
      node.singleChildNext = fresh;
      undoLog.push({ k: UndoKind.SingleChildClear, n: node });
      node = fresh;
      continue;
    }

    // Either a different inline-cache key already occupies the slot, or the
    // Record was previously promoted. Promote the inline entry (if any) into
    // the Record before adding this new sibling so the walker only has to
    // consult one of inline/Record per node.
    let children = node.staticChildren;
    if (children === null) {
      children = Object.create(null) as Record<string, SegmentNode>;
      node.staticChildren = children;
      undoLog.push({ k: UndoKind.StaticChildrenInit, n: node });
    }
    if (node.singleChildKey !== null && node.singleChildNext !== null) {
      const promotedKey = node.singleChildKey;
      const promotedNext = node.singleChildNext;
      children[promotedKey] = promotedNext;
      node.singleChildKey = null;
      node.singleChildNext = null;
      undoLog.push({ k: UndoKind.SingleChildRestore, n: node, key: promotedKey, next: promotedNext });
      undoLog.push({ k: UndoKind.StaticChildAdd, p: children, key: promotedKey });
    }

    const fresh = createSegmentNode();
    children[seg] = fresh;
    undoLog.push({ k: UndoKind.StaticChildAdd, p: children, key: seg });
    node = fresh;
  }
  return node;
}

/**
 * Resolve or create the param sibling that matches `part` under `node`.
 * Returns `{ node }` on success or a `RouterErrorData` on conflict
 * (caller runs rollback).
 */
function insertParamPart(
  node: SegmentNode,
  part: { type: 'param'; name: string; pattern: string | null; optional: boolean },
  testerCache: Map<string, PatternTesterFn>,
  routeID: number,
  undoLog: SegmentTreeUndoLog,
): { node: SegmentNode } | RouterErrorData {
  if (node.wildcardStore !== null) {
    return {
      kind: 'route-conflict',
      message: `Parameter ':${part.name}' conflicts with existing wildcard '*${node.wildcardName}' at the same position`,
      segment: part.name,
      conflictsWith: `*${node.wildcardName}`,
    };
  }

  const testerOrErr = resolveOrCompileTester(part, testerCache, undoLog);
  if (isResolvedTesterError(testerOrErr)) return testerOrErr;
  const tester = testerOrErr;

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
    undoLog.push({ k: UndoKind.ParamChildSet, n: node });
    return { node: created.next };
  }

  let p: ParamSegment | null = node.paramChild;
  let prev: ParamSegment | null = null;
  let matched: ParamSegment | null = null;

  while (p !== null) {
    if (p.name === part.name && p.patternSource === part.pattern) {
      matched = p;
      break;
    }

    if (p.name === part.name && p.patternSource !== part.pattern) {
      return {
        kind: 'route-conflict',
        message: `Parameter ':${part.name}' has conflicting regex patterns`,
        segment: part.name,
        conflictsWith: `:${p.name}${p.patternSource !== null ? `(${p.patternSource})` : ''}`,
      };
    }

    if (p.patternSource === null && p.ownerRouteID !== routeID) {
      return {
        kind: 'route-conflict',
        message: `Parameter ':${part.name}' is unreachable — earlier sibling ':${p.name}' (registered by a different route) has no regex pattern and matches every value at this position. Add a regex pattern to disambiguate, or remove this route.`,
        segment: part.name,
        conflictsWith: p.name,
      };
    }

    prev = p;
    p = p.nextSibling;
  }

  if (matched !== null) return { node: matched.next };

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
  undoLog.push({ k: UndoKind.ParamSiblingAdd, prev: tail });
  return { node: fresh.next };
}

/**
 * Look up or compile the regex tester for a param's `pattern`. Returns
 * `null` for an unconstrained param, the cached/compiled tester on
 * success, or a `RouterErrorData` for a regex compile failure.
 */
/** Type guard so callers can narrow `resolveOrCompileTester` results
 *  without an `as` cast. RouterErrorData always carries a `kind` string;
 *  PatternTesterFn (function value) does not. */
export function isResolvedTesterError(
  result: PatternTesterFn | null | RouterErrorData,
): result is RouterErrorData {
  return result !== null && typeof result === 'object' && 'kind' in result;
}

function resolveOrCompileTester(
  part: { name: string; pattern: string | null },
  testerCache: Map<string, PatternTesterFn>,
  undoLog: SegmentTreeUndoLog,
): PatternTesterFn | null | RouterErrorData {
  if (part.pattern === null) return null;
  const cached = testerCache.get(part.pattern);
  if (cached !== undefined) return cached;
  try {
    const compiled = new RegExp(`^(?:${part.pattern})$`);
    const tester = buildPatternTester(part.pattern, compiled);
    testerCache.set(part.pattern, tester);
    undoLog.push({ k: UndoKind.TesterAdd, cache: testerCache, key: part.pattern });
    return tester;
  } catch (e) {
    return {
      kind: 'route-parse',
      message: `Invalid regex pattern in parameter ':${part.name}': ${e instanceof Error ? e.message : String(e)}`,
      segment: part.name,
      suggestion: 'Fix the regex syntax. Anchors are stripped automatically; do not include ^ or $.',
    };
  }
}

/**
 * Attach a wildcard terminal at `node`. Returns `undefined` on success
 * or a `RouterErrorData` on conflict.
 */
function attachWildcardTerminal(
  node: SegmentNode,
  part: { type: 'wildcard'; name: string; origin: 'star' | 'multi' },
  handlerIndex: number,
  undoLog: SegmentTreeUndoLog,
): RouterErrorData | undefined {
  if (node.wildcardStore !== null) {
    if (node.wildcardName !== part.name) {
      return {
        kind: 'route-conflict',
        message: `Wildcard '*${part.name}' conflicts with existing wildcard '*${node.wildcardName}'`,
        segment: part.name,
        conflictsWith: `*${node.wildcardName}`,
      };
    }
    return {
      kind: 'route-duplicate',
      message: 'Wildcard route already exists at this position',
      suggestion: 'Use a different path or HTTP method',
    };
  }

  if (node.paramChild !== null) {
    return {
      kind: 'route-conflict',
      message: `Wildcard '*${part.name}' conflicts with existing parameter at the same position`,
      segment: part.name,
      conflictsWith: `:${node.paramChild.name}`,
    };
  }

  node.wildcardStore = handlerIndex;
  node.wildcardName = part.name;
  node.wildcardOrigin = part.origin;
  undoLog.push({ k: UndoKind.WildcardSet, n: node });
  return undefined;
}

/**
 * Attach a non-wildcard terminal store at `node`. Returns `undefined`
 * on success or a `RouterErrorData` on duplicate.
 */
function attachStoreTerminal(
  node: SegmentNode,
  handlerIndex: number,
  undoLog: SegmentTreeUndoLog,
): RouterErrorData | undefined {
  if (node.store !== null) {
    return {
      kind: 'route-duplicate',
      message: 'Terminal route already exists at this position',
      suggestion: 'Use a different path or HTTP method',
    };
  }
  node.store = handlerIndex;
  undoLog.push({ k: UndoKind.StoreSet, n: node });
  return undefined;
}
