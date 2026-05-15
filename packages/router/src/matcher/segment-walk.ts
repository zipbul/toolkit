import type { MatchFn, MatchState } from './match-state';
import type { DecoderFn } from './decoder';
import type { SegmentNode } from './segment-tree';

import { TESTER_PASS } from './pattern-tester';
import { compactSegmentTree, hasAmbiguousNode } from './segment-tree-traversal';
import { getTenantFactor } from './factor-detect';
import { compileSegmentTree, collectWarmupPaths } from '../codegen/segment-compile';
import { tryCodegenStaticPrefixWildcard } from '../codegen/wildcard-prefix-codegen';
import { WARMUP_ITERATIONS } from '../codegen/warmup';

import { createIterativeWalker } from './walkers/iterative';
import { createFactoredWalker } from './walkers/factored';
import {
  createMultiPrefixFactoredWalker,
  createPrefixedFactoredWalker,
  tryDetectMultiPrefixFactor,
  tryDetectPrefixedFactor,
} from './walkers/prefix-factor';
import { createRecursiveWalker } from './walkers/recursive';

/**
 * Run the freshly-compiled walker once per major branch so JSC IC reaches
 * tier-up across the dominant code paths instead of just one. Without
 * warmup, first-call latency tail is multi-µs even for small trees because
 * tier-up otherwise happens on the user's first request.
 *
 * Single-input warmup is insufficient for trees whose hot work is split
 * across siblings — the IC only generalizes through paths it has actually
 * observed. `collectWarmupPaths()` returns one synthesized path per direct
 * child of the root.
 *
 * Errors from warmup invocations are swallowed: warmup is a best-effort
 * hint to the JIT, not a correctness check.
 */
function warmupCompiledWalker(
  walker: MatchFn,
  root: SegmentNode,
  state: MatchState,
): void {
  const paths = collectWarmupPaths(root);
  for (let it = 0; it < WARMUP_ITERATIONS; it++) {
    for (const p of paths) {
      try { walker(p, state); } catch { /* warmup failures are non-fatal */ }
    }
  }
}

/**
 * Walker tier dispatcher. Order matters — each tier short-circuits when
 * its precondition holds, with the cheapest hot-path tier first:
 *
 *   1. Root tenant factor (existing descriptor)        — Map lookup + fixed walk
 *   2. Single-chain prefix → tenant factor              — chain match + Map lookup
 *   3. Multi-prefix factor (one factor per root child)  — first-seg dispatch + Map lookup
 *   4. Static-prefix wildcard codegen                   — small trees only
 *   5. Full segment-tree codegen (≤256 nodes)           — JIT-friendly straight line
 *   6. Iterative walker                                 — non-ambiguous fallback
 *   7. Recursive backtracking walker                    — ambiguous fallback only
 *
 * Each tier returns its own MatchFn closure; the dispatcher itself does
 * not appear on the match hot path.
 */
export function createSegmentWalker(
  root: SegmentNode,
  decoder: DecoderFn,
  warmupState: MatchState,
): MatchFn {
  const factorAtEntry = getTenantFactor(root);
  if (factorAtEntry !== undefined) {
    return createFactoredWalker(root, decoder, factorAtEntry.keyToTerminal, factorAtEntry.sharedNext);
  }

  const prefixedFactor = tryDetectPrefixedFactor(root);
  if (prefixedFactor !== null) {
    return createPrefixedFactoredWalker(
      decoder,
      prefixedFactor.prefixSegs,
      prefixedFactor.factor.keyToTerminal,
      prefixedFactor.factor.sharedNext,
    );
  }

  const multiPrefixed = tryDetectMultiPrefixFactor(root);
  if (multiPrefixed !== null) {
    return createMultiPrefixFactoredWalker(decoder, multiPrefixed);
  }

  const compiledWild = tryCodegenStaticPrefixWildcard(root);
  if (compiledWild !== null) {
    warmupCompiledWalker(compiledWild, root, warmupState);
    return compiledWild;
  }

  const compiledFullPackage = compileSegmentTree(root);
  if (compiledFullPackage !== null) {
    const compiled = compiledFullPackage.factory(compiledFullPackage.testers, TESTER_PASS, decoder);
    warmupCompiledWalker(compiled, root, warmupState);
    return compiled;
  }

  // Codegen bailed — the tree is large enough that the iterative/recursive
  // path will be used. Run single-static-chain compaction here so the
  // walker pays only one node visit per merged chain rather than one per
  // segment. Compaction is destructive; no codegen attempt may follow.
  compactSegmentTree(root);

  if (!hasAmbiguousNode(root)) {
    return createIterativeWalker(root, decoder);
  }

  return createRecursiveWalker(root, decoder);
}
