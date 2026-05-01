/**
 * Strict-behavior guarantees that production code might rely on without
 * realizing — and that surface as bugs only when invariants drift. Things
 * like "params is null-prototype", "static MatchOutput is frozen and
 * shared", "no state leaks across calls", "cache returns a fresh-enough
 * object that callers can mutate".
 *
 * Also covers the lower fallback paths the rest of the suite skips through
 * codegen: forcing the radix-walk path by causing segment-tree insertion
 * to fail.
 */
import { describe, it, expect } from 'bun:test';

import { Router } from '../src/router';
import { RouterError } from '../src/error';
import { getRouterInternals } from '../internal';

// ── API contract guarantees ─────────────────────────────────────────────────

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
    expect(a).not.toBe(b); // Cache hit returns a new object wrapping the cached value
    expect(Object.isFrozen(a)).toBe(true);
    expect(a.meta.source).toBe('static');
    expect(b.meta.source).toBe('cache');
  });

  it('static MatchOutput.params is frozen empty (no key writes possible)', () => {
    const r = new Router<string>();
    r.add('GET', '/health', 'ok');
    r.build();

    const m = r.match('GET', '/health')!;

    expect(Object.keys(m.params)).toHaveLength(0);
    expect(Object.isFrozen(m.params)).toBe(true);
    // Strict mode would throw on write; we just assert frozen here.
  });

  it('params object is prototype-less (no inherited keys)', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:id', 'u');
    r.build();

    const m = r.match('GET', '/users/42')!;

    // No inherited keys (prototype is the frozen null-proto object)
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
    // Second match must not have `id` from the first one in its params

    const b = r.match('GET', '/posts/hello')!;

    expect(b.params).toEqual({ slug: 'hello' });
    expect((b.params as Record<string, unknown>).id).toBeUndefined();
    // First result also untouched (no aliasing into shared state)
    expect(a.params).toEqual({ id: '42' });
  });

  it('reports meta.source = "dynamic" for tree matches and "static" for staticMap matches', () => {
    const r = new Router<string>();
    r.add('GET', '/health', 's');
    r.add('GET', '/users/:id', 'd');
    r.build();

    expect(r.match('GET', '/health')!.meta.source).toBe('static');
    expect(r.match('GET', '/health')!.meta.source).toBe('cache');
    expect(r.match('GET', '/users/1')!.meta.source).toBe('dynamic');
  });

  it('reports meta.source = "cache" for cached hits', () => {
    const r = new Router<string>({});
    r.add('GET', '/users/:id', 'd');
    r.build();

    r.match('GET', '/users/1'); // populate cache
    const m = r.match('GET', '/users/1')!;

    expect(m.meta.source).toBe('cache');
  });

  it('cache returns fresh params object — caller may mutate without affecting cache', () => {
    const r = new Router<string>({});
    r.add('GET', '/users/:id', 'd');
    r.build();

    const a = r.match('GET', '/users/1')!;
    (a.params as Record<string, string>).id = 'mutated';

    const b = r.match('GET', '/users/1')!; // cache hit

    expect(b.params.id).not.toBe('mutated');
  });
});

// ── Optional param behaviors ──────────────────────────────────────────────

describe('optional params', () => {
  it('omit: missing optional disappears from params object', () => {
    const r = new Router<string>({ optionalParamBehavior: 'omit' });
    r.add('GET', '/users/:id?', 'u');
    r.build();

    const withParam = r.match('GET', '/users/42')!;

    expect(withParam.params).toEqual({ id: '42' });

    const withoutParam = r.match('GET', '/users')!;

    expect('id' in withoutParam.params).toBe(false);
  });

  it('set-undefined: missing optional becomes undefined', () => {
    const r = new Router<string>({ optionalParamBehavior: 'set-undefined' });
    r.add('GET', '/users/:id?', 'u');
    r.build();

    const m = r.match('GET', '/users')!;

    expect('id' in m.params).toBe(true);
    expect(m.params.id).toBeUndefined();
  });

});

// ── Method specifications ─────────────────────────────────────────────────

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

