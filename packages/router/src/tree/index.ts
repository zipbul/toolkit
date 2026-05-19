/**
 * Public surface of the segment-tree data model. All cross-directory
 * consumers (builder, codegen, matcher, pipeline) MUST import through
 * this barrel — deep imports into individual files are forbidden so
 * the module's internal structure can evolve without rippling churn.
 */

export type { PathPart } from './path-part';
export { PathPartType, WildcardOrigin } from './path-part';

export type { SegmentNode, ParamSegment } from './segment-tree';
export { createSegmentNode, forEachStaticChild, hasAnyStaticChild, insertIntoSegmentTree } from './segment-tree';

export type { SegmentTreeUndoLog } from './undo';
export { UndoKind, applyUndo, pushStaticBucketResetUndo, pushStaticMapDeleteUndo } from './undo';

export { compactSegmentTree, hasAmbiguousNode } from './traversal';

export type { TenantFactor } from './factor-detect';
export { detectTenantFactor, getTenantFactor, setTenantFactor } from './factor-detect';

export type { PatternTesterFn } from './pattern-tester';
export { TESTER_PASS } from './pattern-tester';
