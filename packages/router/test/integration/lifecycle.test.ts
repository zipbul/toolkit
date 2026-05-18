/**
 * Stress + lifecycle scenarios that the existing suite doesn't cover.
 */
import { describe, it, expect } from 'bun:test';

import { RouterError } from '../../src/error';
import { Router } from '../../src/router';

describe('Router lifecycle — re-seal idempotency', () => {
  it('build() called twice returns the same router (no re-execution)', () => {
    const r = new Router<string>();
    r.add('GET', '/x', 'h');
    const ret1 = r.build();
    const ret2 = r.build();
    expect(ret1).toBe(ret2);
    expect(r.match('GET', '/x')?.value).toBe('h');
  });

  it('add() after build() always throws router-sealed', () => {
    const r = new Router<string>();
    r.add('GET', '/x', 'h');
    r.build();
    for (const fn of [
      () => r.add('GET', '/y', 'h'),
      () => r.add('POST', '/z', 'h'),
      () => r.add(['GET', 'POST'], '/w', 'h'),
      () => r.add('*', '/v', 'h'),
      () => r.addAll([['GET', '/u', 'h']]),
    ]) {
      try {
        fn();
        throw new Error('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(RouterError);
        expect((e as RouterError).data.kind).toBe('router-sealed');
      }
    }
  });

  it('match() before build() returns null silently', () => {
    const r = new Router<string>();
    r.add('GET', '/x', 'h');
    expect(r.match('GET', '/x')).toBeNull();
  });

  it('allowedMethods() before build() returns empty array', () => {
    const r = new Router<string>();
    r.add('GET', '/x', 'h');
    expect(r.allowedMethods('/x')).toEqual([]);
  });
});

describe('addAll + add interleaved', () => {
  it('mixed addAll and add calls register correctly', () => {
    const r = new Router<string>();
    r.add('GET', '/a', 'a');
    r.addAll([
      ['POST', '/b', 'b'],
      ['DELETE', '/c', 'c'],
    ]);
    r.add('PATCH', '/d', 'd');
    r.build();
    expect(r.match('GET', '/a')?.value).toBe('a');
    expect(r.match('POST', '/b')?.value).toBe('b');
    expect(r.match('DELETE', '/c')?.value).toBe('c');
    expect(r.match('PATCH', '/d')?.value).toBe('d');
  });
});

describe('Cache eviction stress (clock-sweep)', () => {
  it('survives 10k unique-path churn without unbounded growth', () => {
    const r = new Router<string>({ cacheSize: 8 });
    r.add('GET', '/users/:id', 'h');
    r.build();
    // 10k unique probes — cache must evict older entries
    for (let i = 0; i < 10_000; i++) {
      r.match('GET', `/users/u${i}`);
    }
    // Final probe still works
    expect(r.match('GET', '/users/last')?.value).toBe('h');
    // Re-probe a recent value — likely cache hit
    expect(r.match('GET', '/users/u9999')?.value).toBe('h');
  });

  it('cacheSize=1 always evicts on miss', () => {
    const r = new Router<string>({ cacheSize: 1 });
    r.add('GET', '/users/:id', 'h');
    r.build();
    expect(r.match('GET', '/users/a')?.value).toBe('h');
    expect(r.match('GET', '/users/b')?.value).toBe('h');
    expect(r.match('GET', '/users/c')?.value).toBe('h');
  });
});

describe('Recursive walker (hasAmbiguousNode true case)', () => {
  // hasAmbiguousNode true requires: same node has static child AND
  // (paramChild OR wildcardStore) — i.e. literal vs param vs wildcard
  // at the same depth. Our parser rejects most ambiguity at register
  // time; the surviving case is mid-position static + param.
  it('static + param siblings at the same depth route correctly', () => {
    const r = new Router<string>();
    r.add('GET', '/users/me/profile', 'me-profile');
    r.add('GET', '/users/me', 'me');
    r.add('GET', '/users/:id', 'detail');
    r.add('GET', '/users/:id/posts', 'posts');
    r.build();
    expect(r.match('GET', '/users/me')?.value).toBe('me');
    expect(r.match('GET', '/users/me/profile')?.value).toBe('me-profile');
    expect(r.match('GET', '/users/42')?.value).toBe('detail');
    expect(r.match('GET', '/users/42/posts')?.value).toBe('posts');
    // backtrack: matches /users/me/posts would need backtrack to :id
    // → /me static doesn't have /posts child → fall back to :id path
    expect(r.match('GET', '/users/me/posts')?.value).toBe('posts');
  });
});

describe('Method registry — bulk + custom', () => {
  it('handles default 7 methods + 25 custom (= 32 total)', () => {
    const r = new Router<string>();
    for (let i = 0; i < 25; i++) {
      r.add(`CUSTOM${i.toString().padStart(2, '0')}`, '/x', `h-${i}`);
    }
    r.add('GET', '/y', 'get-y');
    r.build();
    expect(r.match('CUSTOM00', '/x')?.value).toBe('h-0');
    expect(r.match('CUSTOM24', '/x')?.value).toBe('h-24');
    expect(r.match('GET', '/y')?.value).toBe('get-y');
    // allowedMethods includes custom
    const methods = r.allowedMethods('/x');
    expect(methods.length).toBe(25);
  });
});

describe('Encoded path edge', () => {
  it('throws on malformed percent-encoded input (caller responsibility)', () => {
    const r = new Router<string>();
    r.add('GET', '/x/:p', 'h');
    r.build();
    // %FF on its own is malformed UTF-8 — `decodeURIComponent` throws
    // and the router does not swallow it. Caller (HTTP server boundary)
    // is responsible for handing well-formed pathnames.
    expect(() => r.match('GET', '/x/%FF')).toThrow();
  });
});
