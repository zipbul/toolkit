import { test, expect } from 'bun:test';

import { Router, RouterError } from '../index';
import { getRouterInternals } from '../internal';

// Internal-state inspection helper. Pre-B1 the handlers array lived on
// Router itself; after B1 (Registration extraction) the registration
// phase owns it until seal(). Tests targeting the rollback semantics of
// the *registration* path read through `registration.handlers`.
const peekHandlers = (r: Router<string>): unknown[] =>
  (getRouterInternals(r).registration as unknown as { handlers: unknown[] }).handlers;

// insertOne 실패 경로에서 handlers 슬롯이 누수되지 않는지 확인
test('handlers slot is rolled back when insert fails (route-conflict)', () => {
  const r = new Router<string>();

  r.add('GET', '/users/:id(\\d+)', 'digit');

  // 같은 path, 다른 pattern → route-conflict (insertParam 실패)
  let threw: unknown = null;
  try {
    r.add('GET', '/users/:id([a-z]+)', 'alpha');
  } catch (e) {
    threw = e;
  }

  expect(threw).toBeInstanceOf(RouterError);
  expect((threw as RouterError).data.kind).toBe('route-conflict');

  // handlers 배열이 롤백되어 정확히 1개만 남아야 함
  const handlers = peekHandlers(r);

  expect(handlers.length).toBe(1);
  expect(handlers[0]).toBe('digit');
});

test('no leak when many inserts fail in sequence', () => {
  const r = new Router<string>();

  r.add('GET', '/x/:id(\\d+)', 'base');

  const baseHandlers = peekHandlers(r).length;

  // 10번 실패 유도
  for (let i = 0; i < 10; i++) {
    try {
      r.add('GET', '/x/:id([a-z]+)', `bad-${i}`);
    } catch {
      // expected
    }
  }

  const afterHandlers = peekHandlers(r).length;

  // 실패한 10번의 add 는 handlers 를 증가시키면 안 됨
  expect(afterHandlers).toBe(baseHandlers);
});
