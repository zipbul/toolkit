import type { Result } from '@zipbul/result';

import { err } from '@zipbul/result';

import type { PathPart } from '../tree';
import type { RouterErrorData } from '../types';

import { PathPartType } from '../tree';
import { RouterErrorKind } from '../types';

interface PrefixTrieNode {
  literalChildren: Record<string, PrefixTrieNode> | null;
  paramChild: PrefixTrieNode | null;
  paramName: string | null;
  terminalMeta: RouteMeta | null;
  subtreeTerminalCount: number;
  subtreeWildcardCount: number;
}

const regexParamChildrenStore = new WeakMap<PrefixTrieNode, PrefixTrieNode[]>();
const regexAstStore = new WeakMap<PrefixTrieNode, string>();
const wildcardNameStore = new WeakMap<PrefixTrieNode, string>();

function getRegexParamChildren(node: PrefixTrieNode): PrefixTrieNode[] | null {
  return regexParamChildrenStore.get(node) ?? null;
}
function setRegexParamChildren(node: PrefixTrieNode, value: PrefixTrieNode[] | null): void {
  if (value === null) {
    regexParamChildrenStore.delete(node);
  } else {
    regexParamChildrenStore.set(node, value);
  }
}
function getRegexAst(node: PrefixTrieNode): string | null {
  return regexAstStore.get(node) ?? null;
}
function setRegexAst(node: PrefixTrieNode, value: string): void {
  regexAstStore.set(node, value);
}
function getWildcardName(node: PrefixTrieNode): string | null {
  return wildcardNameStore.get(node) ?? null;
}
function setWildcardName(node: PrefixTrieNode, value: string | null): void {
  if (value === null) {
    wildcardNameStore.delete(node);
  } else {
    wildcardNameStore.set(node, value);
  }
}

interface RouteMeta {
  routeIndex: number;
  path: string;
  method: string;
  handlerId: number;
  isOptionalExpansion: boolean;
}

interface CommitPlan {
  visited: PrefixTrieNode[];
  freshLiteralEdges: Array<{ parent: PrefixTrieNode; key: string; literalChildrenWasNull: boolean }> | null;
  freshParamParents: PrefixTrieNode[] | null;
  freshRegexParents: Array<{ parent: PrefixTrieNode; createdArray: boolean }> | null;
  hasWildcardTail: boolean;
  wildcardTailName: string | null;
}

class WildcardPrefixIndex {
  private readonly roots = new Map<number, PrefixTrieNode>();

