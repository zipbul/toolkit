/**
 * Unit spec for the `/internal` subpath. Verifies the symbol-keyed
 * accessor behaves both for genuine Router instances and for
 * imposters — the latter must throw rather than return undefined.
 */
import { describe, expect, it } from 'bun:test';

import { Router } from './src/router';
import { getRouterInternals } from './internal';

describe('getRouterInternals — happy path', () => {
  it('returns the live internals wrapper for a freshly constructed Router', () => {
    const r = new Router<string>();
    const internals = getRouterInternals(r);
    expect(internals).toBeDefined();
    expect(internals.registration).toBeDefined();
  });

  it('exposes matchImpl + matchLayer only after build() runs', () => {
    const r = new Router<string>();
    r.add('GET', '/x', 'x');
    const beforeBuild = getRouterInternals(r);
    expect(beforeBuild.matchImpl).toBeUndefined();
    expect(beforeBuild.matchLayer).toBeUndefined();

    r.build();
    const afterBuild = getRouterInternals(r);
    expect(afterBuild.matchImpl).toBeDefined();
    expect(afterBuild.matchLayer).toBeDefined();
  });

  it('returns a wrapper whose object identity is stable across calls on one instance', () => {
    const r = new Router<string>();
    const a = getRouterInternals(r);
    const b = getRouterInternals(r);
    expect(a).toBe(b);
  });
});

describe('getRouterInternals — non-Router probe rejection', () => {
  it('throws when called on a plain object missing the internals symbol slot', () => {
    const fake = {} as unknown as Router<string>;
    expect(() => getRouterInternals(fake)).toThrow(
      /Router internals slot missing/,
    );
  });

  it('throws when called on an instance of a non-Router class', () => {
    class Imposter {}
    const fake = new Imposter() as unknown as Router<string>;
    expect(() => getRouterInternals(fake)).toThrow(
      /Router internals slot missing/,
    );
  });

  it('error message identifies the package boundary so callers can route the fix', () => {
    const fake = {} as unknown as Router<string>;
    try {
      getRouterInternals(fake);
      throw new Error('expected throw');
    } catch (e) {
      expect((e as Error).message).toContain('@zipbul/router');
    }
  });
});
