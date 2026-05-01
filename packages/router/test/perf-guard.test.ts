import { describe, expect, it } from 'bun:test';

import { Router } from '../src/router';
import { getRouterInternals } from '../internal';

function optionalPath(count: number): string {
  let path = '/x';

  for (let i = 0; i < count; i++) path += `/:p${i}?`;

  return path;
}

describe('performance guard invariants', () => {
  it('optional expansions share one handler and only duplicate terminal metadata', () => {
    const r = new Router<string>();
    r.add('GET', optionalPath(10), 'handler');
    r.build();

    const snapshot = (getRouterInternals(r).registration as any).snapshot;

    expect(snapshot.handlers.length).toBe(1);
    expect(snapshot.terminals.length).toBe(1024);
    expect(snapshot.terminals.every((t: { handlerIndex: number }) => t.handlerIndex === 0)).toBe(true);
  });

  it('high-cardinality dynamic hit cache evicts old entries and preserves recent entries', () => {
    const r = new Router<string>({ cacheSize: 8 });
    r.add('GET', '/users/:id', 'user');
    r.build();

    const first = r.match('GET', '/users/0');
    expect(first?.meta.source).toBe('dynamic');

    for (let i = 1; i <= 32; i++) {
      expect(r.match('GET', `/users/${i}`)?.value).toBe('user');
    }

    expect(r.match('GET', '/users/32')?.meta.source).toBe('cache');
    expect(r.match('GET', '/users/0')?.meta.source).toBe('dynamic');
  });
});
