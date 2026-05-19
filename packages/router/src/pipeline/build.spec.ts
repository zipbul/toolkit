import { describe, expect, it } from 'bun:test';

import type { RouterOptions } from '../types';
import type { RegistrationSnapshot } from './registration';

import { MethodRegistry } from '../method-registry';
import { MatchSource } from '../types';
import { buildFromRegistration } from './build';

function emptySnapshot<T>(overrides: Partial<RegistrationSnapshot<T>> = {}): RegistrationSnapshot<T> {
  return {
    staticByMethod: [],
    staticPathMethodMask: Object.create(null) as Record<string, number>,
    segmentTrees: [],
    handlers: [],
    terminalSlab: new Int32Array(0),
    paramsFactories: [],
    maxParamsObserved: 0,
    ...overrides,
  };
}

describe('buildFromRegistration — staticOutputsByMethod', () => {
  it('materializes a frozen MatchOutput per static path, with source: "static"', () => {
    const registry = new MethodRegistry();
    const getCode = registry.get('GET')!;
    const bucket: Record<string, string> = Object.create(null);
    bucket['/health'] = 'h';
    const staticByMethod: Array<Record<string, string> | undefined> = [];
    staticByMethod[getCode] = bucket;

    const result = buildFromRegistration(emptySnapshot<string>({ staticByMethod }), {}, registry);

    const outBucket = result.staticOutputsByMethod[getCode]!;
    const out = outBucket['/health']!;
    expect(out.value).toBe('h');
    expect(out.meta.source).toBe(MatchSource.Static);
    expect(Object.isFrozen(out)).toBe(true);
  });

  it('skips methods with no static bucket (sparse output array)', () => {
    const registry = new MethodRegistry();
    const result = buildFromRegistration(emptySnapshot<string>(), {}, registry);
    for (const bucket of result.staticOutputsByMethod) {
      expect(bucket).toBeUndefined();
    }
  });
});

describe('buildFromRegistration — activeMethodCodes filter', () => {
  it('includes only methods with either a tree or a static bucket', () => {
    const registry = new MethodRegistry();
    const getCode = registry.get('GET')!;
    const bucket: Record<string, string> = Object.create(null);
    bucket['/x'] = 'x';
    const staticByMethod: Array<Record<string, string> | undefined> = [];
    staticByMethod[getCode] = bucket;

    const result = buildFromRegistration(emptySnapshot<string>({ staticByMethod }), {}, registry);

    const activeNames = result.activeMethodCodes.map(([n]) => n);
    expect(activeNames).toContain('GET');
    expect(activeNames).not.toContain('POST');
  });

  it('returns an empty active list when no method has trees or buckets', () => {
    const registry = new MethodRegistry();
    const result = buildFromRegistration(emptySnapshot<string>(), {}, registry);
    expect(result.activeMethodCodes).toEqual([]);
  });
});

describe('buildFromRegistration — options wiring', () => {
  it('defaults ignoreTrailingSlash=true (option absent)', () => {
    const registry = new MethodRegistry();
    const result = buildFromRegistration(emptySnapshot<string>(), {}, registry);
    expect(result.ignoreTrailingSlash).toBe(true);
  });

  it('honors ignoreTrailingSlash=false by setting ignoreTrailingSlash=false', () => {
    const registry = new MethodRegistry();
    const opts: RouterOptions = { ignoreTrailingSlash: false };
    const result = buildFromRegistration(emptySnapshot<string>(), opts, registry);
    expect(result.ignoreTrailingSlash).toBe(false);
  });

  it('defaults caseSensitive=true (option absent)', () => {
    const registry = new MethodRegistry();
    const result = buildFromRegistration(emptySnapshot<string>(), {}, registry);
    expect(result.caseSensitive).toBe(true);
  });

  it('honors pathCaseSensitive=false', () => {
    const registry = new MethodRegistry();
    const opts: RouterOptions = { pathCaseSensitive: false };
    const result = buildFromRegistration(emptySnapshot<string>(), opts, registry);
    expect(result.caseSensitive).toBe(false);
  });
});

describe('buildFromRegistration — normalizePath', () => {
  it('trims trailing slash when ignoreTrailingSlash is on', () => {
    const registry = new MethodRegistry();
    const result = buildFromRegistration(emptySnapshot<string>(), { ignoreTrailingSlash: true }, registry);
    expect(result.normalizePath('/x/')).toBe('/x');
  });

  it('preserves trailing slash when ignoreTrailingSlash=false', () => {
    const registry = new MethodRegistry();
    const result = buildFromRegistration(emptySnapshot<string>(), { ignoreTrailingSlash: false }, registry);
    expect(result.normalizePath('/x/')).toBe('/x/');
  });

  it('lowercases when pathCaseSensitive=false', () => {
    const registry = new MethodRegistry();
    const result = buildFromRegistration(emptySnapshot<string>(), { pathCaseSensitive: false }, registry);
    expect(result.normalizePath('/HELLO')).toBe('/hello');
  });

  it('preserves the root slash even with trimSlash on', () => {
    const registry = new MethodRegistry();
    const result = buildFromRegistration(emptySnapshot<string>(), { ignoreTrailingSlash: true }, registry);
    expect(result.normalizePath('/')).toBe('/');
  });
});

describe('buildFromRegistration — passthrough fields', () => {
  it('forwards staticPathMethodMask from the snapshot unchanged', () => {
    const registry = new MethodRegistry();
    const mask: Record<string, number> = Object.create(null);
    mask['/x'] = 0b101;
    const result = buildFromRegistration(emptySnapshot<string>({ staticPathMethodMask: mask }), {}, registry);
    expect(result.staticPathMethodMask).toBe(mask);
  });

  it('forwards terminalSlab from the snapshot unchanged', () => {
    const registry = new MethodRegistry();
    const slab = new Int32Array(6);
    slab[0] = 7;
    const result = buildFromRegistration(emptySnapshot<string>({ terminalSlab: slab }), {}, registry);
    expect(result.terminalSlab).toBe(slab);
  });

  it('forwards paramsFactories from the snapshot unchanged', () => {
    const registry = new MethodRegistry();
    const factories = [() => Object.create(null) as Record<string, string>];
    const result = buildFromRegistration(emptySnapshot<string>({ paramsFactories: factories }), {}, registry);
    expect(result.paramsFactories).toBe(factories);
  });

  it('pre-allocates matchState sized to maxParamsObserved', () => {
    const registry = new MethodRegistry();
    const result = buildFromRegistration(emptySnapshot<string>({ maxParamsObserved: 5 }), {}, registry);
    expect(result.matchState).toBeDefined();
    expect(result.matchState.paramOffsets).toBeInstanceOf(Int32Array);
    expect(result.matchState.paramOffsets.length).toBeGreaterThanOrEqual(10);
  });
});
