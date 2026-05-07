import { describe, expect, it } from 'bun:test';

import { Router, RouterError } from '../index';
function catchRouterError(fn: () => void): RouterError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(RouterError);
    return e as RouterError;
  }

  throw new Error('Expected RouterError');
}

describe('Router regression fixes', () => {
  it('reports anchored and unanchored param patterns as the same route shape at build time', () => {
    const router = new Router<string>();

    router.add('GET', '/users/:id(\\d+)', 'plain');
    router.add('GET', '/users/:id(^\\d+$)', 'anchored');

    const error = catchRouterError(() => router.build());
    expect(error.data.kind).toBe('route-validation');
    if (error.data.kind === 'route-validation') {
      expect(error.data.errors).toHaveLength(1);
      expect(error.data.errors[0]?.error.kind).toBe('route-duplicate');
    }
  });

  it('rejects empty path segments at build time instead of silently remapping dynamic routes', () => {
    const router = new Router<string>();

    router.add('GET', '/api//users/:id', 'handler');

    const error = catchRouterError(() => router.build());
    expect(error.data.kind).toBe('route-validation');
    if (error.data.kind === 'route-validation') {
      expect(error.data.errors[0]?.error.kind).toBe('path-empty-segment');
    }
  });

  it('reports star expansion conflicts as aggregate build validation errors', () => {
    const router = new Router<string>();

    router.add('PUT', '/files/*other', 'put-wild');
    router.add('*', '/files/*path', 'star');

    const error = catchRouterError(() => router.build());
    expect(error.data.kind).toBe('route-validation');
    if (error.data.kind === 'route-validation') {
      expect(error.data.errors.some(issue => issue.method === 'PUT' && issue.error.kind === 'route-conflict')).toBe(true);
    }

    const valid = new Router<string>();
    valid.add('PUT', '/files/*other', 'put-wild');
    valid.build();
    expect(valid.match('PUT', '/files/static')?.value).toBe('put-wild');
  });

  it('does not publish compiled state when regex compilation fails after static insertion', () => {
    const router = new Router<string>();

    router.add('GET', '/leak/path/:id([z-a])', 'bad');

    const error = catchRouterError(() => router.build());
    expect(error.data.kind).toBe('route-validation');
    if (error.data.kind === 'route-validation') {
      expect(error.data.errors[0]?.error.kind).toBe('route-parse');
    }
    expect(router.match('GET', '/leak/path/value')).toBeNull();
  });

  it('uses an immutable options snapshot for parser and matcher behavior', () => {
    const options = { caseSensitive: false };
    const router = new Router<string>(options);

    router.add('GET', '/Hello', 'handler');
    options.caseSensitive = true;
    router.build();

    expect(router.match('GET', '/hello')?.value).toBe('handler');
    expect(router.match('GET', '/Hello')?.value).toBe('handler');
  });

  it('reports invalid dynamic routes without making later valid routes reachable', () => {
    const router = new Router<string>();

    router.add('GET', '/a/:x([z-a])', 'bad');
    router.add('GET', '/a/:y', 'good');

    const error = catchRouterError(() => router.build());
    expect(error.data.kind).toBe('route-validation');
    if (error.data.kind === 'route-validation') {
      expect(error.data.errors[0]?.error.kind).toBe('route-parse');
    }
    expect(router.match('GET', '/a/value')).toBeNull();

    const valid = new Router<string>();
    valid.add('GET', '/a/:y', 'good');
    valid.build();
    expect(valid.match('GET', '/a/value')?.value).toBe('good');
  });
});
