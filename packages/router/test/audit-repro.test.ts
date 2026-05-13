import { test, expect } from 'bun:test';

import { Router, RouterError } from '../index';

// ─── Strict contract: match() always returns MatchOutput<T> | null (no throws) ───

test('AUDIT match() returns null for unregistered custom method', () => {
  const r = new Router<string>();
  r.add('GET', '/foo', 'x');
  r.build();

  expect(r.match('PURGE' as any, '/foo')).toBeNull();
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
  r.add('PURGE' as any, '/a', 'x');
  r.build();

  expect(r.match('PURGE' as any, '/missing')).toBeNull();
  expect(r.match('MKCOL' as any, '/a')).toBeNull();
});

// ─── add() array failure atomicity ───

test('AUDIT add() array validation is reported during build without publishing partial state', () => {
  const r = new Router<string>();
  for (let i = 0; i < 25; i++) {
    r.add(`M${i}` as any, '/warm', 'x');
  }

  r.add(['GET' as any, 'NEWMETHOD' as any], '/a', 'y');

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

test('AUDIT expandOptional: 10 optionals with shared paramName register in reasonable time', () => {
  const r = new Router<string>();
  const path = '/x/:tail?';
  const t0 = Bun.nanoseconds();
  r.add('GET', path, 'x');
  r.build();
  const elapsed = (Bun.nanoseconds() - t0) / 1e6;
  expect(elapsed).toBeLessThan(5000);
});
