import type { OptionalParamBehavior, RouteParams } from '../types';

export class OptionalParamDefaults {
  private readonly behavior: OptionalParamBehavior;
  private readonly defaults = new Map<number, readonly string[]>();
  private readonly defaultValue: string | undefined;

  constructor(behavior: OptionalParamBehavior = 'setUndefined') {
    this.behavior = behavior;
    this.defaultValue = behavior === 'setEmptyString' ? '' : undefined;
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
   */
  isEmpty(): boolean {
    return this.behavior === 'omit' || this.defaults.size === 0;
  }

  apply(key: number, params: RouteParams): void {
    if (this.behavior === 'omit') {
      return;
    }

    const defaults = this.defaults.get(key);

    if (defaults === undefined) {
      return;
    }

    const val = this.defaultValue;
    const len = defaults.length;

    for (let i = 0; i < len; i++) {
      const name = defaults[i];

      if (typeof name === 'string' && name.length > 0 && !(name in params)) {
        params[name] = val;
      }
    }
  }
}
