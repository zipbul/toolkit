/**
 * `allowedMethods(path)` — cold-path companion to `match()`.
 *
 * HTTP adapters call this only when `match()` returns null, to distinguish
 * "no route" (404) from "path matches under different method" (405). The
 * router stays domain-neutral — the function returns the registered HTTP
 * methods as data; adapters decide how to translate that into HTTP status
 * codes and headers.
 */
import { describe, it, expect } from 'bun:test';

import { Router } from '../../src/router';
import { TrailingSlash } from '../../src/types';

describe('allowedMethods', () => {
  it('returns empty for completely unknown paths (404 territory)', () => {
    const r = new Router<number>();
    r.add('GET', '/users/:id', 1);
    r.build();

    expect(r.allowedMethods('/nonexistent')).toEqual([]);
  });

  it('returns registered methods for a path that matches under others (405 territory)', () => {
    const r = new Router<number>();
    r.add('GET', '/users/:id', 1);
    r.add('POST', '/users/:id', 2);
    r.add('DELETE', '/users/:id', 3);
    r.build();

    const allowed = r.allowedMethods('/users/42');

    expect([...allowed].sort()).toEqual(['DELETE', 'GET', 'POST']);
  });

  it('returns the matching method even when called for the same path that match() succeeded for', () => {
    const r = new Router<number>();
    r.add('GET', '/x', 1);
    r.build();

    expect(r.match('GET', '/x')).not.toBeNull();
    expect(r.allowedMethods('/x')).toEqual(['GET']);
  });

  it('honors trailing-slash normalization (default ignoreTrailingSlash=true)', () => {
    const r = new Router<number>();
    r.add('GET', '/users', 1);
    r.build();

    expect(r.allowedMethods('/users/')).toEqual(['GET']);
    expect(r.allowedMethods('/users')).toEqual(['GET']);
  });

  it('strict trailing-slash with ignoreTrailingSlash=false', () => {
    const r = new Router<number>({ trailingSlash: TrailingSlash.Strict });
    r.add('GET', '/users', 1);
    r.build();

    expect(r.allowedMethods('/users')).toEqual(['GET']);
    expect(r.allowedMethods('/users/')).toEqual([]);
  });

  it('strips query string before matching', () => {
    const r = new Router<number>();
    r.add('GET', '/users/:id', 1);
    r.build();

    expect(r.allowedMethods('/users/42?token=abc')).toEqual(['GET']);
  });

  it('case-insensitive matching with caseSensitive=false', () => {
    const r = new Router<number>({ pathCaseSensitive: false });
    r.add('GET', '/Users', 1);
    r.add('POST', '/Users', 2);
    r.build();

    expect([...r.allowedMethods('/USERS')].sort()).toEqual(['GET', 'POST']);
  });

  it('mixes static and dynamic — both report correctly', () => {
    const r = new Router<number>();
    r.add('GET', '/static', 1);
    r.add('POST', '/users/:id', 2);
    r.build();

    expect(r.allowedMethods('/static')).toEqual(['GET']);
    expect(r.allowedMethods('/users/42')).toEqual(['POST']);
    expect(r.allowedMethods('/missing')).toEqual([]);
  });

  it('returns empty before build()', () => {
    const r = new Router<number>();
    r.add('GET', '/x', 1);

    expect(r.allowedMethods('/x')).toEqual([]);
  });

  it('does not pollute matchState observable to subsequent match() calls', () => {
    const r = new Router<number>();
    r.add('GET', '/users/:id', 1);
    r.add('POST', '/users/:id', 2);
    r.build();

    // Run allowedMethods first — fills state with dynamic walker output
    r.allowedMethods('/users/42');

    // Subsequent match() returns its own fresh state, regardless of what
    // allowedMethods left behind
    const m = r.match('GET', '/users/99')!;

    expect(m.value).toBe(1);
    expect(m.params.id).toBe('99');
  });

  it('handles wildcard routes', () => {
    const r = new Router<number>();
    r.add('GET', '/files/*p', 1);
    r.add('PUT', '/files/*p', 2);
    r.build();

    expect([...r.allowedMethods('/files/dir/file.txt')].sort()).toEqual(['GET', 'PUT']);
    expect(r.allowedMethods('/files')).toEqual(['GET', 'PUT'].sort()); // star captures empty
  });

  it('handles optional-param expansion paths', () => {
    const r = new Router<number>();
    r.add('GET', '/users/:id?', 1);
    r.build();

    // Both /users and /users/X are matched by the same registered route
    expect(r.allowedMethods('/users')).toEqual(['GET']);
    expect(r.allowedMethods('/users/42')).toEqual(['GET']);
  });

  it('adapter pattern: 404 vs 405 disambiguation', () => {
    const r = new Router<number>();
    r.add('GET', '/api/users/:id', 1);
    r.build();

    // Adapter pattern under test
    function classify(method: string, path: string): '200' | '405' | '404' {
      const out = r.match(method as 'GET', path);

      if (out !== null) {
        return '200';
      }

      const allowed = r.allowedMethods(path);

      if (allowed.length === 0) {
        return '404';
      }

      return '405';
    }

    expect(classify('GET', '/api/users/42')).toBe('200');
    expect(classify('POST', '/api/users/42')).toBe('405');
    expect(classify('GET', '/nonexistent')).toBe('404');
  });
});
