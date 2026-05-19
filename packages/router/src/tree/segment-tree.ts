import type { Result } from '@zipbul/result';

import { err } from '@zipbul/result';

import type { RouterErrorData } from '../types';
import type { ParamSegment, SegmentNode } from './node-types';
import type { PathPart } from './path-part';
import type { PatternTesterFn } from './pattern-tester';
import type { SegmentTreeUndoLog } from './undo';

import { RouterErrorKind } from '../types';
import { PathPartType, WildcardOrigin } from './path-part';
import { buildPatternTester } from './pattern-tester';
import { UndoKind, applyUndo } from './undo';

function hasAnyStaticChild(node: SegmentNode): boolean {
  return node.singleChildKey !== null || node.staticChildren !== null;
}

function forEachStaticChild(node: SegmentNode, fn: (key: string, child: SegmentNode) => void): void {
  if (node.singleChildKey !== null && node.singleChildNext !== null) {
    fn(node.singleChildKey, node.singleChildNext);
  }
  if (node.staticChildren !== null) {
    for (const k in node.staticChildren) {
      fn(k, node.staticChildren[k]!);
    }
  }
}

function createSegmentNode(): SegmentNode {
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
  for (let i = undo.length - 1; i >= start; i--) {
    applyUndo(undo[i]!);
  }
  undo.length = start;
}

