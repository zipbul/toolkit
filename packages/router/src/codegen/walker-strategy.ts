import type { SegmentNode } from '../matcher/segment-tree';
import type { MatchConfig } from './emitter';

/**
 * Per-method walker strategy chosen at build time.
 *
 * The router's match path can take one of four shapes; the choice
 * depends on tree topology, registered options, and route count:
 *
 *   SpecializedWild — router-shape fast path. compileMatchFn emits a
 *     tiny matchImpl that inlines the static-prefix wildcard probes
 *     directly, skipping method-code dispatch / static lookup / tree
 *     walk altogether. Eligible only when a router has exactly one
 *     active method, no statics, no cache, no opt-defaults, no testers,
 *     no case-fold, and the method's tree IS a static-prefix wildcard
 *     with ≤ 8 entries.
 *
 *   Generic — emitter generic codegen. The default matchImpl shape:
 *     method dispatch + path preprocess + static lookup + cache +
 *     dynamic walk + cache write.
 *
 *   Iterative — segment-walk's `createIterativeWalker`. Used by
 *     createSegmentWalker when codegen bails (size budget, fanout) and
 *     the tree is *not* ambiguous (no static + param/wildcard
 *     alternation at the same node).
 *
 *   Recursive — segment-walk's recursive backtracking walker. Last
 *     resort for ambiguous trees that need backtracking the iterative
 *     walker doesn't generate.
 *
 * The decision points are staged: `createSegmentWalker` chooses among
 * codegen / Iterative / Recursive per method via a try-cascade;
 * `compileMatchFn` then chooses SpecializedWild or Generic for the
 * matchImpl shape via `detectSingleMethodWildSpec`. Trying to merge
 * these into one upfront `selectWalker` call would require predicting
 * codegen success (which depends on ctx.bail during emit) — the
 * cascade is cheaper and equivalent in outcome.
 */
export enum WalkerStrategy {
  SpecializedWild = 'SpecializedWild',
  Generic = 'Generic',
  Iterative = 'Iterative',
  Recursive = 'Recursive',
}

/**
 * Static-prefix wildcard codegen entry. Built when a method's tree
 * shape qualifies for inline `startsWith(prefix + '/', 1)` dispatch
 * (file-server / asset-CDN style routers).
 */
export interface WildCodegenEntry {
  prefix: string;
  wildcardOrigin: 'star' | 'multi';
  wildcardName: string;
  wildcardStore: number;
}

/**
 * Detect whether `root` matches the static-prefix wildcard shape:
 *   root -> staticChildren[name] -> wildcardStore (no deeper structure)
 *
 * Returns the entry list when the shape matches, null otherwise. Used
 * both to drive segment-walk's in-walker codegen (`tryCodegenStaticPrefix
 * Wildcard`) and to drive emitter's matchImpl-level specialization
 * (via `detectSingleMethodWildSpec`).
 */
export function detectWildCodegenSpec(root: SegmentNode): WildCodegenEntry[] | null {
  if (root.paramChild !== null || root.wildcardStore !== null || root.store !== null) return null;
  if (root.staticChildren === null) return null;

  const entries: WildCodegenEntry[] = [];

  for (const key in root.staticChildren) {
    const child = root.staticChildren[key]!;

    if (child.staticChildren !== null) return null;
    if (child.paramChild !== null) return null;
    if (child.store !== null) return null;
    if (child.wildcardStore === null) return null;

    entries.push({
      prefix: key,
      wildcardOrigin: child.wildcardOrigin!,
      wildcardName: child.wildcardName!,
      wildcardStore: child.wildcardStore,
    });
  }

  if (entries.length === 0) return null;

  return entries;
}

/**
 * Shape-specialization gate for `compileMatchFn`. Returns the wild
 * entry list when the *router* qualifies for the inline static-prefix
 * wildcard fast path; null otherwise.
 *
 * Conditions: single active method, no statics, no cache, no
 * opt-defaults, no testers, no case-fold, that method's tree IS a
 * static-prefix wildcard, prefix count ≤ 8.
 *
 * Past ~8 prefixes, the inline `startsWith` chain loses to the
 * segment-tree walker's NullProtoObj keying (5× slower at 50 prefixes
 * measured). The cap keeps file-server routers (≤ 8 top-level dirs)
 * on the inline win without paying the regression at higher counts.
 */
export function detectSingleMethodWildSpec<T>(cfg: MatchConfig<T>): WildCodegenEntry[] | null {
  if (cfg.hasAnyStatic) return null;
  if (cfg.useCache) return null;
  if (cfg.hasOptDefaults) return null;
  if (cfg.anyTester) return null;
  if (cfg.lowerCase) return null;
  if (cfg.activeMethodCodes.length !== 1) return null;

  const [, activeCode] = cfg.activeMethodCodes[0]!;

  if (cfg.trees[activeCode] == null) return null;

  const wild = cfg.wildSpecs[activeCode];

  if (wild === null || wild === undefined) return null;
  if (wild.length > 8) return null;

  return wild;
}
