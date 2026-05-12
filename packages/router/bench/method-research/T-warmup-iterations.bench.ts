/**
 * T) WARMUP_ITERATIONS = 20 in segment-walk.ts:36 — measure if 5/10/40
 * iterations make a meaningful difference for first-call latency.
 *
 * Hypothesis: 20 may be over- or under-tuned. Bun/JSC tier-up baseline
 * threshold differs from V8.
 */

import { run, bench, summary, do_not_optimize } from 'mitata';

import { Router } from '../../src/router';

function makeRouter(routes: number): Router<string> {
  const r = new Router<string>();
  for (let i = 0; i < routes; i++) {
    r.add('GET', `/api/v1/users/${i}`, `h${i}`);
    r.add('GET', `/api/v1/orders/${i}/items`, `o${i}`);
  }
  return r;
}

async function main() {
  // Build many routers, measure first-call latency.
  const PROBE = '/api/v1/users/42';
  const STATE = { handlerIndex: -1, paramCount: 0, paramOffsets: new Int32Array(64) };
  void STATE;

  for (const routeCount of [10, 100, 1000] as const) {
    console.log(`\n=== ${routeCount * 2} routes — first match latency ===`);
    summary(() => {
      bench('build + first match', () => {
        const r = makeRouter(routeCount);
        r.build();
        do_not_optimize(r.match('GET', PROBE));
      });
      bench('build + 10 matches (warmth)', () => {
        const r = makeRouter(routeCount);
        r.build();
        for (let i = 0; i < 10; i++) do_not_optimize(r.match('GET', PROBE));
      });
      bench('build + 100 matches (steady)', () => {
        const r = makeRouter(routeCount);
        r.build();
        for (let i = 0; i < 100; i++) do_not_optimize(r.match('GET', PROBE));
      });
    });
  }

  await run();
}

main();
