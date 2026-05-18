/**
 * Reproducer for every RouterErrorKind. Each test triggers exactly one
 * kind to lock the error pipeline against silent regressions.
 */
import { describe, it, expect } from 'bun:test';

import type { RouterErrorData, RouterErrorKind } from '../../src/types';

import { RouterError } from '../../src/error';
import { Router } from '../../src/router';

function expectKindOnAdd(fn: () => void, kind: RouterErrorKind): void {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(RouterError);
    expect((e as RouterError).data.kind).toBe(kind);
    return;
  }
  throw new Error(`expected RouterError(${kind}) on add()`);
}

function expectKindOnBuild(register: (r: Router<string>) => void, kind: RouterErrorKind): RouterErrorData {
  const r = new Router<string>();
  register(r);
  try {
    r.build();
  } catch (e) {
    expect(e).toBeInstanceOf(RouterError);
    const err = e as RouterError;
    if (err.data.kind === 'route-validation') {
      const inner = err.data.errors[0]!.error;
      expect(inner.kind as string).toBe(kind);
      return inner;
    }
    expect(err.data.kind as string).toBe(kind);
    return err.data;
  }
  throw new Error(`expected RouterError(${kind}) on build()`);
}

describe('RouterErrorKind reproducers (full coverage of 22 kinds)', () => {
  it('router-sealed', () => {
    const r = new Router<string>();
    r.build();
    expectKindOnAdd(() => r.add('GET', '/x', 'v'), 'router-sealed');
  });

  it('method-empty', () => {
    expectKindOnBuild(r => r.add('', '/x', 'v'), 'method-empty');
  });

  it('method-invalid-token', () => {
    expectKindOnBuild(r => r.add('GET ', '/x', 'v'), 'method-invalid-token');
  });

  it('method-limit', () => {
    expectKindOnBuild(r => {
      for (let i = 0; i < 40; i++) {
        r.add(`M${i.toString().padStart(2, '0')}`, '/x', `v-${i}`);
      }
    }, 'method-limit');
  });

  it('path-missing-leading-slash', () => {
    expectKindOnBuild(r => r.add('GET', 'no-slash', 'v'), 'path-missing-leading-slash');
  });

  it('path-query', () => {
    expectKindOnBuild(r => r.add('GET', '/foo?bar', 'v'), 'path-query');
  });

  it('path-fragment', () => {
    expectKindOnBuild(r => r.add('GET', '/foo#frag', 'v'), 'path-fragment');
  });

  it('path-control-char', () => {
    expectKindOnBuild(r => r.add('GET', '/foobar', 'v'), 'path-control-char');
  });

  it('path-invalid-pchar', () => {
    // backslash is outside the pchar table
    expectKindOnBuild(r => r.add('GET', '/foo\\bar', 'v'), 'path-invalid-pchar');
  });

  it('path-malformed-percent', () => {
    expectKindOnBuild(r => r.add('GET', '/foo%G0bar', 'v'), 'path-malformed-percent');
  });

  it('path-encoded-slash', () => {
    expectKindOnBuild(r => r.add('GET', '/foo/%2F/bar', 'v'), 'path-encoded-slash');
  });

  it('path-dot-segment', () => {
    expectKindOnBuild(r => r.add('GET', '/foo/../bar', 'v'), 'path-dot-segment');
  });

  it('path-empty-segment', () => {
    expectKindOnBuild(r => r.add('GET', '/foo//bar', 'v'), 'path-empty-segment');
  });

  it('route-parse (unclosed regex)', () => {
    expectKindOnBuild(r => r.add('GET', '/users/:id(\\d+', 'v'), 'route-parse');
  });

  it('route-parse (optional cap)', () => {
    expectKindOnBuild(r => {
      const path = '/' + Array.from({ length: 5 }, (_, i) => `:p${i}?`).join('/');
      r.add('GET', path, 'v');
    }, 'route-parse');
  });

  it('route-parse (31-capture cap)', () => {
    expectKindOnBuild(r => {
      const path = '/' + Array.from({ length: 32 }, (_, i) => `:p${i}`).join('/');
      r.add('GET', path, 'v');
    }, 'route-parse');
  });

  it('param-duplicate', () => {
    expectKindOnBuild(r => r.add('GET', '/users/:id/:id', 'v'), 'param-duplicate');
  });

  it('route-duplicate', () => {
    expectKindOnBuild(r => {
      r.add('GET', '/x', 'a');
      r.add('GET', '/x', 'b');
    }, 'route-duplicate');
  });

  it('route-conflict', () => {
    // Sibling regex constraints conflict at the same position
    expectKindOnBuild(r => {
      r.add('GET', '/users/:id(\\d+)', 'a');
      r.add('GET', '/users/:slug([a-z]+)', 'b');
    }, 'route-conflict');
  });

  it('route-unreachable', () => {
    // Wildcard already accepts everything beneath /users — adding a
    // descendant is unreachable.
    expectKindOnBuild(r => {
      r.add('GET', '/users/*tail', 'a');
      r.add('GET', '/users/me', 'b');
    }, 'route-unreachable');
  });
});
