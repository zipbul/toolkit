import type { PatternTesterFn } from './pattern-tester';

/**
 * Segment-based route tree. Each node corresponds to one URL segment
 * (no intra-segment splits). Built at Router.build() directly from
 * registered route parts.
 *
 * These types live in a dedicated module so `./undo` can reference them
 * without importing back from `./segment-tree` — breaking the otherwise
 * circular type dependency that dpdm flags.
 */
interface SegmentNode {
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

interface ParamSegment {
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

export type { ParamSegment, SegmentNode };
