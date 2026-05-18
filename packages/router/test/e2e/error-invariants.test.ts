/**
 * Invariants every RouterError instance must satisfy.
 *
 * The discriminated union in `src/types.ts` already declares `message`
 * and `suggestion` as required strings for every kind (except
 * `route-validation`, whose actionable detail lives in `errors[]`). This
 * suite goes one step further: it triggers each kind through the public
 * API and asserts the actual emitted payload carries non-empty strings.
 *
 * The type system catches a missing field at compile time; this suite
 * catches a future site that satisfies the type but emits an empty
 * string by mistake. Together they enforce a uniform user-facing error
 * shape: every RouterError tells the caller *what* went wrong and
 * *how* to fix it.
 */
import { describe, expect, it } from 'bun:test';

import type { RouterErrorData, RouterErrorKind } from '../../src/types';

import { Router, RouterError } from '../../index';
import { catchRouterError, firstBuildIssue } from '../test-utils';

function assertActionable(data: RouterErrorData, expectedKind: RouterErrorKind): void {
  expect(data.kind).toBe(expectedKind);
  expect(typeof data.message).toBe('string');
  expect(data.message.length).toBeGreaterThan(0);

  if (data.kind !== 'route-validation') {
    expect(typeof data.suggestion).toBe('string');
    expect(data.suggestion.length).toBeGreaterThan(0);
  }
}