function insertIntoSegmentTree(
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

    if (part.type === PathPartType.Static) {
      const result = insertStaticSegments(node, part.segments, undoLog);
      if (typeof result === 'object' && 'kind' in result) {
        rollbackUndo(undoLog, undoStart);
        return err(result);
      }
      node = result;
    } else if (part.type === PathPartType.Param) {
      const result = insertParamPart(node, part, testerCache, routeID, undoLog);
      if ('kind' in result) {
        rollbackUndo(undoLog, undoStart);
        return err(result);
      }
      node = result.node;
    } else {
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

function insertStaticSegments(
  node: SegmentNode,
  segs: ReadonlyArray<string>,
  undoLog: SegmentTreeUndoLog,
): SegmentNode | RouterErrorData {
  for (let s = 0; s < segs.length; s++) {
    const seg = segs[s]!;
    if (node.singleChildKey === seg && node.singleChildNext !== null && node.wildcardStore === null) {
      node = node.singleChildNext;
      continue;
    }
    const sc = node.staticChildren;
    if (sc !== null && node.wildcardStore === null) {
      const child = sc[seg];
      if (child !== undefined) {
        node = child;
        continue;
      }
    }

    if (node.wildcardStore !== null) {
      return {
        kind: RouterErrorKind.RouteConflict,
        message: `Static route conflicts with existing wildcard '*${node.wildcardName}' at the same position`,
        segment: seg,
        conflictsWith: `*${node.wildcardName}`,
        suggestion: `Remove the wildcard '*${node.wildcardName}' or move the static segment to a different prefix.`,
      };
    }

    if (node.singleChildKey === null && node.staticChildren === null) {
      const fresh = createSegmentNode();
      node.singleChildKey = seg;
      node.singleChildNext = fresh;
      undoLog.push({ k: UndoKind.SingleChildClear, n: node });
      node = fresh;
      continue;
    }

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

function insertParamPart(
  node: SegmentNode,
  part: { type: PathPartType.Param; name: string; pattern: string | null; optional: boolean },
  testerCache: Map<string, PatternTesterFn>,
  routeID: number,
  undoLog: SegmentTreeUndoLog,
): { node: SegmentNode } | RouterErrorData {
  if (node.wildcardStore !== null) {
    return {
      kind: RouterErrorKind.RouteConflict,
      message: `Parameter ':${part.name}' conflicts with existing wildcard '*${node.wildcardName}' at the same position`,
      segment: part.name,
      conflictsWith: `*${node.wildcardName}`,
      suggestion: `Remove the wildcard '*${node.wildcardName}' or move the parameter to a different prefix.`,
    };
  }

  const testerOrErr = resolveOrCompileTester(part, testerCache, undoLog);
  if (isResolvedTesterError(testerOrErr)) {
    return testerOrErr;
  }
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
        kind: RouterErrorKind.RouteConflict,
        message: `Parameter ':${part.name}' has conflicting regex patterns`,
        segment: part.name,
        conflictsWith: `:${p.name}${p.patternSource !== null ? `(${p.patternSource})` : ''}`,
        suggestion: 'Unify the regex pattern across both routes, or rename one parameter.',
      };
    }

    if (p.patternSource === null && p.ownerRouteID !== routeID) {
      return {
        kind: RouterErrorKind.RouteConflict,
        message: `Parameter ':${part.name}' is unreachable — earlier sibling ':${p.name}' (registered by a different route) has no regex pattern and matches every value at this position.`,
        segment: part.name,
        conflictsWith: p.name,
        suggestion: 'Add a regex pattern to disambiguate, or remove this route.',
      };
    }

    prev = p;
    p = p.nextSibling;
  }

  if (matched !== null) {
    return { node: matched.next };
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
  undoLog.push({ k: UndoKind.ParamSiblingAdd, prev: tail });
  return { node: fresh.next };
}

function isResolvedTesterError(result: PatternTesterFn | null | RouterErrorData): result is RouterErrorData {
  return result !== null && typeof result === 'object' && 'kind' in result;
}

function resolveOrCompileTester(
  part: { name: string; pattern: string | null },
  testerCache: Map<string, PatternTesterFn>,
  undoLog: SegmentTreeUndoLog,
): PatternTesterFn | null | RouterErrorData {
  if (part.pattern === null) {
    return null;
  }
  const cached = testerCache.get(part.pattern);
  if (cached !== undefined) {
    return cached;
  }
  try {
    const compiled = new RegExp(`^(?:${part.pattern})$`);
    const tester = buildPatternTester(part.pattern, compiled);
    testerCache.set(part.pattern, tester);
    undoLog.push({ k: UndoKind.TesterAdd, cache: testerCache, key: part.pattern });
    return tester;
  } catch (e) {
    return {
      kind: RouterErrorKind.RouteParse,
      message: `Invalid regex pattern in parameter ':${part.name}': ${e instanceof Error ? e.message : String(e)}`,
      segment: part.name,
      suggestion: 'Fix the regex syntax. Anchors are stripped automatically; do not include ^ or $.',
    };
  }
}

function attachWildcardTerminal(
  node: SegmentNode,
  part: { type: PathPartType.Wildcard; name: string; origin: WildcardOrigin },
  handlerIndex: number,
  undoLog: SegmentTreeUndoLog,
): RouterErrorData | undefined {
  if (node.wildcardStore !== null) {
    if (node.wildcardName !== part.name) {
      return {
        kind: RouterErrorKind.RouteConflict,
        message: `Wildcard '*${part.name}' conflicts with existing wildcard '*${node.wildcardName}'`,
        segment: part.name,
        conflictsWith: `*${node.wildcardName}`,
        suggestion: `Rename one wildcard so the prefix has a single capture name, or split the routes across HTTP methods.`,
      };
    }
    return {
      kind: RouterErrorKind.RouteDuplicate,
      message: 'Wildcard route already exists at this position',
      suggestion: 'Use a different path or HTTP method.',
    };
  }

  if (node.paramChild !== null) {
    return {
      kind: RouterErrorKind.RouteConflict,
      message: `Wildcard '*${part.name}' conflicts with existing parameter at the same position`,
      segment: part.name,
      conflictsWith: `:${node.paramChild.name}`,
      suggestion: `Remove the parameter ':${node.paramChild.name}' or change the wildcard to a static prefix.`,
    };
  }

  node.wildcardStore = handlerIndex;
  node.wildcardName = part.name;
  node.wildcardOrigin = part.origin;
  undoLog.push({ k: UndoKind.WildcardSet, n: node });
  return undefined;
}

function attachStoreTerminal(node: SegmentNode, handlerIndex: number, undoLog: SegmentTreeUndoLog): RouterErrorData | undefined {
  if (node.store !== null) {
    return {
      kind: RouterErrorKind.RouteDuplicate,
      message: 'Terminal route already exists at this position',
      suggestion: 'Use a different path or HTTP method.',
    };
  }
  node.store = handlerIndex;
  undoLog.push({ k: UndoKind.StoreSet, n: node });
  return undefined;
}

export {
  attachStoreTerminal,
  attachWildcardTerminal,
  createSegmentNode,
  forEachStaticChild,
  hasAnyStaticChild,
  insertIntoSegmentTree,
  insertParamPart,
  insertStaticSegments,
  isResolvedTesterError,
  resolveOrCompileTester,
};
export type { ParamSegment, SegmentNode } from './node-types';
