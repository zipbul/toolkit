import type { MatchFn, MatchState } from '../types';
import type { PathNormalizer } from '../codegen';


/**
 * Dependencies the MatchLayer requires from the build pipeline. Every
 * field is closure-captured by the layer's methods — no shared mutable
 * state with Router beyond what is enumerated here.
 *
 * File-local: only `MatchLayer`'s constructor consumes it; not part of
 * the public surface.
 */
interface MatchLayerDeps {
  normalizePath: PathNormalizer;
  matchState: MatchState;
  activeMethodCodes: ReadonlyArray<readonly [string, number]>;
  trees: Array<MatchFn | null>;
  /** Per-static-path 32-bit mask of registered method codes. */
  staticPathMethodMask: Record<string, number>;
}

/**
 * Cold-path runtime concern: `allowedMethods()` (404 vs 405
 * disambiguation).
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
export class MatchLayer {
  private readonly normalizePath: PathNormalizer;
  private readonly matchState: MatchState;
  private readonly activeMethodCodes: ReadonlyArray<readonly [string, number]>;
  private readonly trees: Array<MatchFn | null>;
  private readonly staticPathMethodMask: Record<string, number>;
  /**
   * Method-code → method-name lookup table. Built once from
   * `activeMethodCodes` so the bitmask iteration in `allowedMethods()`
   * can resolve a bit position to a name in O(1) without scanning.
   */
  private readonly methodNameByCode: string[];

  constructor(deps: MatchLayerDeps) {
    this.normalizePath = deps.normalizePath;
    this.matchState = deps.matchState;
    this.activeMethodCodes = deps.activeMethodCodes;
    this.trees = deps.trees;
    this.staticPathMethodMask = deps.staticPathMethodMask;
    const names: string[] = [];
    for (const [name, code] of deps.activeMethodCodes) names[code] = name;
    this.methodNameByCode = names;
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
  allowedMethods(path: string): readonly string[] {
    const sp = this.normalizePath(path);

    if (sp === null) return [];

    const out: string[] = [];

    // Static fast path — single 32-bit mask lookup; iterate via lowest
    // set bit (`mask & -mask`) so each loop iteration is O(1) regardless
    // of how many methods are registered for the path.
    const staticMask = (this.staticPathMethodMask[sp] ?? 0) | 0;
    let mask = staticMask;
    while (mask !== 0) {
      const lowest = mask & -mask;
      const code = 31 - Math.clz32(lowest);
      const name = this.methodNameByCode[code];
      if (name !== undefined) out.push(name);
      mask ^= lowest;
    }

    // Dynamic walker fallback — only methods that actually have a tree
    // contribute, and only when the static mask did not already include
    // them. Trees are sparse so the loop is at most O(active methods).
    const state = this.matchState;
    const active = this.activeMethodCodes;
    for (let i = 0; i < active.length; i++) {
      const entry = active[i]!;
      const methodCode = entry[1];
      if ((staticMask & (1 << methodCode)) !== 0) continue;
      const tr = this.trees[methodCode];
      if (tr === null || tr === undefined) continue;
      if (tr(sp, state)) {
        out.push(entry[0]);
      }
    }

    return out;
  }
}