  planAndCommit(
    methodCode: number,
    parts: ReadonlyArray<PathPart>,
    routeMeta: RouteMeta,
  ): Result<CommitPlan | 'alias', RouterErrorData> {
    const root = this.rootFor(methodCode);
    const visited: PrefixTrieNode[] = [root];
    let freshLiteralEdges: CommitPlan['freshLiteralEdges'] = null;
    let freshParamParents: CommitPlan['freshParamParents'] = null;
    let freshRegexParents: CommitPlan['freshRegexParents'] = null;
    const partial: CommitPlan = {
      visited,
      freshLiteralEdges: null,
      freshParamParents: null,
      freshRegexParents: null,
      hasWildcardTail: false,
      wildcardTailName: null,
    };

    let node = root;
    let wildcardTailName: string | null = null;

    const abort = (data: RouterErrorData): Result<never, RouterErrorData> => {
      partial.freshLiteralEdges = freshLiteralEdges;
      partial.freshParamParents = freshParamParents;
      partial.freshRegexParents = freshRegexParents;
      applyRevert(partial, false);
      return err(data);
    };

    for (let pi = 0; pi < parts.length; pi++) {
      const part = parts[pi]!;
      if (part.type === PathPartType.Static) {
        const segs = part.segments;
        for (let si = 0; si < segs.length; si++) {
          const seg = segs[si]!;
          if (seg.length === 0) {
            continue;
          }
          if (getWildcardName(node) !== null) {
            return abort(routeUnreachable('ancestor wildcard makes this route unreachable', routeMeta));
          }
          let children = node.literalChildren;
          let child = children !== null ? children[seg] : undefined;
          if (child !== undefined) {
            node = child;
          } else {
            const literalChildrenWasNull = children === null;
            if (literalChildrenWasNull) {
              children = Object.create(null) as Record<string, PrefixTrieNode>;
              node.literalChildren = children;
            }
            child = createNode();
            children![seg] = child;
            if (freshLiteralEdges === null) {
              freshLiteralEdges = [];
            }
            freshLiteralEdges.push({ parent: node, key: seg, literalChildrenWasNull });
            node = child;
          }
          visited.push(node);
        }
      } else if (part.type === PathPartType.Param) {
        if (getWildcardName(node) !== null) {
          return abort(routeUnreachable('ancestor wildcard makes this route unreachable', routeMeta));
        }
        if (part.pattern !== null) {
          if (node.paramChild !== null) {
            return abort(routeConflict('a plain param sibling already covers this segment', routeMeta));
          }
          let siblings = getRegexParamChildren(node);
          let matched: PrefixTrieNode | null = null;
          if (siblings !== null) {
            for (let i = 0; i < siblings.length; i++) {
              const ex = siblings[i]!;
              if (getRegexAst(ex) === part.pattern) {
                matched = ex;
                break;
              }
            }
          }
          if (matched === null && siblings !== null && siblings.length > 0) {
            return abort(routeConflict('regex param sibling overlap not provably disjoint', routeMeta));
          }
          if (matched !== null) {
            node = matched;
          } else {
            const fresh = createRegexNode(part.pattern);
            const createdArray = siblings === null;
            if (createdArray) {
              siblings = [];
              setRegexParamChildren(node, siblings);
            }
            siblings!.push(fresh);
            if (freshRegexParents === null) {
              freshRegexParents = [];
            }
            freshRegexParents.push({ parent: node, createdArray });
            node = fresh;
          }
          visited.push(node);
        } else {
          const existingRegexSiblings = getRegexParamChildren(node);
          if (existingRegexSiblings !== null && existingRegexSiblings.length > 0) {
            return abort(routeConflict('a regex param sibling already covers this segment', routeMeta));
          }
          if (node.paramChild !== null && node.paramName !== part.name) {
            return abort(routeDuplicate(routeMeta));
          }
          if (node.paramChild !== null) {
            node = node.paramChild;
          } else {
            const fresh = createNode();
            node.paramName = part.name;
            node.paramChild = fresh;
            if (freshParamParents === null) {
              freshParamParents = [];
            }
            freshParamParents.push(node);
            node = fresh;
          }
          visited.push(node);
        }
      } else {
        wildcardTailName = part.name;
      }
    }

    partial.freshLiteralEdges = freshLiteralEdges;
    partial.freshParamParents = freshParamParents;
    partial.freshRegexParents = freshRegexParents;
    partial.hasWildcardTail = wildcardTailName !== null;
    partial.wildcardTailName = wildcardTailName;

    const attachResult =
      wildcardTailName !== null
        ? attachWildcardTail(node, wildcardTailName, visited, partial, routeMeta)
        : attachTerminal(node, visited, partial, routeMeta);
    if (attachResult !== undefined) {
      return attachResult;
    }

    return partial;
  }

  private rootFor(methodCode: number): PrefixTrieNode {
    let r = this.roots.get(methodCode);
    if (r === undefined) {
      r = createNode();
      this.roots.set(methodCode, r);
    }
    return r;
  }
}

function applyRevert(plan: CommitPlan, decrementCounters: boolean): void {
  const visited = plan.visited;
  if (decrementCounters) {
    if (plan.hasWildcardTail) {
      for (let i = 0; i < visited.length; i++) {
        const seen = visited[i]!;
        seen.subtreeWildcardCount = Math.max(0, seen.subtreeWildcardCount - 1);
      }
    } else {
      for (let i = 0; i < visited.length; i++) {
        const seen = visited[i]!;
        seen.subtreeTerminalCount = Math.max(0, seen.subtreeTerminalCount - 1);
      }
    }
  }
  const terminalNode = visited[visited.length - 1]!;
  if (plan.hasWildcardTail) {
    setWildcardName(terminalNode, null);
  } else {
    terminalNode.terminalMeta = null;
  }
  const fle = plan.freshLiteralEdges;
  if (fle !== null) {
    for (let i = fle.length - 1; i >= 0; i--) {
      const e = fle[i]!;
      if (e.parent.literalChildren !== null) {
        delete e.parent.literalChildren[e.key];
      }
      if (e.literalChildrenWasNull) {
        e.parent.literalChildren = null;
      }
    }
  }
  const fpp = plan.freshParamParents;
  if (fpp !== null) {
    for (let i = fpp.length - 1; i >= 0; i--) {
      const p = fpp[i]!;
      p.paramChild = null;
      p.paramName = null;
    }
  }
  const frp = plan.freshRegexParents;
  if (frp !== null) {
    for (let i = frp.length - 1; i >= 0; i--) {
      const r = frp[i]!;
      const siblings = getRegexParamChildren(r.parent);
      if (siblings !== null) {
        siblings.pop();
        if (r.createdArray) {
          setRegexParamChildren(r.parent, null);
        }
      }
    }
  }
}

