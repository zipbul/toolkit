import { describe, it, expect } from 'bun:test';

import { RouterError } from './error';

describe('RouterError', () => {
  it('should be instanceof Error', () => {
    const err = new RouterError({ kind: 'route-parse', message: 'bad path' });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(RouterError);
  });

  it('should set name to RouterError', () => {
    const err = new RouterError({ kind: 'route-parse', message: 'bad path' });
    expect(err.name).toBe('RouterError');
  });

  it('should use data.message as Error message', () => {
    const err = new RouterError({ kind: 'route-parse', message: 'Path must start with /' });
    expect(err.message).toBe('Path must start with /');
  });

  it('should preserve data object with all fields', () => {
    // `regex-anchor` carries every public field shape (kind/message/segment/
    // suggestion + context path/method). Narrow with `kind` first so we can
    // access kind-specific fields without `as any`.
    const data = {
      kind: 'regex-anchor' as const,
      message: 'anchor stripped',
      path: '/users/:id(^\\d+$)',
      method: 'GET',
      segment: '^\\d+$',
      suggestion: 'Remove anchors',
    };

    const err = new RouterError(data);
    expect(err.data).toBe(data);
    expect(err.data.kind).toBe('regex-anchor');
    expect(err.data.path).toBe('/users/:id(^\\d+$)');
    expect(err.data.method).toBe('GET');

    if (err.data.kind === 'regex-anchor') {
      expect(err.data.segment).toBe('^\\d+$');
      expect(err.data.suggestion).toBe('Remove anchors');
    }
  });

  it('should preserve data.registeredCount for addAll errors', () => {
    const err = new RouterError({
      kind: 'route-duplicate',
      message: 'duplicate',
      registeredCount: 3,
    });

    expect(err.data.registeredCount).toBe(3);
  });

  it('should have readonly data property', () => {
    const err = new RouterError({ kind: 'segment-limit', message: 'too long' });
    expect(typeof err.data).toBe('object');
    expect(err.data.kind).toBe('segment-limit');
  });

  it('should support all error kinds — required fields stubbed per discriminated union', () => {
    // After A3, kind-specific required fields are enforced by the type
    // system. Each constructor call below provides the minimum legal shape
    // for its kind. Aspirational kinds present in pre-A3 history
    // (regex-timeout / method-not-found / not-built / path-too-long) were
    // never produced anywhere in src and have been dropped — they belonged
    // to a separate matcher-state error channel, not RouterErrData.
    const variants = [
      { kind: 'router-sealed' as const, message: 'sealed', suggestion: 'recreate' },
      { kind: 'route-duplicate' as const, message: 'dup' },
      { kind: 'route-conflict' as const, message: 'conflict', segment: 'x' },
      { kind: 'route-parse' as const, message: 'parse error' },
      { kind: 'param-duplicate' as const, message: 'param dup', path: '/a', segment: 'p' },
      { kind: 'regex-unsafe' as const, message: 'unsafe', segment: '\\d+' },
      { kind: 'regex-anchor' as const, message: 'anchor', segment: '^x$' },
      { kind: 'method-limit' as const, message: 'method limit', method: 'X' },
      { kind: 'segment-limit' as const, message: 'seg limit' },
    ];

    for (const data of variants) {
      const err = new RouterError(data);
      expect(err.data.kind).toBe(data.kind);
    }
  });

  it('should have a proper stack trace', () => {
    const err = new RouterError({ kind: 'route-parse', message: 'test' });
    expect(err.stack).toBeDefined();
    expect(typeof err.stack).toBe('string');
  });
});
