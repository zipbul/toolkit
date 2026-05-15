/**
 * Public surface of the build/match pipeline (Registration, BuildResult,
 * MatchLayer, prefix-index, terminal-slab). Cross-directory consumers
 * import from this barrel only.
 */

export type { BuildResult } from './build';
export { buildFromRegistration } from './build';

export { IdentityRegistry } from './identity-registry';
export { MatchLayer } from './match';

export type { RegistrationSnapshot } from './registration';
export { Registration } from './registration';

export {
  TERMINAL_SLOTS,
  TERMINAL_HANDLER_OFFSET,
  TERMINAL_IS_WILDCARD_OFFSET,
  TERMINAL_PRESENT_BITMASK_OFFSET,
  packTerminalSlab,
} from './terminal-slab';

export {
  WILDCARD_METHOD,
  expandWildcardMethodRoutes,
} from './wildcard-method-expand';

export type {
  PrefixTrieNode,
  RouteMeta,
  CommitPlan,
} from './wildcard-prefix-index';
export { WildcardPrefixIndex, rollbackPlan } from './wildcard-prefix-index';
