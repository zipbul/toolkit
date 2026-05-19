import type { PathNormalizer } from '../codegen';
import type { MatchFn, MatchOutput, MatchState, RouteParams, RouterOptions } from '../types';
import type { RegistrationSnapshot } from './registration';

import { buildPathNormalizer } from '../codegen';
import { EMPTY_PARAMS, STATIC_META, createNullProtoBucket } from '../internal';
import { createMatchState, createSegmentWalker, decoder } from '../matcher';
import { MethodRegistry } from '../method-registry';

export interface BuildResult<T> {
  trees: Array<MatchFn | null>;
  staticOutputsByMethod: Array<Record<string, MatchOutput<T>> | undefined>;
  staticByPath: Record<string, { mask: number; outputs: Array<MatchOutput<T> | undefined> }>;
  staticPathMethodMask: Record<string, number>;
  activeMethodCodes: ReadonlyArray<readonly [string, number]>;
  methodCodes: Readonly<Record<string, number>>;
  matchState: MatchState;
  normalizePath: PathNormalizer;
  terminalSlab: Int32Array;
  paramsFactories: Array<((presentBitmask: number, u: string, v: Int32Array) => RouteParams) | null>;
  ignoreTrailingSlash: boolean;
  caseSensitive: boolean;
}

export function buildFromRegistration<T>(
  snapshot: RegistrationSnapshot<T>,
  options: RouterOptions,
  methodRegistry: MethodRegistry,
): BuildResult<T> {
  const allCodes = methodRegistry.getAllCodes();
  const methodCodes = methodRegistry.getCodeMap();

  const staticOutputsByMethod: Array<Record<string, MatchOutput<T>> | undefined> = [];
  const staticByPath: Record<string, { mask: number; outputs: Array<MatchOutput<T> | undefined> }> = createNullProtoBucket();
  for (let mc = 0; mc < snapshot.staticByMethod.length; mc++) {
    const inputBucket = snapshot.staticByMethod[mc];
    if (inputBucket === undefined) {
      continue;
    }

    const outBucket = createNullProtoBucket<MatchOutput<T>>();
    staticOutputsByMethod[mc] = outBucket;

    for (const path in inputBucket) {
      const output = Object.freeze({
        value: inputBucket[path] as T,
        params: EMPTY_PARAMS,
        meta: STATIC_META,
      }) as MatchOutput<T>;
      outBucket[path] = output;

      let entry = staticByPath[path];
      if (entry === undefined) {
        entry = { mask: 0, outputs: [] };
        staticByPath[path] = entry;
      }
      entry.mask |= 1 << mc;
      entry.outputs[mc] = output;
    }
  }

  const matchState = createMatchState(snapshot.maxParamsObserved);

  const trees: Array<MatchFn | null> = [];
  const activeMethodCodes: Array<readonly [string, number]> = [];
  for (const [name, code] of allCodes) {
    const segRoot = snapshot.segmentTrees[code];
    let walker: MatchFn | null = null;
    if (segRoot !== undefined && segRoot !== null) {
      walker = createSegmentWalker(segRoot, decoder, matchState);
    }
    trees[code] = walker;
    if (walker !== null || staticOutputsByMethod[code] !== undefined) {
      activeMethodCodes.push([name, code]);
    }
  }

  const ignoreTrailingSlash = options.ignoreTrailingSlash ?? true;
  const caseSensitive = options.pathCaseSensitive ?? true;

  const normalizePath = buildPathNormalizer({
    trimSlash: ignoreTrailingSlash,
    lowerCase: !caseSensitive,
  });

  return {
    trees,
    staticOutputsByMethod,
    staticByPath,
    staticPathMethodMask: snapshot.staticPathMethodMask,
    activeMethodCodes,
    methodCodes,
    matchState,
    normalizePath,
    terminalSlab: snapshot.terminalSlab,
    paramsFactories: snapshot.paramsFactories,
    ignoreTrailingSlash,
    caseSensitive,
  };
}
