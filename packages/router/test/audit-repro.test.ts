import { test, expect } from 'bun:test';

import { Router, RouterError } from '../index';

// ─── Strict contract: match() always returns MatchOutput<T> | null (no throws) ───

test('AUDIT match() returns null for unregistered custom method', () => {
  const r = new Router<string>();
  r.add('GET', '/foo', 'x');
  r.build();

  expect(r.match('PURGE', '/foo')).toBeNull();
});

test('AUDIT match() returns null for standard method with no routes', () => {
  const r = new Router<string>();
  r.add('GET', '/foo', 'x');
  r.build();

  expect(r.match('HEAD', '/foo')).toBeNull();
});

test('AUDIT match() returns null when called before build', () => {
  const r = new Router<string>();
  r.add('GET', '/foo', 'x');

  expect(r.match('GET', '/foo')).toBeNull();
});

// ─── L302-parity: never-registered method returns null (consistent) ───

test('AUDIT different-method query returns null', () => {
  const r = new Router<string>();
  r.add('PURGE', '/a', 'x');
  r.build();

  expect(r.match('PURGE', '/missing')).toBeNull();
  expect(r.match('MKCOL', '/a')).toBeNull();
});

// ─── add() array failure atomicity ───

test('AUDIT add() array validation is reported during build without publishing partial state', () => {
  const r = new Router<string>();
  for (let i = 0; i < 25; i++) {
    r.add(`M${i}`, '/warm', 'x');
  }

  r.add(['GET', 'NEWMETHOD'], '/a', 'y');

  expect(() => r.build()).toThrow(RouterError);
  expect(r.match('GET', '/a')).toBeNull();
});

// ─── Optional param expansion ───

test('AUDIT expandOptional: rejects 10 differently-named optionals (paramName collision)', () => {
  const r = new Router<string>();
  const path = '/' + Array.from({ length: 10 }, (_, i) => `:p${i}?`).join('/');
  r.add('GET', path, 'x');
  expect(() => r.build()).toThrow();
});

test('expandOptional: a single optional segment registers and matches both variants', () => {
  // Behavioral test for the optional-expansion fast path. A single
  // `?`-decorated segment produces two registered variants: present
  // and dropped. Both must match the corresponding URL.
  const r = new Router<string>();
  r.add('GET', '/x/:tail?', 'x');
  r.build();

  const present = r.match('GET', '/x/abc');
  expect(present).not.toBeNull();
  expect(present!.value).toBe('x');
  expect(present!.params.tail).toBe('abc');

  const dropped = r.match('GET', '/x');
  expect(dropped).not.toBeNull();
  expect(dropped!.value).toBe('x');
});
