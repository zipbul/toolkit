import type { OptionalParamBehavior } from '../types';

interface OptionalParamDefaultsSnapshot {
  entries: Array<readonly [number, readonly string[]]>;
}

/**
 * Build-time tracker for `:name?`-style optional parameters. The router's
 * `set-undefined` policy is implemented entirely inside the params factory
 * codegen (registration.ts emits `p[name] = undefined` for omitted
 * optionals when `omitBehavior === false`), so this class is purely a
 * snapshot/restore carrier for the seal-failure rollback path. The
 * `record()` calls from route-expand.ts populate the map only for
 * symmetry with that rollback — `apply()` was previously consumed at
 * runtime but the codegen path has supplanted it (verified by removing
 * `apply` / `has` / `isEmpty` and watching 616/616 stay green).
 */
export class OptionalParamDefaults {
  private readonly behavior: OptionalParamBehavior;
  private readonly defaults = new Map<number, readonly string[]>();

  constructor(behavior: OptionalParamBehavior = 'omit') {
    this.behavior = behavior;
  }

  record(key: number, names: readonly string[]): void {
    if (this.behavior === 'omit') {
      return;
    }
    this.defaults.set(key, names);
  }

  /** Sentinel reused across all snapshots taken when the defaults map is
   *  empty — common case for wildcard/static heavy builds where no route
   *  has optional params. Avoids 100k empty-array allocations per build. */
  private static readonly EMPTY_SNAPSHOT: OptionalParamDefaultsSnapshot = { entries: [] };

  snapshot(): OptionalParamDefaultsSnapshot {
    if (this.defaults.size === 0) {
      return OptionalParamDefaults.EMPTY_SNAPSHOT;
    }
    return { entries: [...this.defaults] };
  }

  restore(snapshot: OptionalParamDefaultsSnapshot): void {
    this.defaults.clear();
    for (const [key, names] of snapshot.entries) {
      this.defaults.set(key, names);
    }
  }
}
