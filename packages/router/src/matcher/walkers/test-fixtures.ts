/**
 * Shared SegmentNode fixtures for the walker unit specs. Hoisted here so
 * the four per-walker specs (iterative / recursive / factored /
 * prefix-factor) don't redefine the same literal four times — a change
 * to the SegmentNode shape surfaces in one location instead of four.
 *
 * Test-only — not exported from any production index module.
 */
import type { SegmentNode } from '../../tree';

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
  wildcardOrigin: 'star',
  staticPrefix: null,
};

export const MULTI_WILDCARD_NODE: SegmentNode = {
  ...STAR_WILDCARD_NODE,
  wildcardOrigin: 'multi',
  wildcardStore: 11,
};
