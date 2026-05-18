/**
 * Router concurrency contract.
 *
 * Once `build()` returns, the router is sealed and its public surface
 * (`match`, `allowedMethods`) is safe to call from any number of
 * concurrent async tasks within the same isolate.
 *
 * Contract notes:
 *
 *   - `match()` writes into a per-Router `MatchState` buffer; results
 *     are derived from that buffer **before the function returns**, so
 *     consecutive interleaved match() calls cannot corrupt each other
 *     under cooperative scheduling (single-threaded JS event loop).
 *     The contract is **single-isolate, cooperative**. Worker threads
 *     would each need their own Router (per-isolate state).
 *   - The MatchOutput returned by `match()` is a fresh object on every
 *     dynamic call; the `params` map is owned by the caller and frozen
 *     so a downstream mutation cannot corrupt the next match.
 *   - `allowedMethods()` is read-only against the same MatchState
 *     buffer; it does not race with `match()` within one tick.
 */
import { describe, expect, it } from 'bun:test';

import { Router } from '../../src/router';

describe('router is safe under concurrent async match() calls (cooperative)', () => {
  it('handles 1000 interleaved Promise-wrapped match() calls without losing results', async () => {
    const r = new Router<string>();
    r.add('GET', '/users/:id', 'user');
    r.add('GET', '/posts/:slug', 'post');
    r.add('GET', '/files/*path', 'file');
    r.build();

    const tasks: Array<Promise<{ value: string; param: string }>> = [];
    for (let i = 0; i < 1000; i++) {
      tasks.push(
        (async () => {
          // Yield to the event loop so calls actually interleave.
          if (i % 7 === 0) {await Promise.resolve();}
          const which = i % 3;
          if (which === 0) {
            const m = r.match('GET', `/users/${i}`)!;
            return { value: m.value, param: m.params.id! };
          } else if (which === 1) {
            const m = r.match('GET', `/posts/slug-${i}`)!;
            return { value: m.value, param: m.params.slug! };
          }
            const m = r.match('GET', `/files/${i}/tail`)!;
            return { value: m.value, param: m.params.path! };
          
        })(),
      );
    }

    const results = await Promise.all(tasks);

    for (let i = 0; i < results.length; i++) {
      const which = i % 3;
      const expectedValue = which === 0 ? 'user' : which === 1 ? 'post' : 'file';
      const expectedParam = which === 0 ? String(i) : which === 1 ? `slug-${i}` : `${i}/tail`;
      expect(results[i]!.value).toBe(expectedValue);
      expect(results[i]!.param).toBe(expectedParam);
    }
  });

  it('static and dynamic match() interleaved keep returning correct outputs', async () => {
    const r = new Router<string>();
    r.add('GET', '/health', 'static');
    r.add('GET', '/users/:id', 'dynamic');
    r.build();

    const N = 500;
    const tasks: Array<Promise<string>> = [];
    for (let i = 0; i < N; i++) {
      tasks.push(
        (async () => {
          if (i % 3 === 0) {await Promise.resolve();}
          return i % 2 === 0 ? r.match('GET', '/health')!.value : r.match('GET', `/users/${i}`)!.value;
        })(),
      );
    }
    const out = await Promise.all(tasks);
    for (let i = 0; i < N; i++) {
      expect(out[i]).toBe(i % 2 === 0 ? 'static' : 'dynamic');
    }
  });
});

describe('built router exposes a read-only contract', () => {
  it('rejects further add()/addAll() after build() with router-sealed', () => {
    const r = new Router<string>();
    r.add('GET', '/x', 'x');
    r.build();
    expect(() => r.add('GET', '/y', 'y')).toThrow();
    expect(() => r.addAll([['POST', '/z', 'z']])).toThrow();
  });

  it('a second build() returns the same router instance (idempotent)', () => {
    const r = new Router<string>();
    r.add('GET', '/x', 'x');
    const ret1 = r.build();
    const ret2 = r.build();
    expect(ret1).toBe(ret2);
  });

  it('static MatchOutput is the same frozen reference across repeat matches', () => {
    const r = new Router<string>();
    r.add('GET', '/health', 'h');
    r.build();
    const a = r.match('GET', '/health')!;
    const b = r.match('GET', '/health')!;
    expect(a).toBe(b);
    expect(Object.isFrozen(a)).toBe(true);
  });

  it('dynamic MatchOutput.params is frozen — caller mutation throws', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:id', 'u');
    r.build();
    const m = r.match('GET', '/users/42')!;
    expect(Object.isFrozen(m.params)).toBe(true);
    expect(() => {
      (m.params as Record<string, unknown>)['injected'] = 'evil';
    }).toThrow();
  });

  it('Router instance is frozen after build() — no field rewrites possible', () => {
    const r = new Router<string>();
    expect(Object.isFrozen(r)).toBe(false);
    r.add('GET', '/x', 'x');
    r.build();
    expect(Object.isFrozen(r)).toBe(true);
  });
});

describe('non-contract: cross-isolate safety', () => {
  it('documents that a single Router is single-isolate by design (no shared-state guarantee across workers)', () => {
    // This test exists to lock the contract in code: callers crossing
    // isolate boundaries (Worker threads, SharedArrayBuffer scenarios)
    // must instantiate a Router per-isolate. The router's MatchState
    // buffer is mutable per-call and not protected against parallel
    // (truly concurrent, not cooperative) writers.
    const r = new Router<string>();
    r.add('GET', '/x', 'x');
    r.build();
    // No assertion — the test name is the contract.
    expect(r.match('GET', '/x')?.value).toBe('x');
  });
});
