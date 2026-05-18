/**
 * Public surface of the build/match pipeline. Cross-directory consumers
 * (router.ts) import from this barrel only. Intra-directory members
 * (terminal-slab, wildcard-method-expand, wildcard-prefix-index, undo
 * dispatcher) are imported file-to-file inside src/pipeline/ — they are
 * not re-exported here because no external layer depends on them.
 */

export { buildFromRegistration } from './build';

export { MatchLayer } from './match';

export { Registration } from './registration';
