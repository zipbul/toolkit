import { describe, it, expect } from 'bun:test';

import { RouterError } from './error';

describe('RouterError', () => {
  it('should be instanceof Error', () => {
    const err = new RouterError({ kind: 'route-parse', message: 'bad path', suggestion: 'fix it' });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(RouterError);
  });

  it('should set name to RouterError', () => {
    const err = new RouterError({ kind: 'route-parse', message: 'bad path', suggestion: 'fix it' });
    expect(err.name).toBe('RouterError');
  });

  it('should use data.message as Error message', () => {
    const err = new RouterError({ kind: 'route-parse', message: 'Path must start with /', suggestion: 'add leading slash' });
    expect(err.message).toBe('Path must start with /');
  });

  it('should preserve data object with all fields', () => {
    // `param-duplicate` carries every public field shape (kind/message/
    // segment/suggestion + context path/method). Narrow with `kind` first
    // so we can access kind-specific fields without `as any`.
    const data = {
      kind: 'param-duplicate' as const,
      message: 'duplicate param id',
      path: '/users/:id/posts/:id',
      method: 'GET',
      segment: 'id',
      suggestion: 'Rename one of the :id parameters.',
    };

    const err = new RouterError(data);
    expect(err.data).toBe(data);
    expect(err.data.kind).toBe('param-duplicate');
    expect(err.data.path).toBe('/users/:id/posts/:id');
    expect(err.data.method).toBe('GET');

    if (err.data.kind === 'param-duplicate') {
      expect(err.data.segment).toBe('id');
      expect(err.data.suggestion).toBe('Rename one of the :id parameters.');
    }
  });

  it('should preserve data.registeredCount for addAll errors', () => {
    const err = new RouterError({
      kind: 'route-duplicate',
      message: 'duplicate',
      suggestion: 'Use a different path or HTTP method',
      registeredCount: 3,
    });

    expect(err.data.registeredCount).toBe(3);
  });

  it('should have readonly data property', () => {
    const err = new RouterError({ kind: 'route-parse', message: 'too long', suggestion: 'shorten' });
    expect(typeof err.data).toBe('object');
    expect(err.data.kind).toBe('route-parse');
  });

  it('should support all error kinds — required fields stubbed per discriminated union', () => {
    // After A3, kind-specific required fields are enforced by the type
    // system. Each constructor call below provides the minimum legal shape
    // for its kind. Aspirational kinds present in pre-A3 history
    // (regex-timeout / method-not-found / not-built / path-too-long /
    // segment-limit) were never produced anywhere in src or have been
    // dropped along with the option that emitted them.
    const variants = [
      { kind: 'router-sealed' as const, message: 'sealed', suggestion: 'recreate' },
      { kind: 'route-duplicate' as const, message: 'dup', suggestion: 'use another' },
      { kind: 'route-conflict' as const, message: 'conflict', segment: 'x', conflictsWith: 'y', suggestion: 'reorder' },
      { kind: 'route-parse' as const, message: 'parse error', suggestion: 'fix syntax' },
      { kind: 'param-duplicate' as const, message: 'param dup', path: '/a', segment: 'p', suggestion: 'rename' },
      { kind: 'method-limit' as const, message: 'method limit', method: 'X', suggestion: 'reduce' },
    ];

    for (const data of variants) {
      const err = new RouterError(data);
      expect(err.data.kind).toBe(data.kind);
    }
  });

  it('should have a proper stack trace', () => {
    const err = new RouterError({ kind: 'route-parse', message: 'test', suggestion: 'fix' });
    expect(err.stack).toBeDefined();
    expect(typeof err.stack).toBe('string');
  });
});
