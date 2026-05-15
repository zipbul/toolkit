/**
 * Public surface of the codegen layer (`new Function()`-emitted match
 * machinery). Cross-directory consumers import from this barrel only.
 */

export type { MatchCacheEntry, MatchConfig } from './emitter';
export { compileMatchFn } from './emitter';

export type { PathNormalizer } from './path-normalize';
export { buildPathNormalizer } from './path-normalize';

export { collectWarmupPaths, compileSegmentTree } from './segment-compile';

export type { FactoryCache } from './super-factory';
export {
  createFactoryCache,
  getOrCreateSuperFactory,
  computePresentBitmask,
} from './super-factory';

export { WARMUP_ITERATIONS } from './warmup';
export { tryCodegenStaticPrefixWildcard } from './wildcard-prefix-codegen';
