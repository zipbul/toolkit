import { describe, expect, it } from 'bun:test';

import { getRouterInternals } from '../../internal';
import { RouterError } from '../../src/error';
import { Router } from '../../src/router';
import { MatchSource } from '../../src/types';

describe('API guarantees', () => {
  it('returns null when match() is called before build()', () => {
    const r = new Router<string>();
    r.add('GET', '/x', 'x');

    expect(r.match('GET', '/x')).toBeNull();
  });

  it('preserves handler value identity (===)', () => {
    const handler = { run: () => 1 };
    const r = new Router<typeof handler>();
    r.add('GET', '/x', handler);
    r.build();

    expect(r.match('GET', '/x')!.value).toBe(handler);
  });

  it('returns a fresh MatchOutput on each dynamic call (no aliasing)', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:id', 'u');
    r.build();

    const a = r.match('GET', '/users/1')!;
    const b = r.match('GET', '/users/2')!;

    expect(a).not.toBe(b);
    expect(a.params).not.toBe(b.params);
    expect(a.params).toEqual({ id: '1' });
    expect(b.params).toEqual({ id: '2' });
  });

  it('static-route MatchOutput is shared and frozen across identical hits', () => {
    const r = new Router<string>();
    r.add('GET', '/health', 'ok');
    r.build();

    const a = r.match('GET', '/health')!;
    const b = r.match('GET', '/health')!;

    expect(a.value).toBe(b.value);
    expect(a).toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
    expect(a.meta.source).toBe(MatchSource.Static);
    expect(b.meta.source).toBe(MatchSource.Static);
  });

  it('static MatchOutput.params is frozen empty (no key writes possible)', () => {
    const r = new Router<string>();
    r.add('GET', '/health', 'ok');
    r.build();

    const m = r.match('GET', '/health')!;

    expect(Object.keys(m.params)).toHaveLength(0);
    expect(Object.isFrozen(m.params)).toBe(true);
  });

  it('params object is prototype-less (no inherited keys)', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:id', 'u');
    r.build();

    const m = r.match('GET', '/users/42')!;

    expect((m.params as Record<string, unknown>).toString).toBeUndefined();
    expect((m.params as Record<string, unknown>).hasOwnProperty).toBeUndefined();
    expect('toString' in m.params).toBe(false);
  });

  it('successive matches do not bleed params between routes', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:id', 'u');
    r.add('GET', '/posts/:slug', 'p');
    r.build();

    const a = r.match('GET', '/users/42')!;

    const b = r.match('GET', '/posts/hello')!;

    expect(b.params).toEqual({ slug: 'hello' });
    expect((b.params as Record<string, unknown>).id).toBeUndefined();
    expect(a.params).toEqual({ id: '42' });
  });

  it('reports meta.source = "dynamic" for tree matches and "static" for staticMap matches', () => {
    const r = new Router<string>();
    r.add('GET', '/health', 's');
    r.add('GET', '/users/:id', 'd');
    r.build();

    expect(r.match('GET', '/health')!.meta.source).toBe(MatchSource.Static);
    expect(r.match('GET', '/health')!.meta.source).toBe(MatchSource.Static);
    expect(r.match('GET', '/users/1')!.meta.source).toBe(MatchSource.Dynamic);
  });

  it('reports meta.source = "cache" for cached hits', () => {
    const r = new Router<string>({});
    r.add('GET', '/users/:id', 'd');
    r.build();

    r.match('GET', '/users/1');
    const m = r.match('GET', '/users/1')!;

    expect(m.meta.source).toBe(MatchSource.Cache);
  });

  it('cache returns frozen params; caller mutation throws and cache is preserved', () => {
    const r = new Router<string>({});
    r.add('GET', '/users/:id', 'd');
    r.build();

    const a = r.match('GET', '/users/1')!;
    expect(Object.isFrozen(a.params)).toBe(true);
    expect(() => {
      'use strict';
      (a.params as Record<string, string>).id = 'mutated';
    }).toThrow(TypeError);

    const b = r.match('GET', '/users/1')!;
    expect(b.params.id).toBe('1');
  });
});

describe('optional params', () => {
  it('omit: missing optional disappears from params object', () => {
    const r = new Router<string>({ omitMissingOptional: true });
    r.add('GET', '/users/:id?', 'u');
    r.build();

    const withParam = r.match('GET', '/users/42')!;

    expect(withParam.params).toEqual({ id: '42' });

    const withoutParam = r.match('GET', '/users')!;

    expect('id' in withoutParam.params).toBe(false);
  });

  it('set-undefined: missing optional becomes undefined', () => {
    const r = new Router<string>({ omitMissingOptional: false });
    r.add('GET', '/users/:id?', 'u');
    r.build();

    const m = r.match('GET', '/users')!;

    expect('id' in m.params).toBe(true);
    expect(m.params.id).toBeUndefined();
  });
});