function rollbackPlan(plan: CommitPlan): void {
  applyRevert(plan, true);
}

function createNode(): PrefixTrieNode {
  return {
    literalChildren: null,
    paramChild: null,
    paramName: null,
    terminalMeta: null,
    subtreeTerminalCount: 0,
    subtreeWildcardCount: 0,
  };
}

function createRegexNode(regexAst: string): PrefixTrieNode {
  const n = createNode();
  setRegexAst(n, regexAst);
  return n;
}

function sameTerminalIdentity(a: RouteMeta, b: RouteMeta): boolean {
  return a.method === b.method && a.handlerId === b.handlerId;
}

function routeDuplicate(meta: RouteMeta): RouterErrorData {
  return {
    kind: RouterErrorKind.RouteDuplicate,
    message: `Route already exists: ${meta.method} ${meta.path}`,
    path: meta.path,
    method: meta.method,
    suggestion: 'Use a different path or HTTP method',
  };
}

function routeConflict(why: string, meta: RouteMeta): RouterErrorData {
  return {
    kind: RouterErrorKind.RouteConflict,
    message: `${meta.method} ${meta.path}: ${why}`,
    segment: meta.path,
    conflictsWith: 'sibling at the same position',
    path: meta.path,
    method: meta.method,
    suggestion: 'Remove or rename one of the colliding routes so each position resolves unambiguously.',
  };
}

function attachWildcardTail(
  node: PrefixTrieNode,
  name: string,
  visited: PrefixTrieNode[],
  partial: CommitPlan,
  routeMeta: RouteMeta,
): Result<never, RouterErrorData> | undefined {
  if (node.subtreeTerminalCount > 0 || node.subtreeWildcardCount > 0) {
    applyRevert(partial, false);
    return err(routeUnreachable('a descendant terminal or wildcard already covers this prefix', routeMeta));
  }
  setWildcardName(node, name);
  for (let i = 0; i < visited.length; i++) {
    visited[i]!.subtreeWildcardCount++;
  }
  return undefined;
}

function attachTerminal(
  node: PrefixTrieNode,
  visited: PrefixTrieNode[],
  partial: CommitPlan,
  routeMeta: RouteMeta,
): Result<'alias', RouterErrorData> | undefined {
  if (node.terminalMeta !== null) {
    if (!routeMeta.isOptionalExpansion) {
      applyRevert(partial, false);
      return err(routeDuplicate(routeMeta));
    }
    if (sameTerminalIdentity(node.terminalMeta, routeMeta)) {
      applyRevert(partial, false);
      return 'alias';
    }
    applyRevert(partial, false);
    return err(routeConflict('optional-expansion duplicate with different identity', routeMeta));
  }
  if (getWildcardName(node) !== null) {
    applyRevert(partial, false);
    return err(routeUnreachable('a wildcard is registered at this exact prefix', routeMeta));
  }
  node.terminalMeta = routeMeta;
  for (let i = 0; i < visited.length; i++) {
    visited[i]!.subtreeTerminalCount++;
  }
  return undefined;
}

function routeUnreachable(why: string, meta: RouteMeta): RouterErrorData {
  return {
    kind: RouterErrorKind.RouteUnreachable,
    message: `${meta.method} ${meta.path}: ${why}`,
    path: meta.path,
    method: meta.method,
    segment: meta.path,
    conflictsWith: 'an earlier wildcard or terminal at this prefix',
    suggestion: 'Reorder registrations so the broader wildcard is added last, or remove the unreachable route.',
  };
}

export { rollbackPlan, WildcardPrefixIndex };
export type { CommitPlan, RouteMeta };
