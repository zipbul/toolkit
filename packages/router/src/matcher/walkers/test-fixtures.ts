import type { SegmentNode } from '../../tree';

import { WildcardOrigin } from '../../tree';

export const STORE_NODE: SegmentNode = {
  store: 7,
  staticChildren: null,
  singleChildKey: null,
  singleChildNext: null,
  paramChild: null,
  wildcardStore: null,
  wildcardName: null,
  wildcardOrigin: null,
  staticPrefix: null,
};

export const STAR_WILDCARD_NODE: SegmentNode = {
  store: null,
  staticChildren: null,
  singleChildKey: null,
  singleChildNext: null,
  paramChild: null,
  wildcardStore: 9,
  wildcardName: 'rest',
  wildcardOrigin: WildcardOrigin.Star,
  staticPrefix: null,
};

export const MULTI_WILDCARD_NODE: SegmentNode = {
  ...STAR_WILDCARD_NODE,
  wildcardOrigin: WildcardOrigin.Multi,
  wildcardStore: 11,
};
