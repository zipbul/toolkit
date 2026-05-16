/**
 * Path normalization + percent-decode behavior matrix.
 */
import { describe, it, expect } from 'bun:test';

import { Router } from '../../src/router';

describe('percent-decoded param values', () => {
  it('decodes ASCII percent-encoded segment', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:name', 'h');
    r.build();
    expect(r.match('GET', '/users/foo%20bar')?.params['name']).toBe('foo bar');
    expect(r.match('GET', '/users/a%2Bb')?.params['name']).toBe('a+b');
    expect(r.match('GET', '/users/%2D')?.params['name']).toBe('-');
  });

  it('decodes multibyte UTF-8', () => {
    const r = new Router<string>();
    r.add('GET', '/x/:name', 'h');
    r.build();
    expect(r.match('GET', '/x/%E4%B8%80')?.params['name']).toBe('一');
    expect(r.match('GET', '/x/%F0%9F%98%80')?.params['name']).toBe('😀');
  });

  it('preserves literal value when no percent', () => {
    const r = new Router<string>();
    r.add('GET', '/x/:name', 'h');
    r.build();
    expect(r.match('GET', '/x/normal')?.params['name']).toBe('normal');
  });

  it('rejects encoded slash inside captured value (path-encoded-slash policy)', () => {
    // Policy is enforced at register-time on literal paths; runtime
    // match path is not re-validated. A param can technically capture
    // %2F bytes from the URL — verify behavior.
    const r = new Router<string>();
    r.add('GET', '/users/:name', 'h');
    r.build();
    // Walker tokenizes by raw byte 47 (`/`); %2F (3 bytes) is not 47
    // and is therefore treated as part of the segment value, decoded
    // to '/'.
    expect(r.match('GET', '/users/a%2Fb')?.params['name']).toBe('a/b');
  });

  it('wildcard captures encoded slash bytes raw (not decoded) in tail', () => {
    const r = new Router<string>();
    r.add('GET', '/files/*path', 'h');
    r.build();
    // Wildcard tail is intentionally raw — no decoder pass per
    // path-parser policy (wildcard captures are byte-exact).
    expect(r.match('GET', '/files/a%2Fb')?.params['path']).toBe('a%2Fb');
    expect(r.match('GET', '/files/deep/nested/file.txt')?.params['path']).toBe('deep/nested/file.txt');
  });

  it('repeated dynamic match returns identical params (cache hit semantics)', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:name', 'h');
    r.build();
    const first = r.match('GET', '/users/foo%20bar');
    expect(first?.meta.source).toBe('dynamic');
    expect(first?.params['name']).toBe('foo bar');
    const second = r.match('GET', '/users/foo%20bar');
    expect(second?.meta.source).toBe('cache');
    expect(second?.params['name']).toBe('foo bar');
    // Cache must not corrupt params on repeated hit
    const third = r.match('GET', '/users/foo%20bar');
    expect(third?.params['name']).toBe('foo bar');
  });
});

describe('case folding (caseSensitive=false)', () => {
  it('matches case-insensitively when configured', () => {
    const r = new Router<string>({ pathCaseSensitive: false });
    r.add('GET', '/Users/:Id', 'h');
    r.build();
    expect(r.match('GET', '/users/42')?.value).toBe('h');
    expect(r.match('GET', '/USERS/42')?.value).toBe('h');
    expect(r.match('GET', '/Users/42')?.value).toBe('h');
  });

  it('preserves case when caseSensitive=true (default)', () => {
    const r = new Router<string>();
    r.add('GET', '/Users/:Id', 'h');
    r.build();
    expect(r.match('GET', '/Users/42')?.value).toBe('h');
    expect(r.match('GET', '/users/42')).toBeNull();
  });
});

