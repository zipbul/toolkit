import { describe, it, expect } from 'bun:test';

import { RouterError } from './error';
import { RouterErrorKind } from './types';

describe('RouterError', () => {
  it('should be instanceof Error', () => {
    const err = new RouterError({ kind: RouterErrorKind.RouteParse, message: 'bad path', suggestion: 'fix it' });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(RouterError);
  });

  it('should set name to RouterError', () => {
    const err = new RouterError({ kind: RouterErrorKind.RouteParse, message: 'bad path', suggestion: 'fix it' });
    expect(err.name).toBe('RouterError');
  });

  it('should use data.message as Error message', () => {
    const err = new RouterError({
      kind: RouterErrorKind.RouteParse,
      message: 'Path must start with /',
      suggestion: 'add leading slash',
    });
    expect(err.message).toBe('Path must start with /');
  });

  it('should preserve data object with all fields', () => {
    const data = {
      kind: RouterErrorKind.ParamDuplicate as const,
      message: 'duplicate param id',
      path: '/users/:id/posts/:id',
      method: 'GET',
      segment: 'id',
      suggestion: 'Rename one of the :id parameters.',
    };

    const err = new RouterError(data);
    expect(err.data).toBe(data);
    expect(err.data.kind).toBe(RouterErrorKind.ParamDuplicate);
    expect(err.data.path).toBe('/users/:id/posts/:id');
    expect(err.data.method).toBe('GET');

    if (err.data.kind === RouterErrorKind.ParamDuplicate) {
      expect(err.data.segment).toBe('id');
      expect(err.data.suggestion).toBe('Rename one of the :id parameters.');
    }
  });

  it('should preserve data.registeredCount for addAll errors', () => {
    const err = new RouterError({
      kind: RouterErrorKind.RouteDuplicate,
      message: 'duplicate',
      suggestion: 'Use a different path or HTTP method',
      registeredCount: 3,
    });

    expect(err.data.registeredCount).toBe(3);
  });

  it('should have readonly data property', () => {
    const err = new RouterError({ kind: RouterErrorKind.RouteParse, message: 'too long', suggestion: 'shorten' });
    expect(typeof err.data).toBe('object');
    expect(err.data.kind).toBe(RouterErrorKind.RouteParse);
  });

  it('should support all error kinds — required fields stubbed per discriminated union', () => {
    const variants = [
      { kind: RouterErrorKind.RouterSealed as const, message: 'sealed', suggestion: 'recreate' },
      { kind: RouterErrorKind.RouteDuplicate as const, message: 'dup', suggestion: 'use another' },
      {
        kind: RouterErrorKind.RouteConflict as const,
        message: 'conflict',
        segment: 'x',
        conflictsWith: 'y',
        suggestion: 'reorder',
      },
      { kind: RouterErrorKind.RouteParse as const, message: 'parse error', suggestion: 'fix syntax' },
      { kind: RouterErrorKind.ParamDuplicate as const, message: 'param dup', path: '/a', segment: 'p', suggestion: 'rename' },
      { kind: RouterErrorKind.MethodLimit as const, message: 'method limit', method: 'X', suggestion: 'reduce' },
    ];

    for (const data of variants) {
      const err = new RouterError(data);
      expect(err.data.kind).toBe(data.kind);
    }
  });

  it('should have a proper stack trace', () => {
    const err = new RouterError({ kind: RouterErrorKind.RouteParse, message: 'test', suggestion: 'fix' });
    expect(err.stack).toBeDefined();
    expect(typeof err.stack).toBe('string');
  });
});
