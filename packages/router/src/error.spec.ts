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
    const data = {
      kind: 'route-conflict' as const,
      message: 'conflict',
      path: '/users/:id',
      method: 'GET',
      segment: 'id',
      suggestion: 'Use a different path',
    };

    const err = new RouterError(data);
    expect(err.data).toBe(data);
    expect(err.data.kind).toBe('route-conflict');
    expect(err.data.path).toBe('/users/:id');
    expect(err.data.method).toBe('GET');
    expect(err.data.segment).toBe('id');
    expect(err.data.suggestion).toBe('Use a different path');
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

  it('should support all error kinds', () => {
    const kinds = [
      'segment-limit', 'route-conflict',
      'route-duplicate', 'route-parse', 'param-duplicate', 'regex-unsafe',
      'regex-anchor', 'regex-timeout', 'method-limit', 'method-not-found',
      'not-built', 'path-too-long', 'router-sealed',
    ] as const;

    for (const kind of kinds) {
      const err = new RouterError({ kind, message: `error: ${kind}` });
      expect(err.data.kind).toBe(kind);
    }
  });

  it('should have a proper stack trace', () => {
    const err = new RouterError({ kind: 'route-parse', message: 'test' });
    expect(err.stack).toBeDefined();
    expect(typeof err.stack).toBe('string');
  });
});
