import { test, expect } from 'bun:test';

import * as PublicAPI from '../../index';
import { RouterErrorKind } from '../../src/types';

test('public API surface (value side) — exactly Router + RouterError', () => {
  const exports = Object.keys(PublicAPI).sort();

  expect(exports).toEqual(['MatchSource', 'Router', 'RouterError', 'RouterErrorKind']);
});

test('public API surface — Router is constructable', () => {
  const r = new PublicAPI.Router<string>();
  expect(r).toBeInstanceOf(PublicAPI.Router);
});

test('public API surface — RouterError is the thrown error type', () => {
  const r = new PublicAPI.Router<string>();
  r.build();

  let thrown: unknown = null;
  try {
    r.add('GET', '/x', 'x');
  } catch (e) {
    thrown = e;
  }

  expect(thrown).toBeInstanceOf(PublicAPI.RouterError);
  expect((thrown as PublicAPI.RouterError).data.kind).toBe(RouterErrorKind.RouterSealed);
});
