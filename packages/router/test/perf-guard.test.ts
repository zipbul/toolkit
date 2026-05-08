import { describe, expect, it } from 'bun:test';

import { Router } from '../src/router';
import { getRouterInternals } from '../internal';

describe('performance guard invariants', () => {
  it('optional expansions share one handler index across all expansion variants', () => {
    // /items/:id? expands to two concrete routes (`/items` and `/items/:id`).
    // Both must point to the single registered handler — terminal metadata
    // may be duplicated, but the underlying handlers array stays at length 1.
    const r = new Router<string>();
    r.add('GET', '/items/:id?', 'handler');
    r.build();

    const snapshot = (getRouterInternals(r).registration as any).snapshot;

    expect(snapshot.handlers.length).toBe(1);
    const slab = snapshot.terminalSlab;
    expect(slab.count).toBeGreaterThanOrEqual(1);
    for (let t = 0; t < slab.count; t++) {
      expect(slab.data[t * 2]).toBe(0);
    }
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
