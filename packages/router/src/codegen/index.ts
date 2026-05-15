/**
 * Public surface of the codegen layer (`new Function()`-emitted match
 * machinery). Cross-directory consumers import from this barrel only.
 */

export type { MatchCacheEntry, MatchConfig } from './emitter';
export { compileMatchFn } from './emitter';

export type { NormalizeCfg, PathNormalizer } from './path-normalize';
export {
  emitTrailingSlashTrim,
  emitLowerCase,
  buildPathNormalizer,
} from './path-normalize';

export type { CompiledPackage } from './segment-compile';
export { collectWarmupPaths, compileSegmentTree } from './segment-compile';

export type { SuperFactoryFn, FactoryCache } from './super-factory';
export {
  createFactoryCache,
  getOrCreateSuperFactory,
  computePresentBitmask,
} from './super-factory';

export type { WildCodegenEntry } from './walker-strategy';
export { detectWildCodegenSpec } from './walker-strategy';

export { WARMUP_ITERATIONS } from './warmup';
export { tryCodegenStaticPrefixWildcard } from './wildcard-prefix-codegen';
