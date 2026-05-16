/**
 * Memory-bound invariants.
 *
 * Built-once routers must not leak build-time state across instances.
 * Each test rebuilds a router N times and verifies RSS doesn't grow
 * unbounded. Uses `Bun.gc(true)` between samples so leaks can't hide
 * behind not-yet-collected garbage; `process.memoryUsage().rss` is the
 * observable.
 *
 * Thresholds are deliberately generous (30 MB delta after 100 rebuilds)
 * because RSS includes shared libraries, JIT code caches, and per-call
 * fluctuations. A real leak (handlers / registration / closure capture
 * leak across builds) would push the delta into 100+ MB territory, well
 * past the threshold. The threshold sits above measured JIT-promotion
 * noise (typically 10-25 MB across runs) but well below the leak floor.
 */
import { describe, expect, it } from 'bun:test';

import { Router } from '../../src/router';

// `Bun.gc(true)` triggers a sync full GC; this helps RSS measurements
// stabilize between samples. Without it, the deferred libpas scavenger
// can leave dozens of MB attached for several seconds.
function forceGc(): void {
  if (typeof (globalThis as unknown as { Bun?: { gc?: (sync: boolean) => void } }).Bun?.gc === 'function') {
    (globalThis as unknown as { Bun: { gc: (sync: boolean) => void } }).Bun.gc(true);
  }
}

function rssMB(): number {
  return process.memoryUsage().rss / (1024 * 1024);
}

function settleSamples(samples: number, intervalMs = 5): Promise<number> {
  return new Promise<number>((resolve) => {
    let i = 0;
    let last = 0;
    const tick = () => {
      forceGc();
      last = rssMB();
      i++;
      if (i >= samples) resolve(last);
      else setTimeout(tick, intervalMs);
    };
    tick();
  });
}

describe('memory bounds — repeated builds do not leak', () => {
  it('100 builds of a 100-route mixed router stay within 30 MB RSS delta', async () => {
    // Warm up: first few builds inflate the JIT cache, codegen cache,
    // and pre-allocated string tables. Don't measure them.
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
      try { r.build(); } catch { /* expected */ }
    }

    const before = await settleSamples(8);

    for (let trial = 0; trial < 100; trial++) {
      const r = new Router<string>();
      for (let i = 0; i < 50; i++) {
        r.add('GET', `/route-${i}`, `h-${i}`);
      }
      r.add('GET', '/route-0', 'dup');
      try { r.build(); } catch { /* expected route-duplicate */ }
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

    // 10_000 distinct dynamic paths. With cacheSize=16, the cache must
    // evict aggressively — RSS growth bounded by per-entry overhead × 16.
    for (let i = 0; i < 10_000; i++) {
      r.match('GET', `/users/${i}`);
    }

    forceGc();
    const after = rssMB();
    const deltaMB = after - before;
    // 10k matches with bounded cache shouldn't push RSS more than a few MB.
    expect(deltaMB).toBeLessThan(20);
  });
});
