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
