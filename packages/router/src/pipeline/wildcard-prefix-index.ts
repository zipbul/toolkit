import type { Result } from '@zipbul/result';
import type { RouterErrorData, RouterErrorKind } from '../types';
import type { PathPart } from '../builder/path-parser';

import { err } from '@zipbul/result';

export interface PrefixTrieNode {
  literalChildren: Record<string, PrefixTrieNode> | null;
  paramChild: PrefixTrieNode | null;
  paramName: string | null;
  regexParamChildren: PrefixTrieNode[] | null;
  regexAst: string | null;
  wildcardName: string | null;
  terminalMeta: RouteMeta | null;
  subtreeTerminalCount: number;
  subtreeWildcardCount: number;
}

export interface RouteMeta {
  routeIndex: number;
  path: string;
  expandedPath?: string;
  method: string;
  handlerId: number;
  optionsKey: string;
  isOptionalExpansion: boolean;
}

/**
 * Plan-result alias signal used during planning. The implementation never
 * exposes plan/visited/edges arrays — rollback walks the live trie via the
 * `CommitPlan` carrier instead, eliminating per-route allocation churn under
 * 100k mixed/wildcard-heavy.
 */
export interface CommitPlan {
  /** Trie nodes from root through the terminal/prefix-attachment node. */
  visited: PrefixTrieNode[];
  /** Static-key + parent for each fresh literal edge (rollback removes from parent.literalChildren). */
  freshLiteralEdges: Array<{ parent: PrefixTrieNode; key: string; literalChildrenWasNull: boolean }> | null;
  /** Parents that received a fresh paramChild (rollback nulls paramChild + paramName). */
  freshParamParents: PrefixTrieNode[] | null;
  /** Parents that received a fresh regex sibling at the end of regexParamChildren (rollback pops + nulls). */
  freshRegexParents: Array<{ parent: PrefixTrieNode; createdArray: boolean }> | null;
  hasWildcardTail: boolean;
  wildcardTailName: string | null;
}

export class WildcardPrefixIndex {
  private readonly roots = new Map<number, PrefixTrieNode>();
  private readonly maxRegexSiblingsPerSegment: number;
  private readonly aliasJournal: Array<{ existing: RouteMeta; alias: RouteMeta }> = [];

  constructor(maxRegexSiblingsPerSegment = 32) {
    this.maxRegexSiblingsPerSegment = maxRegexSiblingsPerSegment;
  }

  /**
   * Validate and (on success) commit a route into the per-method prefix
   * trie. Walks `parts` directly without an intermediate RoutePart[] copy,
   * mutates the trie inline, and returns either:
   *  - a `CommitPlan` describing exactly what was newly attached so a
   *    later rollback can detach it without a closure,
   *  - the literal `'alias'` for an optional-expansion duplicate against an
   *    identical-identity terminal, or
   *  - an `err()` for any conflict / unreachable / sibling-cap failure
   *    (the trie is reverted before returning).
   */
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

