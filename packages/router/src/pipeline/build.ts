import type { MatchFn, MatchState } from '../matcher/match-state';
import type { PathNormalizer } from '../matcher/path-normalize';
import type { MatchOutput, RouteParams, RouterOptions } from '../types';
import type { RegistrationSnapshot } from './registration';

import { EMPTY_PARAMS, NullProtoObj, STATIC_META } from '../internal/null-proto-obj';
import { buildDecoder } from '../matcher/decoder';
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
  activeMethodCodes: ReadonlyArray<readonly [string, number]>;
  methodCodes: Record<string, number>;
  matchState: MatchState;
  normalizePath: PathNormalizer;
  terminalHandlers: number[];
  isWildcardByTerminal: boolean[];
  paramsFactories: Array<((u: string, v: Int32Array) => RouteParams) | null>;
  ignoreTrailingSlash: boolean;
  caseSensitive: boolean;
  maxPathLength: number;
  maxSegmentLength: number;
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
  const decoder = buildDecoder();
  const trees: Array<MatchFn | null> = [];

  for (const [, code] of allCodes) {
    const segRoot = snapshot.segmentTrees[code];
    if (segRoot !== undefined && segRoot !== null) {
      trees[code] = createSegmentWalker(segRoot, decoder);
      continue;
    }
    trees[code] = null;
  }

  const anyTester = snapshot.testerCache.size > 0;
  
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

  const activeMethodCodes: Array<readonly [string, number]> = [];
  for (const [name, code] of allCodes) {
    if (trees[code] != null || staticOutputsByMethod[code] !== undefined) {
      activeMethodCodes.push([name, code]);
    }
  }

  const ignoreTrailingSlash = options.trailingSlash !== 'strict';
  const caseSensitive = options.pathCaseSensitive ?? true;
  const maxPathLength = options.maxPathLength ?? 2048;
  const maxSegmentLength = options.maxSegmentLength ?? 1024;

  const normalizePath = buildPathNormalizer({
    checkPathLen: Number.isFinite(maxPathLength),
    maxPathLen: maxPathLength,
    trimSlash: ignoreTrailingSlash,
    lowerCase: !caseSensitive,
    checkSegLen: Number.isFinite(maxSegmentLength),
    maxSegLen: maxSegmentLength,
  });

  return {
    trees,
    anyTester,
    staticOutputsByMethod,
    activeMethodCodes,
    methodCodes,
    matchState: createMatchState(),
    normalizePath,
    terminalHandlers: snapshot.terminalHandlers,
    isWildcardByTerminal: snapshot.isWildcardByTerminal,
    paramsFactories: snapshot.paramsFactories,
    ignoreTrailingSlash,
    caseSensitive,
    maxPathLength,
    maxSegmentLength,
  };
}