describe('every RouterError carries actionable kind + message + suggestion', () => {
  it('router-options-invalid (cacheSize)', () => {
    expect(() => new Router({ cacheSize: -1 })).toThrow(RouterError);
    try {
      new Router({ cacheSize: -1 });
    } catch (e) {
      assertActionable((e as RouterError).data, 'router-options-invalid');
    }
  });

  it('router-sealed', () => {
    const r = new Router<string>();
    r.add('GET', '/x', 'x');
    r.build();
    const err = catchRouterError(() => r.add('GET', '/y', 'y'));
    assertActionable(err.data, 'router-sealed');
  });

  it('method-empty', () => {
    const r = new Router<string>();
    r.add('', '/x', 'x');
    assertActionable(firstBuildIssue(r), 'method-empty');
  });

  it('method-invalid-token', () => {
    const r = new Router<string>();
    r.add('GET POST', '/x', 'x');
    assertActionable(firstBuildIssue(r), 'method-invalid-token');
  });

  it('method-limit', () => {
    const r = new Router<string>();
    for (let i = 0; i < 26; i++) {r.add(`CUSTOM${i}`, `/x${i}`, `h${i}`);}
    assertActionable(firstBuildIssue(r), 'method-limit');
  });

  it('path-missing-leading-slash', () => {
    const r = new Router<string>();
    r.add('GET', 'users', 'x');
    assertActionable(firstBuildIssue(r), 'path-missing-leading-slash');
  });

  it('path-query', () => {
    const r = new Router<string>();
    r.add('GET', '/a?b', 'x');
    assertActionable(firstBuildIssue(r), 'path-query');
  });

  it('path-fragment', () => {
    const r = new Router<string>();
    r.add('GET', '/a#b', 'x');
    assertActionable(firstBuildIssue(r), 'path-fragment');
  });

  it('path-control-char', () => {
    const r = new Router<string>();
    r.add('GET', '/a\x01b', 'x');
    assertActionable(firstBuildIssue(r), 'path-control-char');
  });

  it('path-malformed-percent', () => {
    const r = new Router<string>();
    r.add('GET', '/a/%ZZ', 'x');
    assertActionable(firstBuildIssue(r), 'path-malformed-percent');
  });

  it('path-invalid-pchar', () => {
    const r = new Router<string>();
    r.add('GET', '/a/<bad>', 'x');
    assertActionable(firstBuildIssue(r), 'path-invalid-pchar');
  });

  it('path-encoded-slash', () => {
    const r = new Router<string>();
    r.add('GET', '/a/%2F', 'x');
    assertActionable(firstBuildIssue(r), 'path-encoded-slash');
  });

  it('path-invalid-utf8', () => {
    const r = new Router<string>();
    r.add('GET', '/a/%C0%80', 'x');
    assertActionable(firstBuildIssue(r), 'path-invalid-utf8');
  });

  it('path-dot-segment', () => {
    const r = new Router<string>();
    r.add('GET', '/a/../b', 'x');
    assertActionable(firstBuildIssue(r), 'path-dot-segment');
  });

  it('path-empty-segment', () => {
    const r = new Router<string>();
    r.add('GET', '/a//b', 'x');
    assertActionable(firstBuildIssue(r), 'path-empty-segment');
  });

  it('param-duplicate', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:id/posts/:id', 'x');
    assertActionable(firstBuildIssue(r), 'param-duplicate');
  });

  it('route-parse (unclosed regex)', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:id(\\d+', 'x');
    assertActionable(firstBuildIssue(r), 'route-parse');
  });

  it('route-parse (invalid regex body — compile failure)', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:id([z-a])', 'x');
    assertActionable(firstBuildIssue(r), 'route-parse');
  });

  it('route-duplicate', () => {
    const r = new Router<string>();
    r.add('GET', '/x', 'a');
    r.add('GET', '/x', 'b');
    assertActionable(firstBuildIssue(r), 'route-duplicate');
  });

  it('route-conflict (regex sibling overlap)', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:id(\\d+)', 'numeric');
    r.add('GET', '/users/:id([a-z]+)', 'alpha');
    assertActionable(firstBuildIssue(r), 'route-conflict');
  });

  it('route-unreachable (static under ancestor wildcard)', () => {
    const r = new Router<string>();
    r.add('GET', '/api/*', 'wildcard');
    r.add('GET', '/api/specific', 'specific');
    assertActionable(firstBuildIssue(r), 'route-unreachable');
  });

  it('route-validation (umbrella) — message is non-empty, errors[] is populated', () => {
    const r = new Router<string>();
    r.add('GET', '/x', 'a');
    r.add('GET', '/x', 'b');
    const err = catchRouterError(() => r.build());
    expect(err.data.kind).toBe('route-validation');
    if (err.data.kind === 'route-validation') {
      expect(err.data.message.length).toBeGreaterThan(0);
      expect(err.data.errors.length).toBeGreaterThan(0);
      // Inner issues must also be actionable.
      for (const issue of err.data.errors) {
        expect(typeof issue.error.message).toBe('string');
        expect(issue.error.message.length).toBeGreaterThan(0);
        if (issue.error.kind !== 'route-validation') {
          expect(typeof issue.error.suggestion).toBe('string');
          expect(issue.error.suggestion.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('every conflict-class RouterError carries segment + conflictsWith', () => {
  it('route-conflict provides segment + conflictsWith', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:id(\\d+)', 'numeric');
    r.add('GET', '/users/:id([a-z]+)', 'alpha');
    const issue = firstBuildIssue(r);
    if (issue.kind === 'route-conflict') {
      expect(typeof issue.segment).toBe('string');
      expect(issue.segment.length).toBeGreaterThan(0);
      expect(typeof issue.conflictsWith).toBe('string');
      expect(issue.conflictsWith.length).toBeGreaterThan(0);
    }
  });

  it('route-unreachable provides segment + conflictsWith', () => {
    const r = new Router<string>();
    r.add('GET', '/api/*', 'wildcard');
    r.add('GET', '/api/specific', 'specific');
    const issue = firstBuildIssue(r);
    if (issue.kind === 'route-unreachable') {
      expect(typeof issue.segment).toBe('string');
      expect(issue.segment.length).toBeGreaterThan(0);
      expect(typeof issue.conflictsWith).toBe('string');
      expect(issue.conflictsWith.length).toBeGreaterThan(0);
    }
  });

  it('param-duplicate provides segment', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:id/posts/:id', 'x');
    const issue = firstBuildIssue(r);
    if (issue.kind === 'param-duplicate') {
      expect(issue.segment).toBe('id');
    }
  });

  it('path-invalid-pchar provides segment (the offending character)', () => {
    const r = new Router<string>();
    r.add('GET', '/a/<bad>', 'x');
    const issue = firstBuildIssue(r);
    if (issue.kind === 'path-invalid-pchar') {
      expect(issue.segment.length).toBe(1);
    }
  });
});

describe('context fields (path + method) propagate to every emitted error', () => {
  it('add() throws — router-sealed carries the failing path + method', () => {
    const r = new Router<string>();
    r.build();
    const err = catchRouterError(() => r.add('POST', '/new', 'x'));
    expect(err.data.path).toBe('/new');
    expect(err.data.method).toBe('POST');
  });

  it('build() validation errors carry path + method per route', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:id', 'a');
    r.add('GET', '/users/:slug', 'b');
    const err = catchRouterError(() => r.build());
    if (err.data.kind === 'route-validation') {
      const first = err.data.errors[0]!;
      expect(first.method).toBe('GET');
      expect(first.path).toBe('/users/:slug');
      expect(first.error.path).toBe('/users/:slug');
      expect(first.error.method).toBe('GET');
    }
  });
});
