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
  /** Static children keyed by segment literal. NullProtoObj for property-access
   *  speed (no Map.get function-call dispatch, no prototype-chain lookup). */
  staticChildren: Record<string, SegmentNode> | null;
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
  /** Subtree rooted at this param. */
  next: SegmentNode;
  /** Linked-list pointer to the next param alternative at the same position.
   *  Optional-expansion of `/users/:a?/:b?` produces sibling params (`:a`
   *  and `:b`) that share an `ownerHandler` and live at the same position. */
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

export interface CompiledTesterProvider {
  /** Compile a tester for a pattern string, reusing an existing compilation
   *  where possible. Returns null if the pattern is invalid. */
  getTester(patternSource: string): PatternTesterFn | null;
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
 * Two testers are equivalent for sibling-merge purposes when both are null
 * (no constraint) or both compile to the same pattern source. We use the
 * tester reference identity since `testerCache` deduplicates by pattern;
 * different-source patterns produce different tester objects.
 */
function testersEquivalent(a: PatternTesterFn | null, b: PatternTesterFn | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a === b;
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
      const segs = extractSegments(part.value);

      for (const seg of segs) {
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
        node.paramChild = { name: part.name, tester, next: createSegmentNode(), nextSibling: null };
        node = node.paramChild.next;
      } else {
        // Walk the sibling chain looking for a matching (name, pattern) pair
        // to descend into. A sibling that differs in either is a legitimate
        // alternative at this position — append to the chain so the walker
        // can try alternatives with backtracking.
        let p: ParamSegment | null = node.paramChild;
        let prev: ParamSegment | null = null;
        let matched: ParamSegment | null = null;

        while (p !== null) {
          if (p.name === part.name && testersEquivalent(p.tester, tester)) {
            matched = p;
            break;
          }

          prev = p;
          p = p.nextSibling;
        }

        if (matched === null) {
          const fresh: ParamSegment = { name: part.name, tester, next: createSegmentNode(), nextSibling: null };
          // prev is guaranteed non-null here — paramChild was not null and we
          // walked to the end of the chain.
          prev!.nextSibling = fresh;
          node = fresh.next;
        } else {
          node = matched.next;
        }
      }
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
