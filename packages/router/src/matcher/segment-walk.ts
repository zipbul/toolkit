import type { SegmentNode } from '../tree';
import type { DecoderFn, MatchFn, MatchState } from '../types';

import { collectWarmupPaths, compileSegmentTree, tryCodegenStaticPrefixWildcard, WARMUP_ITERATIONS } from '../codegen';
import { compactSegmentTree, getTenantFactor, hasAmbiguousNode, TESTER_PASS } from '../tree';
import { createFactoredWalker } from './walkers/factored';
import { createIterativeWalker } from './walkers/iterative';
import {
  createMultiPrefixFactoredWalker,
  createPrefixedFactoredWalker,
  tryDetectMultiPrefixFactor,
  tryDetectPrefixedFactor,
} from './walkers/prefix-factor';
import { createRecursiveWalker } from './walkers/recursive';

function warmupCompiledWalker(walker: MatchFn, root: SegmentNode, state: MatchState): void {
  const paths = collectWarmupPaths(root);
  for (let it = 0; it < WARMUP_ITERATIONS; it++) {
    for (const p of paths) {
      walker(p, state);
    }
  }
}

export function createSegmentWalker(root: SegmentNode, decoder: DecoderFn, warmupState: MatchState): MatchFn {
  const factorAtEntry = getTenantFactor(root);
  if (factorAtEntry !== undefined) {
    return createFactoredWalker(decoder, factorAtEntry.keyToTerminal, factorAtEntry.sharedNext);
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

  compactSegmentTree(root);

  if (!hasAmbiguousNode(root)) {
    return createIterativeWalker(root, decoder);
  }

  return createRecursiveWalker(root, decoder);
}