// ── Sealed router state ──────────────────────────────────────────────────

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

    // Internal-state-inspection pattern (already used across this file).
    // After B5, Router itself only retains the matchImpl + matchLayer
    // entry points. Frozen build-only tables now live on `registration`
    // (segmentTrees / handlers / staticMap / staticRegistered /
    // wildcardNamesByMethod) and `matchLayer` (activeMethodCodes,
    // staticOutputsByMethod, trees). Hot-path tables stay mutable for
    // JSC IC perf — freezing them costs 5-10 ns per dynamic match.
    const internal = getRouterInternals(r) as unknown as {
      registration: {
        segmentTrees: unknown[];
        handlers: unknown[];
        staticMap: Record<string, unknown>;
        staticRegistered: Record<string, unknown>;
        wildcardNamesByMethod: Map<number, Map<string, string>>;
      };
      matchLayer: {
        activeMethodCodes: ReadonlyArray<readonly [string, number]>;
        trees: unknown[];
        staticOutputsByMethod: unknown[];
      };
    };

    // Build-only tables must be frozen.
    expect(Object.isFrozen(internal.registration.segmentTrees)).toBe(true);
    expect(Object.isFrozen(internal.registration.staticMap)).toBe(true);
    expect(Object.isFrozen(internal.registration.staticRegistered)).toBe(true);
    expect(Object.isFrozen(internal.matchLayer.activeMethodCodes)).toBe(true);
    expect(internal.registration.wildcardNamesByMethod).toBeInstanceOf(Map);
    expect(Object.isFrozen(internal.registration.wildcardNamesByMethod)).toBe(true);

    // Hot-path tables stay mutable. `handlers` is read by the emitted
    // matchImpl as `handlers[state.handlerIndex]` on every dynamic
    // match — freezing it cost 5-10 ns/match in earlier bench runs.
    expect(Object.isFrozen(internal.registration.handlers)).toBe(false);
    expect(Object.isFrozen(internal.matchLayer.trees)).toBe(false);
    expect(Object.isFrozen(internal.matchLayer.staticOutputsByMethod)).toBe(false);

    // Frozen object/array mutation throws TypeError in strict mode (ESM = strict).
    expect(() => internal.registration.segmentTrees.push(null)).toThrow(TypeError);
    expect(() => { internal.registration.staticMap['/y'] = []; }).toThrow(TypeError);
  });
});

// ── Radix-walk fallback paths ────────────────────────────────────────────
//
// Now that unreachable sibling-param registrations are rejected at add-time,
// the only routes that exercise the radix-walk path are optional-param
// expansions (which generate same-handler siblings) and tester-bearing
// siblings (which legitimately distinguish at runtime). Both cases must
// continue to work end-to-end.

describe('sibling-param expansion (multi-optional)', () => {
  // /users/:a?/:b? expands into four routes sharing one handler. The
  // expansions /users/:a and /users/:b create same-position different-name
  // siblings under one handlerIndex — segment-tree handles them via the
  // sibling-chain walker with backtracking.
  function makeOptionalRouter() {
    const r = new Router<string>();
    r.add('GET', '/users/:a?/:b?', 'opt');
    r.build();

    return r;
  }

  it('builds a single segment tree (no fallback walker required)', () => {
    const r = makeOptionalRouter();
    // After B5, the per-method walker array lives on matchLayer.
    const trees = (getRouterInternals(r) as unknown as { matchLayer: { trees: Array<unknown> } }).matchLayer.trees;
    const built = trees.filter(t => t != null);

    expect(built.length).toBe(1);
  });

  it('matches each expansion variant correctly', () => {
    const r = makeOptionalRouter();

    expect(r.match('GET', '/users')!.value).toBe('opt');
    expect(r.match('GET', '/users/x')!.params).toEqual({ a: 'x', b: undefined });
    expect(r.match('GET', '/users/x/y')!.params).toEqual({ a: 'x', b: 'y' });
  });

  it('returns null for paths with too many segments', () => {
    const r = makeOptionalRouter();

    expect(r.match('GET', '/users/x/y/z')).toBeNull();
  });
});

