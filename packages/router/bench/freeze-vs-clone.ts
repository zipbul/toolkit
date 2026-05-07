/* Microbench: Object.freeze vs clone cost for the params cache. */
/* eslint-disable no-console */
export {};

const ITERS = 5_000_000;

function measure(label: string, run: () => unknown): void {
  for (let i = 0; i < 100_000; i++) run();
  const t0 = Bun.nanoseconds();
  let sink: unknown = 0;
  for (let i = 0; i < ITERS; i++) sink = run();
  const t1 = Bun.nanoseconds();
  console.log(label.padEnd(56), ((t1 - t0) / ITERS).toFixed(2), 'ns/op', String(sink).slice(0, 4));
}

// scenario: dynamic match returns params { id: '42', tenant: 'acme' }
// cache stores the params and returns it on next match for same path

// Option A: factory creates fresh object each call (current 2× call situation)
function freshFactory(id: string, tenant: string): Record<string, string> {
  return { id, tenant };
}

// Option B: factory + Object.freeze (immutable cache return)
function frozenFactory(id: string, tenant: string): Readonly<Record<string, string>> {
  return Object.freeze({ id, tenant });
}

// Option C: factory + clone-on-cache-hit (deep copy each cache return)
function cloneOnHit(cached: Record<string, string>): Record<string, string> {
  return { ...cached };
}

// Option D: lazy proxy (Proxy with handler for read-only params)
function lazyProxy(id: string, tenant: string): Record<string, string> {
  return new Proxy({ id, tenant }, {
    set() { throw new Error('frozen'); },
  });
}

let counter = 0;

measure('A: fresh object literal (factory call)', () => {
  return freshFactory(`id${counter++ & 1023}`, 'acme');
});

measure('B: Object.freeze({...}) per call', () => {
  return frozenFactory(`id${counter++ & 1023}`, 'acme');
});

const cachedSrc = { id: 'cached', tenant: 'acme' };
measure('C: clone-on-hit (spread)', () => {
  return cloneOnHit(cachedSrc);
});

measure('D: Proxy wrapper per call', () => {
  return lazyProxy(`id${counter++ & 1023}`, 'acme');
});

// Option E: read frozen object (cache return path — what caller does)
const frozenCached = Object.freeze({ id: 'cached', tenant: 'acme' });
measure('E: read frozen cached object (.id)', () => {
  return frozenCached.id;
});

const mutCached = { id: 'cached', tenant: 'acme' };
measure('F: read mutable cached object (.id)', () => {
  return mutCached.id;
});

// scenario: factory call with offsets (offset → string materialization)
const url = '/users/42/items/100';
const off = new Int32Array([7, 9, 16, 19]);

measure('G: substring materialize from offsets (factory)', () => {
  return { id: url.slice(off[0]!, off[1]!), item: url.slice(off[2]!, off[3]!) };
});

measure('H: substring + Object.freeze', () => {
  return Object.freeze({ id: url.slice(off[0]!, off[1]!), item: url.slice(off[2]!, off[3]!) });
});