describe('method specs', () => {
  it('method "*" registers across all standard methods', () => {
    const r = new Router<string>();
    r.add('*', '/anything', 'all');
    r.build();

    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const) {
      expect(r.match(method, '/anything')!.value).toBe('all');
    }
  });

  it('method array registers across the listed methods only', () => {
    const r = new Router<string>();
    r.add(['GET', 'POST'], '/x', 'some');
    r.build();

    expect(r.match('GET', '/x')!.value).toBe('some');
    expect(r.match('POST', '/x')!.value).toBe('some');
    expect(r.match('DELETE', '/x')).toBeNull();
  });

  it('addAll registers all entries atomically when valid', () => {
    const r = new Router<string>();
    r.addAll([
      ['GET', '/a', 'a'],
      ['POST', '/b', 'b'],
      ['DELETE', '/c', 'c'],
    ]);
    r.build();

    expect(r.match('GET', '/a')!.value).toBe('a');
    expect(r.match('POST', '/b')!.value).toBe('b');
    expect(r.match('DELETE', '/c')!.value).toBe('c');
  });

  it('addAll defers duplicate validation to build()', () => {
    const r = new Router<string>();

    r.addAll([
      ['GET', '/ok', '1'],
      ['GET', '/ok', '2'],
    ]);

    expect(() => r.build()).toThrow(RouterError);
  });
});

describe('sealed state', () => {
  it('throws router-sealed when add() is called after build()', () => {
    const r = new Router<string>();
    r.add('GET', '/x', 'x');
    r.build();

    expect(() => r.add('GET', '/y', 'y')).toThrow(RouterError);
  });

  it('throws router-sealed when addAll() is called after build()', () => {
    const r = new Router<string>();
    r.add('GET', '/x', 'x');
    r.build();

    expect(() => r.addAll([['GET', '/y', 'y']])).toThrow(RouterError);
  });

  it('build() is idempotent — calling twice is safe', () => {
    const r = new Router<string>();
    r.add('GET', '/x', 'x');
    r.build();
    r.build();

    expect(r.match('GET', '/x')!.value).toBe('x');
  });

  it('freezes build-only tables so post-build mutation throws (F22)', () => {
    const r = new Router<string>();
    r.add('GET', '/x', 'x');
    r.build();

    const internal = getRouterInternals(r);
    const snapshot = (
      internal.registration as unknown as {
        snapshot: { segmentTrees: unknown[]; handlers: unknown[] };
      }
    ).snapshot;
    const matchLayer = internal.matchLayer as unknown as {
      activeMethodCodes: ReadonlyArray<readonly [string, number]>;
      trees: unknown[];
    };

    expect(Object.isFrozen(snapshot.segmentTrees)).toBe(true);
    expect(Object.isFrozen(matchLayer.activeMethodCodes)).toBe(true);

    expect(Object.isFrozen(snapshot.handlers)).toBe(false);
    expect(Object.isFrozen(matchLayer.trees)).toBe(false);

    expect(() => (snapshot.segmentTrees as unknown[]).push(null)).toThrow(TypeError);
  });
});

describe('optional-param expansion with stable paramName', () => {
  function makeOptionalRouter() {
    const r = new Router<string>();
    r.add('GET', '/users/:id?', 'opt');
    r.build();

    return r;
  }

  it('builds a single segment tree', () => {
    const r = makeOptionalRouter();
    const trees = (getRouterInternals(r) as unknown as { matchLayer: { trees: Array<unknown> } }).matchLayer.trees;
    const built = trees.filter(t => t != null);

    expect(built.length).toBe(1);
  });

  it('matches each expansion variant correctly', () => {
    const r = makeOptionalRouter();

    expect(r.match('GET', '/users')!.value).toBe('opt');
    expect(r.match('GET', '/users/x')!.params).toEqual({ id: 'x' });
  });

  it('returns null for paths with too many segments', () => {
    const r = makeOptionalRouter();

    expect(r.match('GET', '/users/x/y')).toBeNull();
  });
});

