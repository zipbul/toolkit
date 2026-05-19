import type { PathNormalizer } from '../codegen';
import type { MatchFn, MatchState } from '../types';

interface MatchLayerDeps {
  normalizePath: PathNormalizer;
  matchState: MatchState;
  activeMethodCodes: ReadonlyArray<readonly [string, number]>;
  trees: Array<MatchFn | null>;
  staticPathMethodMask: Record<string, number>;
}

export class MatchLayer {
  private readonly normalizePath: PathNormalizer;
  private readonly matchState: MatchState;
  private readonly activeMethodCodes: ReadonlyArray<readonly [string, number]>;
  private readonly trees: Array<MatchFn | null>;
  private readonly staticPathMethodMask: Record<string, number>;
  private readonly methodNameByCode: string[];

  constructor(deps: MatchLayerDeps) {
    this.normalizePath = deps.normalizePath;
    this.matchState = deps.matchState;
    this.activeMethodCodes = deps.activeMethodCodes;
    this.trees = deps.trees;
    this.staticPathMethodMask = deps.staticPathMethodMask;
    const names: string[] = [];
    for (const [name, code] of deps.activeMethodCodes) {
      names[code] = name;
    }
    this.methodNameByCode = names;
  }

  allowedMethods(path: string): readonly string[] {
    const sp = this.normalizePath(path);
    const out: string[] = [];

    const staticMask = (this.staticPathMethodMask[sp] ?? 0) | 0;
    let mask = staticMask;
    while (mask !== 0) {
      const lowest = mask & -mask;
      const code = 31 - Math.clz32(lowest);
      const name = this.methodNameByCode[code];
      if (name !== undefined) {
        out.push(name);
      }
      mask ^= lowest;
    }

    const state = this.matchState;
    const active = this.activeMethodCodes;
    for (let i = 0; i < active.length; i++) {
      const entry = active[i]!;
      const methodCode = entry[1];
      if ((staticMask & (1 << methodCode)) !== 0) {
        continue;
      }
      const tr = this.trees[methodCode];
      if (tr === null || tr === undefined) {
        continue;
      }
      if (tr(sp, state)) {
        out.push(entry[0]);
      }
    }

    return out;
  }
}