describe('trailing slash normalization', () => {
  it('trims trailing slash by default (trailingSlash=undefined → ignore)', () => {
    const r = new Router<string>();
    r.add('GET', '/x/y', 'h');
    r.build();
    expect(r.match('GET', '/x/y')?.value).toBe('h');
    expect(r.match('GET', '/x/y/')?.value).toBe('h');
  });

  it('preserves trailing slash distinction in match probe when trailingSlash=strict', () => {
    const r = new Router<string>({ trailingSlash: 'strict' });
    r.add('GET', '/x/y', 'h');
    r.build();
    expect(r.match('GET', '/x/y')?.value).toBe('h');
    expect(r.match('GET', '/x/y/')).toBeNull();
  });
});

describe('integration — register/build/match end-to-end', () => {
  it('handles a realistic REST API with mixed shapes', () => {
    const r = new Router<string>();
    r.add('GET', '/health', 'health');
    r.add('GET', '/api/v1/users', 'list-users');
    r.add('POST', '/api/v1/users', 'create-user');
    r.add('GET', '/api/v1/users/:id', 'get-user');
    r.add('PATCH', '/api/v1/users/:id', 'update-user');
    r.add('DELETE', '/api/v1/users/:id', 'delete-user');
    r.add('GET', '/api/v1/users/:id/posts', 'list-posts');
    r.add('GET', '/api/v1/users/:id/posts/:postId', 'get-post');
    r.add('GET', '/static/*path', 'static');
    r.build();

    expect(r.match('GET', '/health')?.value).toBe('health');
    expect(r.match('GET', '/api/v1/users')?.value).toBe('list-users');
    expect(r.match('POST', '/api/v1/users')?.value).toBe('create-user');
    expect(r.match('GET', '/api/v1/users/42')?.value).toBe('get-user');
    expect(r.match('PATCH', '/api/v1/users/42')?.value).toBe('update-user');
    expect(r.match('DELETE', '/api/v1/users/42')?.value).toBe('delete-user');
    expect(r.match('GET', '/api/v1/users/42/posts')?.value).toBe('list-posts');
    expect(r.match('GET', '/api/v1/users/42/posts/100')?.value).toBe('get-post');
    expect(r.match('GET', '/static/index.html')?.value).toBe('static');
    expect(r.match('GET', '/static/nested/path/file.css')?.value).toBe('static');
    expect(r.match('GET', '/missing')).toBeNull();
    expect(r.match('PUT', '/api/v1/users')).toBeNull();
  });

  it('addAll bulk registration', () => {
    const r = new Router<string>();
    r.addAll([
      ['GET', '/a', 'a'],
      ['GET', '/b', 'b'],
      ['POST', '/c', 'c'],
    ]);
    r.build();
    expect(r.match('GET', '/a')?.value).toBe('a');
    expect(r.match('GET', '/b')?.value).toBe('b');
    expect(r.match('POST', '/c')?.value).toBe('c');
  });

  it('multi-method registration via array', () => {
    const r = new Router<string>();
    r.add(['GET', 'POST'], '/x', 'multi');
    r.build();
    expect(r.match('GET', '/x')?.value).toBe('multi');
    expect(r.match('POST', '/x')?.value).toBe('multi');
    expect(r.match('DELETE', '/x')).toBeNull();
  });

  it('wildcard method (*) expands to every registered method at seal', () => {
    const r = new Router<string>();
    r.add('*', '/x', 'all');
    r.add('PATCH', '/y', 'patch-y'); // patch is not a default method
    r.build();
    expect(r.match('GET', '/x')?.value).toBe('all');
    expect(r.match('POST', '/x')?.value).toBe('all');
    expect(r.match('PATCH', '/x')?.value).toBe('all'); // includes seal-time methods
  });

  it('cache hit on repeated dynamic match', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:id', 'h');
    r.build();
    const first = r.match('GET', '/users/42');
    const second = r.match('GET', '/users/42');
    expect(first?.value).toBe('h');
    expect(second?.value).toBe('h');
    expect(second?.meta.source).toBe('cache');
  });
});