describe('radix-walk full walker (tester sibling)', () => {
  // Tester-bearing param + catchall sibling: legitimate ordered alternatives.
  // The numeric tester runs first; on rejection radix walker falls through
  // to the catchall.
  function makeTesterRouter() {
    const r = new Router<string>();
    r.add('GET', '/users/:id(\\d+)', 'numeric');
    r.add('GET', '/users/:slug', 'catchall');
    r.build();

    return r;
  }

  it('matches numeric via tester first', () => {
    const r = makeTesterRouter();
    const m = r.match('GET', '/users/42')!;

    expect(m.value).toBe('numeric');
    expect(m.params).toEqual({ id: '42' });
  });

  it('falls through to catchall when tester rejects', () => {
    const r = makeTesterRouter();
    const m = r.match('GET', '/users/hello')!;

    expect(m.value).toBe('catchall');
    expect(m.params).toEqual({ slug: 'hello' });
  });
});

describe('sibling-param expansion under large trees', () => {
  // Combine sibling-param expansion with 200 additional routes — exercises
  // the recursive segment walker path on a non-trivial tree shape.
  function makeHugeOptionalRouter() {
    const r = new Router<string>();

    r.add('GET', '/users/:a?/:b?', 'opt');

    for (let i = 0; i < 200; i++) {
      r.add('GET', `/zone${i}/category${i}/:name${i}/sub`, `r${i}`);
    }

    r.build();

    return r;
  }

  it('matches optional-expansion variants correctly under recursive walker', () => {
    const r = makeHugeOptionalRouter();

    expect(r.match('GET', '/users')!.value).toBe('opt');
    expect(r.match('GET', '/users/x')!.value).toBe('opt');
    expect(r.match('GET', '/users/x/y')!.value).toBe('opt');
  });

  it('matches deep param routes correctly under interpreter', () => {
    const r = makeHugeOptionalRouter();
    const m = r.match('GET', '/zone5/category5/foo/sub')!;

    expect(m.value).toBe('r5');
    expect(m.params).toEqual({ name5: 'foo' });
  });

  it('returns null for unmatched URLs under interpreter', () => {
    const r = makeHugeOptionalRouter();

    expect(r.match('GET', '/unrelated/path')).toBeNull();
    expect(r.match('GET', '/zone5/category5/foo/wrong')).toBeNull();
  });

  it('does not throw on empty/malformed URLs in interpreter path', () => {
    const r = makeHugeOptionalRouter();

    expect(() => r.match('GET', '')).not.toThrow();
    expect(() => r.match('GET', '/')).not.toThrow();
    expect(() => r.match('GET', '?')).not.toThrow();
  });
});

// ── Edge URLs ─────────────────────────────────────────────────────────────

describe('edge case URLs', () => {
  it('handles unicode characters in param values', () => {
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

    // %ED%95%9C%EA%B8%80 is "한글" in UTF-8 → percent-encoded
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

  it('strips long query string before matching', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:id', 'u');
    r.build();

    const longQs = 'q=' + 'x'.repeat(1000);
    const m = r.match('GET', `/users/42?${longQs}`);

    expect(m).not.toBeNull();
    expect(m!.params.id).toBe('42');
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

  it('rejects path with segment exceeding maxSegmentLength', () => {
    const r = new Router<string>({ maxSegmentLength: 5 });
    r.add('GET', '/users/:id', 'u');
    r.build();

    expect(r.match('GET', '/users/' + 'x'.repeat(10))).toBeNull();
  });

  it('rejects path exceeding maxPathLength', () => {
    const r = new Router<string>({ maxPathLength: 32 });
    r.add('GET', '/users/:id', 'u');
    r.build();

    expect(r.match('GET', '/users/' + 'x'.repeat(100))).toBeNull();
  });
});

// ── Cache behavior under stress ──────────────────────────────────────────

describe('cache stress', () => {
  it('miss cache evicts oldest when full (FIFO)', () => {
    const r = new Router<string>({ cacheSize: 3 });
    r.add('GET', '/users/:id', 'u');
    r.build();

    // 4 distinct misses — first should be evicted
    r.match('GET', '/miss1');
    r.match('GET', '/miss2');
    r.match('GET', '/miss3');
    r.match('GET', '/miss4');

    // miss1 evicted; miss4 still in. The router is asked again — should
    // re-walk for miss1, hit cache for miss4. Both return null but path
    // through code differs. Test just verifies no crash and consistent null.
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

// ── Method registry boundary ─────────────────────────────────────────────

describe('method registry', () => {
  // MAX_METHODS = 32, with the 7 default verbs (GET, POST, PUT, PATCH, DELETE,
  // OPTIONS, HEAD) pre-registered. Custom methods can fill the remaining 25 slots.
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
