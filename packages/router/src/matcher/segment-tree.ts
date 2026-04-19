import type { PatternTesterFn } from '../types';
import type { PathPart } from '../builder/path-parser';
import type { RegexSafetyOptions } from '../types';

import { buildPatternTester } from './pattern-tester';

/**
 * Segment-based route tree. Each node corresponds to one URL segment
 * (no intra-segment splits). Built at Router.build() directly from
 * registered route parts — never by walking the LCP-compressed radix tree.
 */
export interface SegmentNode {
  /** Terminal handler index when the URL ends here exactly. */
  store: number | null;
  /** Static children, keyed by segment literal. */
  staticChildren: Map<string, SegmentNode> | null;
  /** Single param child (param name and optional regex tester). */
  paramChild: ParamSegment | null;
  /** Wildcard at this position. */
  wildcardStore: number | null;
  wildcardName: string | null;
  wildcardOrigin: 'star' | 'multi' | null;
}

export interface ParamSegment {
  name: string;
  tester: PatternTesterFn | null;
  next: SegmentNode;
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

export interface CompiledTesterProvider {
  /** Compile a tester for a pattern string, reusing an existing compilation
   *  where possible. Returns null if the pattern is invalid. */
  getTester(patternSource: string): PatternTesterFn | null;
}

/**
 * Insert one expanded route (no optional markers) into the segment tree.
 * Returns false if the parts contain shapes we can't represent here —
 * though by construction, expanded parts from path-parser + RadixBuilder
 * expansion are always insertable.
 */
export function insertIntoSegmentTree(
  root: SegmentNode,
  parts: PathPart[],
  handlerIndex: number,
  regexSafety: RegexSafetyOptions | undefined,
  testerCache: Map<string, PatternTesterFn>,
): boolean {
  let node = root;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;

    if (part.type === 'static') {
      // part.value is like '/users/' or '/posts' — split into real segments
      const segs = extractSegments(part.value);

      for (const seg of segs) {
        if (node.staticChildren === null) node.staticChildren = new Map();

        let child = node.staticChildren.get(seg);

        if (child === undefined) {
          child = createSegmentNode();
          node.staticChildren.set(seg, child);
        }

        node = child;
      }
    } else if (part.type === 'param') {
      let tester: PatternTesterFn | null = null;

      if (part.pattern !== null) {
        const cached = testerCache.get(part.pattern);

        if (cached !== undefined) {
          tester = cached;
        } else {
          try {
            const compiled = new RegExp(`^(?:${part.pattern})$`);

            tester = buildPatternTester(part.pattern, compiled, {
              maxExecutionMs: regexSafety?.maxExecutionMs,
            });
            testerCache.set(part.pattern, tester);
          } catch {
            return false;
          }
        }
      }

      if (node.paramChild === null) {
        node.paramChild = { name: part.name, tester, next: createSegmentNode() };
      } else if (node.paramChild.name !== part.name) {
        // Same position already bound to a different param name — segment walker
        // only supports single-param-per-position. Builder also rejects this
        // via a route-conflict error, but defend anyway.
        return false;
      }

      node = node.paramChild.next;
    } else {
      // wildcard — terminal
      node.wildcardStore = handlerIndex;
      node.wildcardName = part.name;
      node.wildcardOrigin = part.origin;

      return true;
    }
  }

  node.store = handlerIndex;

  return true;
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
