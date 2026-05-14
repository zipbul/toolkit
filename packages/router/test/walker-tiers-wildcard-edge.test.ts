/**
 * Walker tier wildcard / star / multi branch coverage.
 * Currently 73% line coverage in segment-walk.ts; this fills the
 * factored / prefixed-factor / multi-prefix factor walker
 * wildcard-tail and root-store branches.
 */
import { describe, it, expect } from 'bun:test';

import { Router } from '../src/router';

describe('walker wildcard tail across tiers', () => {
  it('iterative walker — star wildcard at leaf accepts non-empty + empty', () => {
    const r = new Router<string>();
    r.add('GET', '/files/*path', 'files');
    r.build();
    expect(r.match('GET', '/files/a/b/c.txt')?.value).toBe('files');
    expect(r.match('GET', '/files/single')?.value).toBe('files');
    // *name is the `star` origin in zipbul: a bare /files matches with
    // empty `path`. multi-origin (e.g. /files/+rest) would reject empty.
    expect(r.match('GET', '/files')?.value).toBe('files');
  });

  it('factored walker — star wildcard sharedNext leaf (1500 tenants)', () => {
    const r = new Router<string>();
    for (let i = 0; i < 1500; i++) {
      r.add('GET', `/tenant-${i}/files/*path`, `wild-${i}`);
    }
    r.build();
    expect(r.match('GET', '/tenant-0/files/a/b')?.value).toBe('wild-0');
    expect(r.match('GET', '/tenant-1499/files/x/y/z')?.value).toBe('wild-1499');
    expect(r.match('GET', '/tenant-9999/files/x')).toBeNull();
  });

  it('prefixed-factor walker — star wildcard past the prefix chain', () => {
    const r = new Router<string>();
    for (let i = 0; i < 1500; i++) {
      r.add('GET', `/api/${i}/files/*path`, `api-wild-${i}`);
    }
    r.build();
    expect(r.match('GET', '/api/0/files/a')?.value).toBe('api-wild-0');
    expect(r.match('GET', '/api/750/files/deep/nested')?.value).toBe('api-wild-750');
    expect(r.match('GET', '/api/9999/files/x')).toBeNull();
  });

  it('multi-prefix factor walker — wildcard tail under each prefix', () => {
    const r = new Router<string>();
    for (let i = 0; i < 1500; i++) {
      r.add('GET', `/users/${i}/files/*path`, `u-w-${i}`);
      r.add('GET', `/api/${i}/files/*path`, `a-w-${i}`);
    }
    r.build();
    expect(r.match('GET', '/users/0/files/a/b')?.value).toBe('u-w-0');
    expect(r.match('GET', '/api/1499/files/x')?.value).toBe('a-w-1499');
    expect(r.match('GET', '/users/9999/files/x')).toBeNull();
  });
});

describe('walker root edge cases', () => {
  it('root-only static handler', () => {
    const r = new Router<string>();
    r.add('GET', '/', 'root');
    r.build();
    expect(r.match('GET', '/')?.value).toBe('root');
    expect(r.match('GET', '/anything')).toBeNull();
  });

  it('root wildcard /*all matches everything including /', () => {
    const r = new Router<string>();
    r.add('GET', '/*all', 'catch-all');
    r.build();
    expect(r.match('GET', '/anything')?.value).toBe('catch-all');
    expect(r.match('GET', '/a/b/c')?.value).toBe('catch-all');
    // *all is star-origin: empty tail at root '/' is captured.
    expect(r.match('GET', '/')?.value).toBe('catch-all');
  });

  it('root + leaf coexist', () => {
    const r = new Router<string>();
    r.add('GET', '/', 'root');
    r.add('GET', '/users/:id', 'user');
    r.build();
    expect(r.match('GET', '/')?.value).toBe('root');
    expect(r.match('GET', '/users/42')?.value).toBe('user');
  });
});

describe('static + dynamic precedence at same position', () => {
  it('static literal wins over param at the same segment', () => {
    const r = new Router<string>();
    r.add('GET', '/users/me', 'me');
    r.add('GET', '/users/:id', 'detail');
    r.build();
    expect(r.match('GET', '/users/me')?.value).toBe('me');
    expect(r.match('GET', '/users/42')?.value).toBe('detail');
  });

  it('deeper nested precedence', () => {
    const r = new Router<string>();
    r.add('GET', '/api/v1/users', 'list');
    r.add('GET', '/api/v1/users/:id', 'one');
    r.add('GET', '/api/v1/:resource', 'generic');
    r.build();
    expect(r.match('GET', '/api/v1/users')?.value).toBe('list');
    expect(r.match('GET', '/api/v1/users/42')?.value).toBe('one');
    expect(r.match('GET', '/api/v1/posts')?.value).toBe('generic');
  });
});

describe('match.params edge values', () => {
  it('empty string param value (not allowed by walker)', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:id', 'h');
    r.build();
    // /users// — empty segment between slashes; walker requires segLen > 0
    expect(r.match('GET', '/users//')).toBeNull();
    expect(r.match('GET', '/users/')).toBeNull();
  });

  it('long param value', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:id', 'h');
    r.build();
    const long = 'x'.repeat(2000);
    expect(r.match('GET', `/users/${long}`)?.params['id']).toBe(long);
  });

  it('decoded param value (percent-encoded)', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:name', 'h');
    r.build();
    expect(r.match('GET', '/users/foo%20bar')?.params['name']).toBe('foo bar');
    expect(r.match('GET', '/users/%E4%B8%80')?.params['name']).toBe('一');
  });
});
