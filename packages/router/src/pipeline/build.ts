import type { MatchFn, MatchState } from '../matcher/match-state';
import type { PathNormalizer } from '../matcher/path-normalize';
import type { WildCodegenEntry } from '../codegen/walker-strategy';
import type { MatchOutput, RouterOptions } from '../types';
import type { RegistrationSnapshot } from './registration';

import { EMPTY_PARAMS, NullProtoObj, STATIC_META } from '../internal/null-proto-obj';
import { buildDecoder } from '../matcher/decoder';
import { createMatchState } from '../matcher/match-state';
import { buildPathNormalizer } from '../matcher/path-normalize';
import { createSegmentWalker } from '../matcher/segment-walk';
import { detectWildCodegenSpec } from '../codegen/walker-strategy';
import { MethodRegistry } from '../method-registry';

/**
 * The computed product of `Build.fromRegistration()`. Every field is a
 * direct input to either the codegen layer (B3) or the runtime match
 * dispatch (B4) — there is no internal state Build retains across calls.
 *
 * Closure capture is the consumer here: Router copies these references
 * into its own fields so the compiled matchImpl can read them without
 * paying a per-match property-access tax through `this.X`.
 */
export interface BuildResult<T> {
  /** Per-method walker function (or `null` for methods with no dynamic
   *  routes). Indexed by methodCode. */
  trees: Array<MatchFn | null>;
  /** True when at least one route registered a regex tester. Used by
   *  `detectSingleMethodWildSpec` to disqualify the inline static-prefix
   *  wildcard fast path when any tester would need to run. */
  anyTester: boolean;
  /** Pre-built MatchOutput indexed by [methodCode][path] — frozen objects
   *  shared across all hits to a static route, no per-match allocation. */
  staticOutputsByMethod: Array<Record<string, MatchOutput<T>> | undefined>;
  /** Methods that received at least one route (in declaration order).
   *  Tuple form keeps name+code together for the tight allowedMethods
   *  loop. */
  activeMethodCodes: ReadonlyArray<readonly [string, number]>;
  /** Method name → numeric code, prototype-less for proto-free O(1)
   *  lookup at every match. */
  methodCodes: Record<string, number>;
  /** Pre-allocated match-state container reused across calls. */
  matchState: MatchState;
  /** Compiled path normalizer — same emit helpers feed compileMatchFn so
   *  the cold allowedMethods path cannot drift from the hot match path. */
  normalizePath: PathNormalizer;
  // Resolved options cached for closure capture by emit code.
  ignoreTrailingSlash: boolean;
  caseSensitive: boolean;
  maxPathLength: number;
  maxSegmentLength: number;
}

/**
 * Compile a `RegistrationSnapshot` into the runtime-ready tables and
 * walker functions consumed by the codegen layer (B3) and the match
 * dispatch (B4).
 *
 * Pure function — no shared state across calls. Output is a struct of
 * references that Router transfers to its own fields so the compiled
 * matchImpl can closure-capture them without paying a property-access
 * tax through `this.X` on every match.
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

  // Per-method segment trees were built incrementally during add(); here
  // we just wire up walkers and detect specialized shapes per method.
  for (const [, code] of allCodes) {
    const segRoot = snapshot.segmentTrees[code];

    if (segRoot !== undefined && segRoot !== null) {
      trees[code] = createSegmentWalker(segRoot, decoder);
      continue;
    }

    trees[code] = null;
  }

  const anyTester = snapshot.testerCache.size > 0;

  // Pre-build the static MatchOutput objects so match() can return them
  // directly without allocating { value, params, meta } per hit.
  //
  // Layout: staticOutputs[methodCode] → NullProtoObj { path → MatchOutput }.
  // The compiled matchImpl indexes by methodCode first (constant under
  // the single-method optimization, so the outer access folds away at
  // JIT time) then by path. This is one fewer indirection than the
  // previous `staticOutputs[path][methodCode]` layout for routers that
  // register most paths under one verb (typical REST shapes).
  const staticOutputsByMethod: Array<Record<string, MatchOutput<T>> | undefined> = [];

  for (const path in snapshot.staticMap) {
    const arr = snapshot.staticMap[path]!;
    const registered = snapshot.staticRegistered[path]!;

    for (let mc = 0; mc < arr.length; mc++) {
      if (!registered[mc]) continue;

      let bucket = staticOutputsByMethod[mc];

      if (bucket === undefined) {
        bucket = new NullProtoObj() as Record<string, MatchOutput<T>>;
        staticOutputsByMethod[mc] = bucket;
      }

      bucket[path] = Object.freeze({
        value: arr[mc] as T,
        params: EMPTY_PARAMS,
        meta: STATIC_META,
      }) as MatchOutput<T>;
    }
  }

  // Cache the methods that actually received routes — `allowedMethods()`
  // iterates this instead of Object.entries(methodCodes) to skip the
  // six unused default HTTP verbs without per-call allocation.
  const activeMethodCodes: Array<readonly [string, number]> = [];

  for (const [name, code] of allCodes) {
    if (trees[code] != null || staticOutputsByMethod[code] !== undefined) {
      activeMethodCodes.push([name, code]);
    }
  }

  const ignoreTrailingSlash = options.ignoreTrailingSlash ?? true;
  const caseSensitive = options.caseSensitive ?? true;
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
    ignoreTrailingSlash,
    caseSensitive,
    maxPathLength,
    maxSegmentLength,
  };
}
