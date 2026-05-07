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

export type SegmentTreeUndoLog = Array<() => void>;

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

/**
 * Insert one expanded route (no optional markers) into the segment tree.
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

  const fail = (data: RouterErrorData): Result<void, RouterErrorData> => {
    for (let i = undo.length - 1; i >= undoStart; i--) {
      undo[i]!();
    }
    undo.length = undoStart;

    return err(data);
  };

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;

    if (part.type === 'static') {
      const segs = part.segments;

      for (const seg of segs) {
        if (node.wildcardStore !== null) {
          return fail({
            kind: 'route-conflict',
            message: `Static route conflicts with existing wildcard '*${node.wildcardName}' at the same position`,
            segment: seg,
            conflictsWith: `*${node.wildcardName}`,
          });
        }

        if (node.staticChildren === null) {
          const owner = node;
          node.staticChildren = Object.create(null) as Record<string, SegmentNode>;
          undo.push(() => { owner.staticChildren = null; });
        }

        let child = node.staticChildren[seg];

        if (child === undefined) {
          const children = node.staticChildren;
          child = createSegmentNode();
          node.staticChildren[seg] = child;
          undo.push(() => { delete children[seg]; });
        }

        node = child;
      }
    } else if (part.type === 'param') {
      if (node.wildcardStore !== null) {
        return fail({
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
            undo.push(() => { testerCache.delete(part.pattern!); });
          } catch (e) {
            return fail({
              kind: 'route-parse',
              message: `Invalid regex pattern in parameter ':${part.name}': ${e instanceof Error ? e.message : String(e)}`,
              segment: part.name,
              suggestion: 'Fix the regex syntax. Anchors are stripped automatically; do not include ^ or $.',
            });
          }
        }
      }

      if (node.paramChild === null) {
        const owner = node;
        node.paramChild = {
          name: part.name,
          tester,
          patternSource: part.pattern,
          ownerRouteID: routeID,
          next: createSegmentNode(),
          nextSibling: null,
        };
        undo.push(() => { owner.paramChild = null; });
        node = node.paramChild.next;
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
            return fail({
              kind: 'route-conflict',
              message: `Parameter ':${part.name}' has conflicting regex patterns`,
              segment: part.name,
              conflictsWith: `:${p.name}${p.patternSource !== null ? `(${p.patternSource})` : ''}`,
            });
          }

          if (p.patternSource === null && p.ownerRouteID !== routeID) {
            return fail({
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
          // Cap regex/param sibling chain length per segment position.
          let siblingCount = 1;
          let cursor: ParamSegment | null = node.paramChild;
          while (cursor !== null) { siblingCount++; cursor = cursor.nextSibling; }
          if (siblingCount > MAX_REGEX_SIBLINGS_PER_SEGMENT) {
            return fail({
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
          prev!.nextSibling = fresh;
          undo.push(() => { prev!.nextSibling = null; });
          node = fresh.next;
        } else {
          node = matched.next;
        }
      }
    } else {
      // wildcard — terminal
      if (node.wildcardStore !== null) {
        if (node.wildcardName !== part.name) {
          return fail({
            kind: 'route-conflict',
            message: `Wildcard '*${part.name}' conflicts with existing wildcard '*${node.wildcardName}'`,
            segment: part.name,
            conflictsWith: `*${node.wildcardName}`,
          });
        }

        return fail({
          kind: 'route-duplicate',
          message: 'Wildcard route already exists at this position',
          suggestion: 'Use a different path or HTTP method',
        });
      }

      if (node.paramChild !== null) {
        return fail({
          kind: 'route-conflict',
          message: `Wildcard '*${part.name}' conflicts with existing parameter at the same position`,
          segment: part.name,
          conflictsWith: `:${node.paramChild.name}`,
        });
      }

      node.wildcardStore = handlerIndex;
      node.wildcardName = part.name;
      node.wildcardOrigin = part.origin;
      undo.push(() => {
        node.wildcardStore = null;
        node.wildcardName = null;
        node.wildcardOrigin = null;
      });

      return;
    }
  }

  if (node.store !== null) {
    return fail({
      kind: 'route-duplicate',
      message: 'Terminal route already exists at this position',
      suggestion: 'Use a different path or HTTP method',
    });
  }

  node.store = handlerIndex;
  undo.push(() => { node.store = null; });
}