describe('optional expansion combined with deep param routes', () => {
  function makeHugeOptionalRouter() {
    const r = new Router<string>();

    r.add('GET', '/users/:id?', 'opt');

    for (let i = 0; i < 200; i++) {
      r.add('GET', `/zone${i}/category${i}/:name${i}/sub`, `r${i}`);
    }

    r.build();

    return r;
  }

  it('matches optional-expansion variants correctly', () => {
    const r = makeHugeOptionalRouter();

    expect(r.match('GET', '/users')!.value).toBe('opt');
    expect(r.match('GET', '/users/x')!.value).toBe('opt');
  });

  it('matches deep param routes correctly', () => {
    const r = makeHugeOptionalRouter();
    const m = r.match('GET', '/zone5/category5/foo/sub')!;

    expect(m.value).toBe('r5');
    expect(m.params).toEqual({ name5: 'foo' });
  });

  it('returns null for unmatched URLs', () => {
    const r = makeHugeOptionalRouter();

    expect(r.match('GET', '/unrelated/path')).toBeNull();
    expect(r.match('GET', '/zone5/category5/foo/wrong')).toBeNull();
  });

  it('does not throw on empty/malformed URLs', () => {
    const r = makeHugeOptionalRouter();

    expect(() => r.match('GET', '')).not.toThrow();
    expect(() => r.match('GET', '/')).not.toThrow();
    expect(() => r.match('GET', '?')).not.toThrow();
  });
});

describe('edge case URLs', () => {
  it('passes raw unicode in param values through to the matcher', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:name', 'u');
    r.build();

    const m = r.match('GET', '/users/한글');

    expect(m).not.toBeNull();
    expect(m!.params.name).toBe('한글');
  });

  it('handles percent-encoded multi-byte sequences', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:name', 'u');
    r.build();

    const m = r.match('GET', '/users/%ED%95%9C%EA%B8%80');

    expect(m).not.toBeNull();
    expect(m!.params.name).toBe('한글');
  });

  it('rejects empty path', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:id', 'u');
    r.build();

    expect(r.match('GET', '')).toBeNull();
  });

  it('rejects path with only "?"', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:id', 'u');
    r.build();

    expect(r.match('GET', '?')).toBeNull();
  });

  it('does not match path containing query string (framework strips ?)', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:id', 'u');
    r.build();

    const longQs = 'q=' + 'x'.repeat(1000);
    expect(() => r.match('GET', `/users/42?${longQs}`)).not.toThrow();
  });

  it('matches path containing colon character in param value', () => {
    const r = new Router<string>();
    r.add('GET', '/at/:where', 'at');
    r.build();

    const m = r.match('GET', '/at/host:port');

    expect(m).not.toBeNull();
    expect(m!.params.where).toBe('host:port');
  });

  it('matches very deep param chain', () => {
    const r = new Router<string>();
    r.add('GET', '/a/:p1/b/:p2/c/:p3/d/:p4/e/:p5/f/:p6', 'deep');
    r.build();

    const m = r.match('GET', '/a/1/b/2/c/3/d/4/e/5/f/6');

    expect(m).not.toBeNull();
    expect(m!.params).toEqual({ p1: '1', p2: '2', p3: '3', p4: '4', p5: '5', p6: '6' });
  });
});

describe('cache stress', () => {
  it('miss cache evicts oldest when full (FIFO)', () => {
    const r = new Router<string>({ cacheSize: 3 });
    r.add('GET', '/users/:id', 'u');
    r.build();

    r.match('GET', '/miss1');
    r.match('GET', '/miss2');
    r.match('GET', '/miss3');
    r.match('GET', '/miss4');

    expect(r.match('GET', '/miss1')).toBeNull();
    expect(r.match('GET', '/miss4')).toBeNull();
  });

  it('hit cache returns the same value across repeated identical paths', () => {
    const r = new Router<string>({});
    r.add('GET', '/users/:id', 'u');
    r.build();

    const a = r.match('GET', '/users/42')!;
    const b = r.match('GET', '/users/42')!;

    expect(a.value).toBe(b.value);
    expect(a.params).toEqual(b.params);
  });
});

describe('method registry', () => {
  const CUSTOM_LIMIT = 25;

  it('accepts up to 25 distinct custom methods (32 total including defaults)', () => {
    const r = new Router<number>();

    for (let i = 0; i < CUSTOM_LIMIT; i++) {
      const m = `M${i.toString().padStart(2, '0')}` as unknown as 'GET';
      r.add(m, `/route${i}`, i);
    }

    expect(() => r.build()).not.toThrow();
  });

  it('throws method-limit when registering the 33rd total method', () => {
    const r = new Router<number>();

    for (let i = 0; i < CUSTOM_LIMIT; i++) {
      const m = `M${i.toString().padStart(2, '0')}` as unknown as 'GET';
      r.add(m, `/route${i}`, i);
    }

    r.add('OVERFLOW' as unknown as 'GET', '/r33', 33);
    expect(() => r.build()).toThrow(RouterError);
  });
});