    for (let pi = 0; pi < parts.length; pi++) {
      const part = parts[pi]!;
      if (part.type === 'static') {
        const segs = part.segments;
        for (let si = 0; si < segs.length; si++) {
          const seg = segs[si]!;
          if (seg.length === 0) continue;
          if (node.wildcardName !== null) {
            partial.freshLiteralEdges = freshLiteralEdges;
            partial.freshParamParents = freshParamParents;
            partial.freshRegexParents = freshRegexParents;
            this.revert(partial, false);
            return err(routeUnreachable('ancestor wildcard makes this route unreachable', routeMeta));
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
            if (freshLiteralEdges === null) freshLiteralEdges = [];
            freshLiteralEdges.push({ parent: node, key: seg, literalChildrenWasNull });
            node = child;
          }
          visited.push(node);
        }
      } else if (part.type === 'param') {
        if (node.wildcardName !== null) {
          partial.freshLiteralEdges = freshLiteralEdges;
          partial.freshParamParents = freshParamParents;
          partial.freshRegexParents = freshRegexParents;
          this.revert(partial, false);
          return err(routeUnreachable('ancestor wildcard makes this route unreachable', routeMeta));
        }
        if (part.pattern !== null) {
          if (node.paramChild !== null) {
            partial.freshLiteralEdges = freshLiteralEdges;
            partial.freshParamParents = freshParamParents;
            partial.freshRegexParents = freshRegexParents;
            this.revert(partial, false);
            return err(routeConflict('a plain param sibling already covers this segment', routeMeta));
          }
          let siblings = node.regexParamChildren;
          if (siblings !== null && siblings.length >= this.maxRegexSiblingsPerSegment) {
            partial.freshLiteralEdges = freshLiteralEdges;
            partial.freshParamParents = freshParamParents;
            partial.freshRegexParents = freshRegexParents;
            this.revert(partial, false);
            return err(regexSiblingLimit(this.maxRegexSiblingsPerSegment, routeMeta));
          }
          let matched: PrefixTrieNode | null = null;
          if (siblings !== null) {
            for (let i = 0; i < siblings.length; i++) {
              const ex = siblings[i]!;
              if (ex.regexAst === part.pattern) { matched = ex; break; }
            }
          }
          if (matched === null && siblings !== null) {
            for (let i = 0; i < siblings.length; i++) {
              const ex = siblings[i]!;
              if (!safeRegexDisjoint(ex.regexAst!, part.pattern)) {
                partial.freshLiteralEdges = freshLiteralEdges;
                partial.freshParamParents = freshParamParents;
                partial.freshRegexParents = freshRegexParents;
                this.revert(partial, false);
                return err(routeConflict('regex param sibling overlap not provably disjoint', routeMeta));
              }
            }
          }
          if (matched !== null) {
            node = matched;
          } else {
            const fresh = createRegexNode(part.pattern);
            const createdArray = siblings === null;
            if (createdArray) {
              siblings = [];
              node.regexParamChildren = siblings;
            }
            siblings!.push(fresh);
            if (freshRegexParents === null) freshRegexParents = [];
            freshRegexParents.push({ parent: node, createdArray });
            node = fresh;
          }
          visited.push(node);
        } else {
          if (node.regexParamChildren !== null && node.regexParamChildren.length > 0) {
            partial.freshLiteralEdges = freshLiteralEdges;
            partial.freshParamParents = freshParamParents;
            partial.freshRegexParents = freshRegexParents;
            this.revert(partial, false);
            return err(routeConflict('a regex param sibling already covers this segment', routeMeta));
          }
          if (node.paramChild !== null && node.paramName !== part.name) {
            partial.freshLiteralEdges = freshLiteralEdges;
            partial.freshParamParents = freshParamParents;
            partial.freshRegexParents = freshRegexParents;
            this.revert(partial, false);
            return err(routeDuplicate(routeMeta));
          }
          if (node.paramChild !== null) {
            node = node.paramChild;
          } else {
            const fresh = createNode();
            node.paramName = part.name;
            node.paramChild = fresh;
            if (freshParamParents === null) freshParamParents = [];
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

    if (wildcardTailName !== null) {
      if (node.subtreeTerminalCount > 0 || node.subtreeWildcardCount > 0) {
        this.revert(partial, false);
        return err(routeUnreachable('a descendant terminal or wildcard already covers this prefix', routeMeta));
      }
      node.wildcardName = wildcardTailName;
      for (let i = 0; i < visited.length; i++) visited[i]!.subtreeWildcardCount++;
    } else {
      if (node.terminalMeta !== null) {
        if (!routeMeta.isOptionalExpansion) {
          this.revert(partial, false);
          return err(routeDuplicate(routeMeta));
        }
        if (sameTerminalIdentity(node.terminalMeta, routeMeta)) {
          this.recordAlias(node.terminalMeta, routeMeta);
          this.revert(partial, false);
          return 'alias';
        }
        this.revert(partial, false);
        return err(routeConflict('optional-expansion duplicate with different identity', routeMeta));
      }
      if (node.wildcardName !== null) {
        this.revert(partial, false);
        return err(routeUnreachable('a wildcard is registered at this exact prefix', routeMeta));
      }
      node.terminalMeta = routeMeta;
      for (let i = 0; i < visited.length; i++) visited[i]!.subtreeTerminalCount++;
    }

    return partial;
  }

  /**
   * Roll back the mutations made during the planning walk. `decrementCounters`
   * is true only when a successful commit had already bumped subtreeTerminalCount
   * / subtreeWildcardCount on every visited node. During in-walk failures the
   * counters were not yet bumped, so they must NOT be decremented.
   */
  revert(plan: CommitPlan, decrementCounters: boolean): void {
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
    if (plan.hasWildcardTail) terminalNode.wildcardName = null;
    else terminalNode.terminalMeta = null;
    const fle = plan.freshLiteralEdges;
    if (fle !== null) {
      for (let i = fle.length - 1; i >= 0; i--) {
        const e = fle[i]!;
        if (e.parent.literalChildren !== null) delete e.parent.literalChildren[e.key];
        if (e.literalChildrenWasNull) e.parent.literalChildren = null;
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
        if (r.parent.regexParamChildren !== null) {
          r.parent.regexParamChildren.pop();
          if (r.createdArray) r.parent.regexParamChildren = null;
        }
      }
    }
  }

  /**
   * Optional-expansion alias bookkeeping. The snapshot builder consumes the
   * journal after validation succeeds; the prefix index never mutates
   * counters for aliases.
   */
  recordAlias(existing: RouteMeta, alias: RouteMeta): void {
    this.aliasJournal.push({ existing, alias });
  }

  drainAliasJournal(): ReadonlyArray<{ existing: RouteMeta; alias: RouteMeta }> {
    return this.aliasJournal;
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

/**
 * Apply the inverse of a previously-committed plan: detaches every newly-
 * planned edge from its parent and decrements the subtree counters that the
 * commit incremented. Used by registration's rollback path; pushing the
 * plan itself as a tagged undo record (instead of a closure that captures
 * `plan`) avoids one closure allocation per route during high-volume builds.
 */
export function rollbackPlan(plan: CommitPlan): void {
  // The shared revert helper handles decrementCounters=true: a committed plan
  // had its counters bumped, so rollback decrements.
  const idx = WildcardPrefixIndex.prototype.revert as (this: unknown, p: CommitPlan, dec: boolean) => void;
  idx.call(null, plan, true);
}

function createNode(): PrefixTrieNode {
  return {
    literalChildren: null,
    paramChild: null,
    paramName: null,
    regexParamChildren: null,
    regexAst: null,
    wildcardName: null,
    terminalMeta: null,
    subtreeTerminalCount: 0,
    subtreeWildcardCount: 0,
  };
}

function createRegexNode(regexAst: string): PrefixTrieNode {
  const n = createNode();
  n.regexAst = regexAst;
  return n;
}

// Conservative disjointness gate: returns true only when overlap is provably
// impossible. Any uncertain case returns false so the caller emits
// route-conflict rather than admitting a possibly ambiguous regex sibling.
function safeRegexDisjoint(_a: string, _b: string): boolean {
  return false;
}

function sameTerminalIdentity(a: RouteMeta, b: RouteMeta): boolean {
  return a.method === b.method && a.handlerId === b.handlerId && a.optionsKey === b.optionsKey;
}

function routeDuplicate(meta: RouteMeta): RouterErrorData {
  return {
    kind: 'route-duplicate',
    message: `Route already exists: ${meta.method} ${meta.path}`,
    path: meta.path,
    method: meta.method,
    suggestion: 'Use a different path or HTTP method',
  };
}

function routeConflict(why: string, meta: RouteMeta): RouterErrorData {
  return {
    kind: 'route-conflict',
    message: `${meta.method} ${meta.path}: ${why}`,
    segment: meta.path,
    conflictsWith: meta.method,
    path: meta.path,
    method: meta.method,
  };
}

function routeUnreachable(why: string, meta: RouteMeta): RouterErrorData {
  return {
    kind: 'route-unreachable',
    message: `${meta.method} ${meta.path}: ${why}`,
    path: meta.path,
    method: meta.method,
  };
}

function regexSiblingLimit(cap: number, meta: RouteMeta): RouterErrorData {
  return {
    kind: 'regex-sibling-limit',
    message: `Too many regex param siblings at the same position (cap ${cap}): ${meta.method} ${meta.path}`,
    path: meta.path,
    method: meta.method,
    suggestion: `Reduce distinct regex constraints sharing this segment to ${cap} or fewer.`,
  };
}

// Re-export local kinds to keep the public RouterErrorKind alignment explicit.
export type { RouterErrorKind };
