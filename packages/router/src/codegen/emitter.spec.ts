/**
 * Unit spec for `emitter.ts`. Drives `compileMatchFn` directly with
 * hand-built `MatchConfig` fixtures so each emitted branch is exercised
 * in isolation — no Router, no toString() string-matching.
 */
import { describe, expect, it } from 'bun:test';

import { RouterCache } from '../cache';
import { EMPTY_PARAMS, STATIC_META } from '../internal';
import { createMatchState } from '../matcher/match-state';
import type { MatchFn, MatchOutput, RouteParams } from '../types';
import { compileMatchFn, type MatchCacheEntry, type MatchConfig } from './emitter';

type Cfg<T> = MatchConfig<T>;

function freezeOutput<T>(value: T): MatchOutput<T> {
  return Object.freeze({ value, params: EMPTY_PARAMS, meta: STATIC_META }) as MatchOutput<T>;
}

function staticBucket<T>(entries: Record<string, T>): Record<string, MatchOutput<T>> {
  const bucket: Record<string, MatchOutput<T>> = Object.create(null);
  for (const [path, value] of Object.entries(entries)) {
    bucket[path] = freezeOutput(value);
  }
  return bucket;
}

function baseConfig<T>(overrides: Partial<Cfg<T>> = {}): Cfg<T> {
  const merged = {
    trimSlash: false,
    lowerCase: false,
    hasAnyTree: false,
    hasAnyStatic: false,
    staticOutputsByMethod: [],
    methodCodes: Object.create(null) as Record<string, number>,
    activeMethodMask: new Int32Array(32),
    trees: [],
    matchState: createMatchState(4),
    handlers: [],
    hitCacheByMethod: [],
    activeMethodCodes: [],
    terminalSlab: new Int32Array(0),
    paramsFactories: [],
    ...overrides,
  } as Cfg<T>;
  // Auto-fill activeMethodMask from activeMethodCodes when caller did not
  // supply one — keeps existing test fixtures concise.
  if (overrides.activeMethodMask === undefined) {
    const mask = new Int32Array(32);
    for (let i = 0; i < merged.activeMethodCodes.length; i++) {
      mask[merged.activeMethodCodes[i]![1]] = 1;
    }
    (merged as { activeMethodMask: Int32Array }).activeMethodMask = mask;
  }
  return merged;
}

describe('compileMatchFn — static-only, single active method', () => {
  it('returns the frozen MatchOutput on a direct static hit', () => {
    const code = 0;
    const methodCodes: Record<string, number> = Object.create(null);
    methodCodes['GET'] = code;
    const bucket = staticBucket({ '/health': 'h' });
    const cfg = baseConfig<string>({
      hasAnyStatic: true,
      staticOutputsByMethod: [bucket],
      methodCodes,
      activeMethodCodes: [['GET', code] as const],
    });
    const match = compileMatchFn(cfg);
    const out = match('GET', '/health');
    expect(out).not.toBeNull();
    expect(out!.value).toBe('h');
    expect(out!.meta.source).toBe('static');
  });

  it('returns null on the literal method-compare branch for a different method', () => {
    const code = 0;
    const methodCodes: Record<string, number> = Object.create(null);
    methodCodes['GET'] = code;
    const cfg = baseConfig<string>({
      hasAnyStatic: true,
      staticOutputsByMethod: [staticBucket({ '/x': 'x' })],
      methodCodes,
      activeMethodCodes: [['GET', code] as const],
    });
    expect(compileMatchFn(cfg)('POST', '/x')).toBeNull();
  });

  it('falls back to a normalized-path probe on initial miss when trimSlash is on', () => {
    const code = 0;
    const methodCodes: Record<string, number> = Object.create(null);
    methodCodes['GET'] = code;
    const cfg = baseConfig<string>({
      trimSlash: true,
      hasAnyStatic: true,
      staticOutputsByMethod: [staticBucket({ '/x': 'x' })],
      methodCodes,
      activeMethodCodes: [['GET', code] as const],
    });
    const match = compileMatchFn(cfg);
    expect(match('GET', '/x/')!.value).toBe('x');
    expect(match('GET', '/x')!.value).toBe('x');
  });
});

describe('compileMatchFn — static-only, multi-method', () => {
  it('dispatches to the right bucket per method via methodCodes lookup', () => {
    const methodCodes: Record<string, number> = Object.create(null);
    methodCodes['GET'] = 0;
    methodCodes['POST'] = 1;
    const cfg = baseConfig<string>({
      hasAnyStatic: true,
      staticOutputsByMethod: [staticBucket({ '/x': 'g' }), staticBucket({ '/x': 'p' })],
      methodCodes,
      activeMethodCodes: [['GET', 0] as const, ['POST', 1] as const],
    });
    const match = compileMatchFn(cfg);
    expect(match('GET', '/x')!.value).toBe('g');
    expect(match('POST', '/x')!.value).toBe('p');
  });

  it('returns null for a method absent from methodCodes', () => {
    const methodCodes: Record<string, number> = Object.create(null);
    methodCodes['GET'] = 0;
    methodCodes['POST'] = 1;
    const cfg = baseConfig<string>({
      hasAnyStatic: true,
      staticOutputsByMethod: [staticBucket({ '/x': 'g' }), staticBucket({ '/x': 'p' })],
      methodCodes,
      activeMethodCodes: [['GET', 0] as const, ['POST', 1] as const],
    });
    expect(compileMatchFn(cfg)('DELETE', '/x')).toBeNull();
  });
});

