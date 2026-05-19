import type { PatternTesterFn } from './pattern-tester';

import { WildcardOrigin } from './path-part';

interface SegmentNode {
  store: number | null;
  staticChildren: Record<string, SegmentNode> | null;
  singleChildKey: string | null;
  singleChildNext: SegmentNode | null;
  paramChild: ParamSegment | null;
  wildcardStore: number | null;
  wildcardName: string | null;
  wildcardOrigin: WildcardOrigin | null;
  staticPrefix: string[] | null;
}

interface ParamSegment {
  name: string;
  tester: PatternTesterFn | null;
  patternSource: string | null;
  ownerRouteID: number;
  next: SegmentNode;
  nextSibling: ParamSegment | null;
}

export type { ParamSegment, SegmentNode };
