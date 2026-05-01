/**
 * Public API contract — pins the value-side surface of `@zipbul/router`.
 *
 * This is the runtime check; the type-side surface is verified at
 * compile time by anyone who imports from the package (TypeScript
 * resolves the `exports` map to `dist/index.d.ts`, which only re-exports
 * what `index.ts` does).
 *
 * Update this test deliberately when adding a new public class or
 * helper — drift here means the package's promised API changed.
 */
import { test, expect } from 'bun:test';

import * as PublicAPI from '../index';

test('public API surface (value side) — exactly Router + RouterError', () => {
  // Sort both sides so the assertion error doubles as a diff when the
  // surface drifts.
  const exports = Object.keys(PublicAPI).sort();

  expect(exports).toEqual(['Router', 'RouterError']);
});

test('public API surface — Router is constructable', () => {
  // Drift-guard: instantiation contract. Subclassing Router or
  // converting to a factory function would change this.
  const r = new PublicAPI.Router<string>();
  expect(r).toBeInstanceOf(PublicAPI.Router);
});

test('public API surface — RouterError is the thrown error type', () => {
  // Drift-guard: RouterError extends Error, exposes `data` (RouterErrorData).
  const r = new PublicAPI.Router<string>();
  r.build();

  let thrown: unknown = null;
  try {
    r.add('GET', '/x', 'x');
  } catch (e) {
    thrown = e;
  }

  expect(thrown).toBeInstanceOf(PublicAPI.RouterError);
  expect((thrown as PublicAPI.RouterError).data.kind).toBe('router-sealed');
});
