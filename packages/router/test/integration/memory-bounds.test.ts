import { describe, expect, it } from 'bun:test';

import { Router } from '../../src/router';

function forceGc(): void {
  if (typeof (globalThis as unknown as { Bun?: { gc?: (sync: boolean) => void } }).Bun?.gc === 'function') {
    (globalThis as unknown as { Bun: { gc: (sync: boolean) => void } }).Bun.gc(true);
  }
}

function rssMB(): number {
  return process.memoryUsage().rss / (1024 * 1024);
}

function settleSamples(samples: number, intervalMs = 5): Promise<number> {
  return new Promise<number>(resolve => {
    let i = 0;
    let last = 0;
    const tick = () => {
      forceGc();
      last = rssMB();
      i++;
      if (i >= samples) {
        resolve(last);
      } else {
        setTimeout(tick, intervalMs);
      }
    };
    tick();
  });
}

describe('memory bounds — repeated builds do not leak', () => {
  it('100 builds of a 100-route mixed router stay within 30 MB RSS delta', async () => {
    for (let warm = 0; warm < 5; warm++) {
      const r = new Router<string>();
      for (let i = 0; i < 100; i++) {
        r.add('GET', `/api/v1/users/${i}/posts/:id`, `h-${i}`);
      }
      r.build();
      r.match('GET', '/api/v1/users/50/posts/42');
    }

    const before = await settleSamples(8);

    for (let trial = 0; trial < 100; trial++) {
      const r = new Router<string>();
      for (let i = 0; i < 100; i++) {
        r.add('GET', `/api/v1/users/${i}/posts/:id`, `h-${i}`);
      }
      r.build();
      r.match('GET', '/api/v1/users/50/posts/42');
    }

    const after = await settleSamples(8);
    const deltaMB = after - before;
    expect(deltaMB).toBeLessThan(30);
  });

  it('50 builds of a wildcard-heavy router stay within 30 MB RSS delta', async () => {
    for (let warm = 0; warm < 5; warm++) {
      const r = new Router<string>();
      for (let i = 0; i < 50; i++) {
        r.add('GET', `/files-${i}/*path`, `f-${i}`);
      }
      r.build();
    }

    const before = await settleSamples(8);

    for (let trial = 0; trial < 50; trial++) {
      const r = new Router<string>();
      for (let i = 0; i < 50; i++) {
        r.add('GET', `/files-${i}/*path`, `f-${i}`);
      }
      r.build();
      r.match('GET', '/files-25/a/b/c');
    }

    const after = await settleSamples(8);
    const deltaMB = after - before;
    expect(deltaMB).toBeLessThan(30);
  });

  it('failed builds (rollback path) do not leak heap', async () => {
    for (let warm = 0; warm < 5; warm++) {
      const r = new Router<string>();
      r.add('GET', '/x', 'a');
      r.add('GET', '/x', 'b');
      try {
        r.build();
      } catch {
        void 0;
      }
    }

    const before = await settleSamples(8);

    for (let trial = 0; trial < 100; trial++) {
      const r = new Router<string>();
      for (let i = 0; i < 50; i++) {
        r.add('GET', `/route-${i}`, `h-${i}`);
      }
      r.add('GET', '/route-0', 'dup');
      try {
        r.build();
      } catch {
        void 0;
      }
    }

    const after = await settleSamples(8);
    const deltaMB = after - before;
    expect(deltaMB).toBeLessThan(30);
  });
});

describe('memory bounds — cache eviction is bounded', () => {
  it('cache stays at most cacheSize entries under high-cardinality dynamic load', async () => {
    const r = new Router<string>({ cacheSize: 16 });
    r.add('GET', '/users/:id', 'u');
    r.build();

    forceGc();
    const before = rssMB();

    for (let i = 0; i < 10_000; i++) {
      r.match('GET', `/users/${i}`);
    }

    forceGc();
    const after = rssMB();
    const deltaMB = after - before;
    expect(deltaMB).toBeLessThan(20);
  });
});
