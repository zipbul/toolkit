import type { OptionalParamBehavior, RouteParams } from '../types';

export class OptionalParamDefaults {
  private readonly behavior: OptionalParamBehavior;
  private readonly defaults = new Map<number, readonly string[]>();

  constructor(behavior: OptionalParamBehavior = 'set-undefined') {
    this.behavior = behavior;
  }

  record(key: number, names: readonly string[]): void {
    if (this.behavior === 'omit') {
      return;
    }

    this.defaults.set(key, names);
  }

  has(key: number): boolean {
    if (this.behavior === 'omit') return false;

    return this.defaults.has(key);
  }

  /**
   * True when no optional-param defaults are tracked. Used by router codegen
   * to skip the `optDefaults.has(handlerIndex)` runtime probe entirely when
   * the router has no `:name?` routes — i.e. on every dynamic match.
   * `behavior === 'omit'` keeps `defaults` empty via the early return in
   * `record()`, so size is the single source of truth.
   */
  isEmpty(): boolean {
    return this.defaults.size === 0;
  }

  apply(key: number, params: RouteParams): void {
    if (this.behavior === 'omit') {
      return;
    }

    const defaults = this.defaults.get(key);

    if (defaults === undefined) {
      return;
    }

    const len = defaults.length;

    for (let i = 0; i < len; i++) {
      const name = defaults[i];

      if (typeof name === 'string' && name.length > 0 && !(name in params)) {
        params[name] = undefined;
      }
    }
  }
}