describe('compileMatchFn — mixed (dynamic walker + cache + slab unpack)', () => {
  function dynamicCfg(opts: { trimSlash?: boolean; lowerCase?: boolean } = {}): Cfg<string> {
    const code = 0;
    const methodCodes: Record<string, number> = Object.create(null);
    methodCodes['GET'] = code;
    const matchState = createMatchState(4);

    // The walker is a hand-written MatchFn that always succeeds for `/x/<id>`
    // shapes by writing one [start, end] pair into paramOffsets.
    const walker: MatchFn = (url, state) => {
      const prefix = '/x/';
      if (!url.startsWith(prefix)) return false;
      state.handlerIndex = 0;
      state.paramOffsets[0] = prefix.length;
      state.paramOffsets[1] = url.length;
      state.paramCount = 1;
      return true;
    };

    // Terminal #0 → handler index 0, not a wildcard, bitmask 0b1 (param `id` present).
    const slab = new Int32Array(3);
    slab[0] = 0;
    slab[1] = 0;
    slab[2] = 0b1;

    const factory = (_mask: number, u: string, v: Int32Array): RouteParams => {
      const p: Record<string, string> = Object.create(null);
      p['id'] = u.substring(v[0]!, v[1]!);
      return p;
    };

    const activeMethodMask = new Int32Array(32);
    activeMethodMask[code] = 1;
    return {
      trimSlash: opts.trimSlash ?? false,
      lowerCase: opts.lowerCase ?? false,
      hasAnyTree: true,
      hasAnyStatic: false,
      staticOutputsByMethod: [],
      methodCodes,
      activeMethodMask,
      trees: [walker],
      matchState,
      handlers: ['user'],
      hitCacheByMethod: [new RouterCache<MatchCacheEntry<string>>(8)],
      activeMethodCodes: [['GET', code] as const],
      terminalSlab: slab,
      paramsFactories: [factory],
    };
  }

  it('returns a dynamic result with decoded params on first call', () => {
    const match = compileMatchFn(dynamicCfg());
    const out = match('GET', '/x/42');
    expect(out).not.toBeNull();
    expect(out!.value).toBe('user');
    expect(out!.params.id).toBe('42');
    expect(out!.meta.source).toBe('dynamic');
  });

  it('returns a cache hit on the second call with the same path', () => {
    const match = compileMatchFn(dynamicCfg());
    expect(match('GET', '/x/42')!.meta.source).toBe('dynamic');
    expect(match('GET', '/x/42')!.meta.source).toBe('cache');
  });

  it('applies trim-slash normalization before the walker dispatch', () => {
    const match = compileMatchFn(dynamicCfg({ trimSlash: true }));
    const out = match('GET', '/x/42/');
    expect(out).not.toBeNull();
    expect(out!.params.id).toBe('42');
  });

  it('applies lowerCase normalization before the walker dispatch', () => {
    const match = compileMatchFn(dynamicCfg({ lowerCase: true }));
    const out = match('GET', '/X/AB');
    expect(out).not.toBeNull();
    expect(out!.params.id).toBe('ab');
  });

  it('returns null when the walker rejects', () => {
    const match = compileMatchFn(dynamicCfg());
    expect(match('GET', '/other/path')).toBeNull();
  });
});

describe('compileMatchFn — trailing-slash recheck on strict (trimSlash off) mode', () => {
  it('rejects a trailing-slash dynamic match when trimSlash is off and terminal is non-wildcard', () => {
    const code = 0;
    const methodCodes: Record<string, number> = Object.create(null);
    methodCodes['GET'] = code;
    const state = createMatchState(4);
    const walker: MatchFn = (url, s) => {
      s.handlerIndex = 0;
      s.paramOffsets[0] = 3;
      s.paramOffsets[1] = url.length;
      s.paramCount = 1;
      return true;
    };
    const slab = new Int32Array(3);
    slab[0] = 0; slab[1] = 0; slab[2] = 0b1;

    const activeMethodMask = new Int32Array(32);
    activeMethodMask[code] = 1;
    const cfg: Cfg<string> = {
      trimSlash: false,
      lowerCase: false,
      hasAnyTree: true,
      hasAnyStatic: false,
      staticOutputsByMethod: [],
      methodCodes,
      activeMethodMask,
      trees: [walker],
      matchState: state,
      handlers: ['h'],
      hitCacheByMethod: [new RouterCache<MatchCacheEntry<string>>(8)],
      activeMethodCodes: [['GET', code] as const],
      terminalSlab: slab,
      paramsFactories: [(_m, u, v) => {
        const p: Record<string, string> = Object.create(null);
        p['id'] = u.substring(v[0]!, v[1]!);
        return p;
      }],
    };

    const match = compileMatchFn(cfg);
    expect(match('GET', '/x/42/')).toBeNull();
    expect(match('GET', '/x/42')!.value).toBe('h');
  });
});

describe('compileMatchFn — name + caching invariants', () => {
  it('the compiled function is named `match`', () => {
    const code = 0;
    const methodCodes: Record<string, number> = Object.create(null);
    methodCodes['GET'] = code;
    const cfg = baseConfig<string>({
      hasAnyStatic: true,
      staticOutputsByMethod: [staticBucket({ '/x': 'x' })],
      methodCodes,
      activeMethodCodes: [['GET', code] as const],
    });
    expect(compileMatchFn(cfg).name).toBe('match');
  });
});
