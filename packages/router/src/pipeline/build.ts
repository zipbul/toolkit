import type { MatchFn, MatchState } from '../matcher/match-state';
import type { PathNormalizer } from '../matcher/path-normalize';
import type { MatchOutput, RouteParams, RouterOptions } from '../types';
import type { RegistrationSnapshot } from './registration';

import { EMPTY_PARAMS, NullProtoObj, STATIC_META } from '../internal/null-proto-obj';
import { decoder } from '../matcher/decoder';
import { createMatchState } from '../matcher/match-state';
import { buildPathNormalizer } from '../matcher/path-normalize';
import { createSegmentWalker } from '../matcher/segment-walk';
import { MethodRegistry } from '../method-registry';

/**
 * Configuration for compiled match implementation.
 */
export interface BuildResult<T> {
  trees: Array<MatchFn | null>;
  anyTester: boolean;
  staticOutputsByMethod: Array<Record<string, MatchOutput<T>> | undefined>;
  /** Per-static-path 32-bit method-availability mask (bit `methodCode`). */
  staticPathMethodMask: Record<string, number>;
  activeMethodCodes: ReadonlyArray<readonly [string, number]>;
  methodCodes: Record<string, number>;
  matchState: MatchState;
  normalizePath: PathNormalizer;
  terminalSlab: Int32Array;
  paramsFactories: Array<((u: string, v: Int32Array) => RouteParams) | null>;
  ignoreTrailingSlash: boolean;
  caseSensitive: boolean;
}

/**
 * Compile a `RegistrationSnapshot` into runtime tables.
 */
export function buildFromRegistration<T>(
  snapshot: RegistrationSnapshot<T>,
  options: RouterOptions,
  methodRegistry: MethodRegistry,
): BuildResult<T> {
  const allCodes = methodRegistry.getAllCodes();
  const methodCodes = methodRegistry.getCodeMap() as Record<string, number>;
  const anyTester = snapshot.anyTester;

  // Materialize the static-output buckets up front so the per-method
  // walker/active-codes loop below can decide activeness in one pass.
  const staticOutputsByMethod: Array<Record<string, MatchOutput<T>> | undefined> = [];
  for (let mc = 0; mc < snapshot.staticByMethod.length; mc++) {
    const inputBucket = snapshot.staticByMethod[mc];
    if (inputBucket === undefined) continue;

    const outBucket = new NullProtoObj() as Record<string, MatchOutput<T>>;
    staticOutputsByMethod[mc] = outBucket;

    for (const path in inputBucket) {
      outBucket[path] = Object.freeze({
        value: inputBucket[path] as T,
        params: EMPTY_PARAMS,
        meta: STATIC_META,
      }) as MatchOutput<T>;
    }
  }

  // Fused loop — for each method:
  //   1. attach a segment walker to `trees[code]` if a tree exists
  //   2. push `[name, code]` into activeMethodCodes if the method has
  //      either a walker or a static bucket
  // Earlier pipeline ran two passes; bench `bench/method-research/
  // E-build-loops-fusion.bench.ts` measures this single pass at
  // 1.16-1.21× the dual-pass cost across 7/15/32 methods.
  const trees: Array<MatchFn | null> = [];
  const activeMethodCodes: Array<readonly [string, number]> = [];
  for (const [name, code] of allCodes) {
    const segRoot = snapshot.segmentTrees[code];
    let walker: MatchFn | null = null;
    if (segRoot !== undefined && segRoot !== null) {
      walker = createSegmentWalker(segRoot, decoder);
    }
    trees[code] = walker;
    if (walker !== null || staticOutputsByMethod[code] !== undefined) {
      activeMethodCodes.push([name, code]);
    }
  }

  const ignoreTrailingSlash = options.trailingSlash !== 'strict';
  const caseSensitive = options.pathCaseSensitive ?? true;

  const normalizePath = buildPathNormalizer({
    trimSlash: ignoreTrailingSlash,
    lowerCase: !caseSensitive,
  });

  return {
    trees,
    anyTester,
    staticOutputsByMethod,
    staticPathMethodMask: snapshot.staticPathMethodMask,
    activeMethodCodes,
    methodCodes,
    matchState: createMatchState(options.maxParams ?? 64),
    normalizePath,
    terminalSlab: snapshot.terminalSlab,
    paramsFactories: snapshot.paramsFactories,
    ignoreTrailingSlash,
    caseSensitive,
  };
}
