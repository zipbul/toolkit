import { describe, it, expect } from 'bun:test';

import type { RouterErrorData } from '../../src/types';

import { RouterError } from '../../src/error';
import { Router } from '../../src/router';
import { RouterErrorKind } from '../../src/types';

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
    if (err.data.kind === RouterErrorKind.RouteValidation) {
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
  it(RouterErrorKind.RouterSealed, () => {
    const r = new Router<string>();
    r.build();
    expectKindOnAdd(() => r.add('GET', '/x', 'v'), RouterErrorKind.RouterSealed);
  });

  it(RouterErrorKind.MethodEmpty, () => {
    expectKindOnBuild(r => r.add('', '/x', 'v'), RouterErrorKind.MethodEmpty);
  });

  it(RouterErrorKind.MethodInvalidToken, () => {
    expectKindOnBuild(r => r.add('GET ', '/x', 'v'), RouterErrorKind.MethodInvalidToken);
  });

  it(RouterErrorKind.MethodLimit, () => {
    expectKindOnBuild(r => {
      for (let i = 0; i < 40; i++) {
        r.add(`M${i.toString().padStart(2, '0')}`, '/x', `v-${i}`);
      }
    }, RouterErrorKind.MethodLimit);
  });

  it(RouterErrorKind.PathMissingLeadingSlash, () => {
    expectKindOnBuild(r => r.add('GET', 'no-slash', 'v'), RouterErrorKind.PathMissingLeadingSlash);
  });

  it(RouterErrorKind.PathQuery, () => {
    expectKindOnBuild(r => r.add('GET', '/foo?bar', 'v'), RouterErrorKind.PathQuery);
  });

  it(RouterErrorKind.PathFragment, () => {
    expectKindOnBuild(r => r.add('GET', '/foo#frag', 'v'), RouterErrorKind.PathFragment);
  });

  it(RouterErrorKind.PathControlChar, () => {
    expectKindOnBuild(r => r.add('GET', '/foobar', 'v'), RouterErrorKind.PathControlChar);
  });

  it(RouterErrorKind.PathInvalidPchar, () => {
    expectKindOnBuild(r => r.add('GET', '/foo\\bar', 'v'), RouterErrorKind.PathInvalidPchar);
  });

  it(RouterErrorKind.PathMalformedPercent, () => {
    expectKindOnBuild(r => r.add('GET', '/foo%G0bar', 'v'), RouterErrorKind.PathMalformedPercent);
  });

  it(RouterErrorKind.PathEncodedSlash, () => {
    expectKindOnBuild(r => r.add('GET', '/foo/%2F/bar', 'v'), RouterErrorKind.PathEncodedSlash);
  });

  it(RouterErrorKind.PathDotSegment, () => {
    expectKindOnBuild(r => r.add('GET', '/foo/../bar', 'v'), RouterErrorKind.PathDotSegment);
  });

  it(RouterErrorKind.PathEmptySegment, () => {
    expectKindOnBuild(r => r.add('GET', '/foo//bar', 'v'), RouterErrorKind.PathEmptySegment);
  });

  it('route-parse (unclosed regex)', () => {
    expectKindOnBuild(r => r.add('GET', '/users/:id(\\d+', 'v'), RouterErrorKind.RouteParse);
  });

  it('route-parse (optional cap)', () => {
    expectKindOnBuild(r => {
      const path = '/' + Array.from({ length: 5 }, (_, i) => `:p${i}?`).join('/');
      r.add('GET', path, 'v');
    }, RouterErrorKind.RouteParse);
  });

  it('route-parse (31-capture cap)', () => {
    expectKindOnBuild(r => {
      const path = '/' + Array.from({ length: 32 }, (_, i) => `:p${i}`).join('/');
      r.add('GET', path, 'v');
    }, RouterErrorKind.RouteParse);
  });

  it(RouterErrorKind.ParamDuplicate, () => {
    expectKindOnBuild(r => r.add('GET', '/users/:id/:id', 'v'), RouterErrorKind.ParamDuplicate);
  });

  it(RouterErrorKind.RouteDuplicate, () => {
    expectKindOnBuild(r => {
      r.add('GET', '/x', 'a');
      r.add('GET', '/x', 'b');
    }, RouterErrorKind.RouteDuplicate);
  });

  it(RouterErrorKind.RouteConflict, () => {
    expectKindOnBuild(r => {
      r.add('GET', '/users/:id(\\d+)', 'a');
      r.add('GET', '/users/:slug([a-z]+)', 'b');
    }, RouterErrorKind.RouteConflict);
  });

  it(RouterErrorKind.RouteUnreachable, () => {
    expectKindOnBuild(r => {
      r.add('GET', '/users/*tail', 'a');
      r.add('GET', '/users/me', 'b');
    }, RouterErrorKind.RouteUnreachable);
  });
});
