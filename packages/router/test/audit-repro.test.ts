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

test('AUDIT match() returns null for oversized path', () => {
  const r = new Router<string>({ maxPathLength: 10 });
  r.add('GET', '/foo', 'x');
  r.build();

  expect(r.match('GET', '/' + 'a'.repeat(100))).toBeNull();
});

test('AUDIT match() returns null for oversized segment at match', () => {
  const r = new Router<string>({ maxSegmentLength: 5 });
  r.add('GET', '/foo', 'x');
  r.build();

  expect(r.match('GET', '/' + 'a'.repeat(20))).toBeNull();
});

test('AUDIT match() returns null when called before build', () => {
  const r = new Router<string>();
  r.add('GET', '/foo', 'x');

  expect(r.match('GET', '/foo')).toBeNull();
});

// ─── Validator throw: wrapped into RouterError via path-parser L421 ───

test('AUDIT validator throw is wrapped into RouterError', () => {
  const r = new Router<string>({
    regexSafety: {
      validator: () => { throw new Error('custom validator rejection'); },
    },
  });

  let threw: unknown = null;
  try {
    r.add('GET', '/x/:id{\\d+}', 'x');
  } catch (e) {
    threw = e;
  }

  expect(threw).toBeInstanceOf(RouterError);
  expect((threw as RouterError).data.kind).toBe('regex-unsafe');
  expect((threw as RouterError).data.message).toContain('custom validator rejection');
});

// ─── L302-parity: never-registered method returns null (consistent) ───

test('AUDIT different-method query returns null', () => {
  const r = new Router<string>();
  r.add('PURGE' as any, '/a', 'x');
  r.build();

  expect(r.match('PURGE' as any, '/missing')).toBeNull();
  expect(r.match('MKCOL' as any, '/a')).toBeNull();
});

// ─── add() array partial failure state ───

test('AUDIT add() array partial failure: earlier methods registered before throw', () => {
  const r = new Router<string>();
  for (let i = 0; i < 25; i++) {
    r.add(`M${i}` as any, '/warm', 'x');
  }

  let threw: unknown = null;
  try {
    r.add(['GET' as any, 'NEWMETHOD' as any], '/a', 'y');
  } catch (e) {
    threw = e;
  }
  expect(threw).not.toBeNull();

  r.build();
  expect(r.match('GET', '/a')).not.toBeNull();
});

// ─── Optional param expansion ───

test('AUDIT expandOptional: 10 optionals register in reasonable time', () => {
  const r = new Router<string>();
  const path = '/' + Array.from({ length: 10 }, (_, i) => `:p${i}?`).join('/');
  const t0 = Bun.nanoseconds();
  r.add('GET', path, 'x');
  r.build();
  const elapsed = (Bun.nanoseconds() - t0) / 1e6;
  expect(elapsed).toBeLessThan(5000);
});
