import { test, expect } from 'bun:test';

import { Router, RouterError } from '../index';
import { getRouterInternals } from '../internal';

const peekHandlers = (r: Router<string>): unknown[] =>
  (getRouterInternals(r).registration as unknown as { handlers?: unknown[] }).handlers ?? [];

test('failed build validation does not publish compiled handler slots', () => {
  const r = new Router<string>();

  r.add('GET', '/users/:id(\\d+)', 'digit');
  r.add('GET', '/users/:id([a-z]+)', 'alpha');

  let threw: unknown = null;
  try {
    r.build();
  } catch (e) {
    threw = e;
  }

  expect(threw).toBeInstanceOf(RouterError);
  const re = threw as RouterError;
  expect(re.data.kind).toBe('route-validation');
  if (re.data.kind === 'route-validation') {
    expect(re.data.errors[0]?.error.kind).toBe('route-conflict');
  }

  const handlers = peekHandlers(r);
  expect(handlers.length).toBe(0);
});

test('failed build validation keeps compiled handler snapshot empty after many invalid routes', () => {
  const r = new Router<string>();

  r.add('GET', '/x/:id(\\d+)', 'base');
  for (let i = 0; i < 10; i++) {
    r.add('GET', '/x/:id([a-z]+)', `bad-${i}`);
  }

  expect(() => r.build()).toThrow(RouterError);

  expect(peekHandlers(r).length).toBe(0);
});
