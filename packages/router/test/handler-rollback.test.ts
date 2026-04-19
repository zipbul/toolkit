import { test, expect } from 'bun:test';

import { Router, RouterError } from '../index';

// insertOne 실패 경로에서 handlers 슬롯이 누수되지 않는지 확인
test('handlers slot is rolled back when insert fails (route-conflict)', () => {
  const r = new Router<string>();

  r.add('GET', '/users/:id{\\d+}', 'digit');

  // 같은 path, 다른 pattern → route-conflict (insertParam 실패)
  let threw: unknown = null;
  try {
    r.add('GET', '/users/:id{[a-z]+}', 'alpha');
  } catch (e) {
    threw = e;
  }

  expect(threw).toBeInstanceOf(RouterError);
  expect((threw as RouterError).data.kind).toBe('route-conflict');

  // handlers 배열이 롤백되어 정확히 1개만 남아야 함
  const handlers = (r as any).handlers as unknown[];

  expect(handlers.length).toBe(1);
  expect(handlers[0]).toBe('digit');
});

test('no leak when many inserts fail in sequence', () => {
  const r = new Router<string>();

  r.add('GET', '/x/:id{\\d+}', 'base');

  const baseHandlers = (r as any).handlers.length;

  // 10번 실패 유도
  for (let i = 0; i < 10; i++) {
    try {
      r.add('GET', '/x/:id{[a-z]+}', `bad-${i}`);
    } catch {
      // expected
    }
  }

  const afterHandlers = (r as any).handlers.length;

  // 실패한 10번의 add 는 handlers 를 증가시키면 안 됨
  expect(afterHandlers).toBe(baseHandlers);
});
