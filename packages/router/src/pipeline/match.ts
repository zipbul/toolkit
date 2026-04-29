import type { HttpMethod } from '@zipbul/shared';

import type { MatchCacheEntry } from '../codegen/emitter';
import type { RouterCache } from '../cache';
import type { MatchFn, MatchState } from '../matcher/match-state';
import type { PathNormalizer } from '../matcher/path-normalize';
import type { MatchOutput } from '../types';

import { NullProtoObj } from '../internal/null-proto-obj';

/**
 * Dependencies the MatchLayer requires from the build pipeline. Every
 * field is closure-captured by the layer's methods — no shared mutable
 * state with Router beyond what is enumerated here.
 */
export interface MatchLayerDeps<T> {
  normalizePath: PathNormalizer;
  matchState: MatchState;
  activeMethodCodes: ReadonlyArray<readonly [string, number]>;
  staticOutputsByMethod: Array<Record<string, MatchOutput<T>> | undefined>;
  trees: Array<MatchFn | null>;
  hitCacheByMethod: Map<number, RouterCache<MatchCacheEntry<T>>> | undefined;
  missCacheByMethod: Map<number, Set<string>> | undefined;
}

/**
 * Cold-path runtime concerns: `allowedMethods()` (404 vs 405
 * disambiguation) and `clearCache()` (cache reset).
 *
 * **Hot-path `match()` is *not* here.** Routing it through this layer
 * adds a method-dispatch hop that breaks JSC's monomorphic IC on the
 * critical path (verified empirically: static match 300 ps → 13 ns,
 * param match +5 ns). Router holds matchImpl directly and dispatches
 * inline. This layer owns only the cold-path concerns where the extra
 * indirection is irrelevant.
 *
 * Constructed only when `Router.build()` succeeds — its mere existence
 * is the "router is built" signal at the Router boundary.
 */
export class MatchLayer<T> {
  private readonly normalizePath: PathNormalizer;
  private readonly matchState: MatchState;
  private readonly activeMethodCodes: ReadonlyArray<readonly [string, number]>;
  private readonly staticOutputsByMethod: Array<Record<string, MatchOutput<T>> | undefined>;
  private readonly trees: Array<MatchFn | null>;
  private readonly hitCacheByMethod: Map<number, RouterCache<MatchCacheEntry<T>>> | undefined;
  private readonly missCacheByMethod: Map<number, Set<string>> | undefined;

  constructor(deps: MatchLayerDeps<T>) {
    this.normalizePath = deps.normalizePath;
    this.matchState = deps.matchState;
    this.activeMethodCodes = deps.activeMethodCodes;
    this.staticOutputsByMethod = deps.staticOutputsByMethod;
    this.trees = deps.trees;
    this.hitCacheByMethod = deps.hitCacheByMethod;
    this.missCacheByMethod = deps.missCacheByMethod;
  }

  /**
   * Returns the HTTP methods registered for `path`. Cold-path companion
   * to `match()` — HTTP adapters call this only after `match()` returns
   * null to disambiguate "no route at all" from "wrong method on
   * existing path".
   *
   *   const out = router.match(method, path);
   *   if (out !== null) return respond(out);
   *   const allowed = router.allowedMethods(path);
   *   if (allowed.length === 0) return respond404();
   *   return respond405(allowed);   // adapter shapes the 405/Allow header
   *
   * Cost profile:
   *   - Preprocessing (path-length / query strip / slash trim / case
   *     fold / seg-length scan) runs once via `normalizePath`.
   *   - Iteration is over `activeMethodCodes` only — the six
   *     pre-registered but unused default HTTP verbs are excluded at
   *     build time.
   *   - Per active method: O(1) static-map lookup; only when no static
   *     hit does the method's tree walker run (one call), reusing a
   *     single pre-allocated `state.params` across iterations.
   *   - matchImpl is never invoked — no duplicated preprocessing.
   */
  allowedMethods(path: string): HttpMethod[] {
    const sp = this.normalizePath(path);

    if (sp === null) return [];

    const out: HttpMethod[] = [];
    const state = this.matchState;
    // Tree walkers write into `state.params` on success. We never read
    // the params here — only the boolean return — so a single shared
    // container is enough. The next match() call reassigns
    // state.params anyway.
    const sharedParams = new NullProtoObj() as Record<string, string | undefined>;

    state.params = sharedParams;

    const active = this.activeMethodCodes;

    for (let i = 0; i < active.length; i++) {
      const entry = active[i]!;
      const methodCode = entry[1];
      const bucket = this.staticOutputsByMethod[methodCode];

      if (bucket !== undefined && bucket[sp] !== undefined) {
        out.push(entry[0] as HttpMethod);
        continue;
      }

      const tr = this.trees[methodCode];

      if (tr === null || tr === undefined) continue;

      if (tr(sp, state)) {
        out.push(entry[0] as HttpMethod);
      }
    }

    return out;
  }

  clearCache(): void {
    if (this.hitCacheByMethod !== undefined) {
      for (const cache of this.hitCacheByMethod.values()) {
        cache.clear();
      }
    }

    if (this.missCacheByMethod !== undefined) {
      for (const set of this.missCacheByMethod.values()) {
        set.clear();
      }
    }
  }
}
