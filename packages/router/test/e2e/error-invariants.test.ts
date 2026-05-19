import { describe, expect, it } from 'bun:test';

import type { RouterErrorData } from '../../src/types';

import { Router, RouterError } from '../../index';
import { RouterErrorKind } from '../../src/types';
import { catchRouterError, firstBuildIssue } from '../test-utils';

function assertActionable(data: RouterErrorData, expectedKind: RouterErrorKind): void {
  expect(data.kind).toBe(expectedKind);
  expect(typeof data.message).toBe('string');
  expect(data.message.length).toBeGreaterThan(0);

  if (data.kind !== RouterErrorKind.RouteValidation) {
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
      assertActionable((e as RouterError).data, RouterErrorKind.RouterOptionsInvalid);
    }
  });

  it(RouterErrorKind.RouterSealed, () => {
    const r = new Router<string>();
    r.add('GET', '/x', 'x');
    r.build();
    const err = catchRouterError(() => r.add('GET', '/y', 'y'));
    assertActionable(err.data, RouterErrorKind.RouterSealed);
  });

  it(RouterErrorKind.MethodEmpty, () => {
    const r = new Router<string>();
    r.add('', '/x', 'x');
    assertActionable(firstBuildIssue(r), RouterErrorKind.MethodEmpty);
  });

  it(RouterErrorKind.MethodInvalidToken, () => {
    const r = new Router<string>();
    r.add('GET POST', '/x', 'x');
    assertActionable(firstBuildIssue(r), RouterErrorKind.MethodInvalidToken);
  });

  it(RouterErrorKind.MethodLimit, () => {
    const r = new Router<string>();
    for (let i = 0; i < 26; i++) {
      r.add(`CUSTOM${i}`, `/x${i}`, `h${i}`);
    }
    assertActionable(firstBuildIssue(r), RouterErrorKind.MethodLimit);
  });

  it(RouterErrorKind.PathMissingLeadingSlash, () => {
    const r = new Router<string>();
    r.add('GET', 'users', 'x');
    assertActionable(firstBuildIssue(r), RouterErrorKind.PathMissingLeadingSlash);
  });

  it(RouterErrorKind.PathQuery, () => {
    const r = new Router<string>();
    r.add('GET', '/a?b', 'x');
    assertActionable(firstBuildIssue(r), RouterErrorKind.PathQuery);
  });

  it(RouterErrorKind.PathFragment, () => {
    const r = new Router<string>();
    r.add('GET', '/a#b', 'x');
    assertActionable(firstBuildIssue(r), RouterErrorKind.PathFragment);
  });

  it(RouterErrorKind.PathControlChar, () => {
    const r = new Router<string>();
    r.add('GET', '/a\x01b', 'x');
    assertActionable(firstBuildIssue(r), RouterErrorKind.PathControlChar);
  });

  it(RouterErrorKind.PathMalformedPercent, () => {
    const r = new Router<string>();
    r.add('GET', '/a/%ZZ', 'x');
    assertActionable(firstBuildIssue(r), RouterErrorKind.PathMalformedPercent);
  });

  it(RouterErrorKind.PathInvalidPchar, () => {
    const r = new Router<string>();
    r.add('GET', '/a/<bad>', 'x');
    assertActionable(firstBuildIssue(r), RouterErrorKind.PathInvalidPchar);
  });

  it(RouterErrorKind.PathEncodedSlash, () => {
    const r = new Router<string>();
    r.add('GET', '/a/%2F', 'x');
    assertActionable(firstBuildIssue(r), RouterErrorKind.PathEncodedSlash);
  });

  it(RouterErrorKind.PathInvalidUtf8, () => {
    const r = new Router<string>();
    r.add('GET', '/a/%C0%80', 'x');
    assertActionable(firstBuildIssue(r), RouterErrorKind.PathInvalidUtf8);
  });

  it(RouterErrorKind.PathDotSegment, () => {
    const r = new Router<string>();
    r.add('GET', '/a/../b', 'x');
    assertActionable(firstBuildIssue(r), RouterErrorKind.PathDotSegment);
  });

  it(RouterErrorKind.PathEmptySegment, () => {
    const r = new Router<string>();
    r.add('GET', '/a//b', 'x');
    assertActionable(firstBuildIssue(r), RouterErrorKind.PathEmptySegment);
  });

  it(RouterErrorKind.ParamDuplicate, () => {
    const r = new Router<string>();
    r.add('GET', '/users/:id/posts/:id', 'x');
    assertActionable(firstBuildIssue(r), RouterErrorKind.ParamDuplicate);
  });

  it('route-parse (unclosed regex)', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:id(\\d+', 'x');
    assertActionable(firstBuildIssue(r), RouterErrorKind.RouteParse);
  });

  it('route-parse (invalid regex body — compile failure)', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:id([z-a])', 'x');
    assertActionable(firstBuildIssue(r), RouterErrorKind.RouteParse);
  });

  it(RouterErrorKind.RouteDuplicate, () => {
    const r = new Router<string>();
    r.add('GET', '/x', 'a');
    r.add('GET', '/x', 'b');
    assertActionable(firstBuildIssue(r), RouterErrorKind.RouteDuplicate);
  });

  it('route-conflict (regex sibling overlap)', () => {
    const r = new Router<string>();
    r.add('GET', '/users/:id(\\d+)', 'numeric');
    r.add('GET', '/users/:id([a-z]+)', 'alpha');
    assertActionable(firstBuildIssue(r), RouterErrorKind.RouteConflict);
  });

  it('route-unreachable (static under ancestor wildcard)', () => {
    const r = new Router<string>();
    r.add('GET', '/api/*', 'wildcard');
    r.add('GET', '/api/specific', 'specific');
    assertActionable(firstBuildIssue(r), RouterErrorKind.RouteUnreachable);
  });

  it('route-validation (umbrella) — message is non-empty, errors[] is populated', () => {
    const r = new Router<string>();
    r.add('GET', '/x', 'a');
    r.add('GET', '/x', 'b');
    const err = catchRouterError(() => r.build());
    expect(err.data.kind).toBe(RouterErrorKind.RouteValidation);
    if (err.data.kind === RouterErrorKind.RouteValidation) {
      expect(err.data.message.length).toBeGreaterThan(0);
      expect(err.data.errors.length).toBeGreaterThan(0);
      for (const issue of err.data.errors) {
        expect(typeof issue.error.message).toBe('string');
        expect(issue.error.message.length).toBeGreaterThan(0);
        if (issue.error.kind !== RouterErrorKind.RouteValidation) {
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
    if (issue.kind === RouterErrorKind.RouteConflict) {
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
    if (issue.kind === RouterErrorKind.RouteUnreachable) {
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
    if (issue.kind === RouterErrorKind.ParamDuplicate) {
      expect(issue.segment).toBe('id');
    }
  });

  it('path-invalid-pchar provides segment (the offending character)', () => {
    const r = new Router<string>();
    r.add('GET', '/a/<bad>', 'x');
    const issue = firstBuildIssue(r);
    if (issue.kind === RouterErrorKind.PathInvalidPchar) {
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
    if (err.data.kind === RouterErrorKind.RouteValidation) {
      const first = err.data.errors[0]!;
      expect(first.method).toBe('GET');
      expect(first.path).toBe('/users/:slug');
      expect(first.error.path).toBe('/users/:slug');
      expect(first.error.method).toBe('GET');
    }
  });
});
