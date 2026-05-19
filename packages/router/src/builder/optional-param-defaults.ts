interface OptionalParamDefaultsSnapshot {
  entries: Array<readonly [number, readonly string[]]>;
}

export class OptionalParamDefaults {
  private readonly omit: boolean;
  private readonly defaults = new Map<number, readonly string[]>();

  constructor(omit: boolean = true) {
    this.omit = omit;
  }

  record(key: number, names: readonly string[]): void {
    if (this.omit) {
      return;
    }
    this.defaults.set(key, names);
  }

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
