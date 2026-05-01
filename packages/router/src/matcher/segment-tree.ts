import type { Result } from '@zipbul/result';
import type { RouterErrorData } from '../types';
import type { PatternTesterFn } from './pattern-tester';
import type { PathPart } from '../builder/path-parser';

import { err } from '@zipbul/result';
import { buildPatternTester } from './pattern-tester';

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
  /** First handlerIndex that introduced this param. Two siblings sharing the
   *  same ownerHandler come from one route's optional-param expansion (e.g.
   *  `/users/:a?/:b?` deliberately creates `:a` and `:b` siblings under the
   *  same handler) and bypass the unreachable-sibling check below. */
  ownerHandler: number;
  /** Subtree rooted at this param. */
  next: SegmentNode;
  /** Linked-list pointer to the next param alternative at the same position. */
  nextSibling: ParamSegment | null;
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

/**
 * Insert one expanded route (no optional markers) into the segment tree.
 * Validates conflicts against the current tree state and returns an error
 * `Result` for any of:
 *   - `route-conflict`: static-vs-wildcard, param-vs-wildcard, conflicting
 *     wildcard name, wildcard after sibling param, same-name param with a
 *     different regex, or unreachable sibling.
 *   - `route-duplicate`: terminal node already has a store, or a same-name
 *     wildcard already registered at this position.
 *   - `regex-unsafe`-ish bail when the regex source fails to compile.
 */
export function insertIntoSegmentTree(
  root: SegmentNode,
  parts: PathPart[],
  handlerIndex: number,
  testerCache: Map<string, PatternTesterFn>,
): Result<void, RouterErrorData> {
  let node = root;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;

    if (part.type === 'static') {
      const segs = extractSegments(part.value);

      for (const seg of segs) {
        if (node.wildcardStore !== null) {
          return err({
            kind: 'route-conflict',
            message: `Static route conflicts with existing wildcard '*${node.wildcardName}' at the same position`,
            segment: seg,
            conflictsWith: `*${node.wildcardName}`,
          });
        }

        if (node.staticChildren === null) {
          node.staticChildren = Object.create(null) as Record<string, SegmentNode>;
        }

        let child = node.staticChildren[seg];

        if (child === undefined) {
          child = createSegmentNode();
          node.staticChildren[seg] = child;
        }

        node = child;
      }
    } else if (part.type === 'param') {
      if (node.wildcardStore !== null) {
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
          } catch (e) {
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
        node.paramChild = {
          name: part.name,
          tester,
          patternSource: part.pattern,
          ownerHandler: handlerIndex,
          next: createSegmentNode(),
          nextSibling: null,
        };
        node = node.paramChild.next;
      } else {
        // Walk the sibling chain. Three outcomes:
        //   1. Exact match (same name, same patternSource) → reuse subtree.
        //   2. Same name but different patternSource → conflict.
        //   3. Earlier sibling has no tester and was registered by a different
        //      route → unreachable-sibling conflict (the catchall consumes
        //      every value at this position so the new sibling never tests).
        //   4. Otherwise → append as new sibling, descend its empty subtree.
        let p: ParamSegment | null = node.paramChild;
        let prev: ParamSegment | null = null;
        let matched: ParamSegment | null = null;

        while (p !== null) {
          if (p.name === part.name && p.patternSource === part.pattern) {
            matched = p;
            break;
          }

          if (p.name === part.name && p.patternSource !== part.pattern) {
            return err({
              kind: 'route-conflict',
              message: `Parameter ':${part.name}' has conflicting regex patterns`,
              segment: part.name,
              conflictsWith: `:${p.name}${p.patternSource !== null ? `(${p.patternSource})` : ''}`,
            });
          }

          if (p.patternSource === null && p.ownerHandler !== handlerIndex) {
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
          const fresh: ParamSegment = {
            name: part.name,
            tester,
            patternSource: part.pattern,
            ownerHandler: handlerIndex,
            next: createSegmentNode(),
            nextSibling: null,
          };
          // prev is non-null — paramChild was not null and we walked to the
          // end of the chain without matching.
          prev!.nextSibling = fresh;
          node = fresh.next;
        } else {
          node = matched.next;
        }
      }
    } else {
      // wildcard — terminal
      if (node.wildcardStore !== null) {
        if (node.wildcardName !== part.name) {
          return err({
            kind: 'route-conflict',
            message: `Wildcard '*${part.name}' conflicts with existing wildcard '*${node.wildcardName}'`,
            segment: part.name,
            conflictsWith: `*${node.wildcardName}`,
          });
        }

        return err({
          kind: 'route-duplicate',
          message: `Wildcard route already exists at this position`,
          suggestion: 'Use a different path or HTTP method',
        });
      }

      if (node.paramChild !== null) {
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

      return;
    }
  }

  if (node.store !== null) {
    return err({
      kind: 'route-duplicate',
      message: 'Route already exists',
      suggestion: 'Use a different path or HTTP method',
    });
  }

  node.store = handlerIndex;
}

function extractSegments(staticLabel: string): string[] {
  const segs: string[] = [];
  let current = '';

  for (let i = 0; i < staticLabel.length; i++) {
    const ch = staticLabel.charCodeAt(i);

    if (ch === 47) {
      if (current.length > 0) {
        segs.push(current);
        current = '';
      }
    } else {
      current += staticLabel.charAt(i);
    }
  }

  if (current.length > 0) segs.push(current);

  return segs;
}
