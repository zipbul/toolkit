/**
 * W) Profile insertIntoSegmentTree cost at scale. Build 1k/10k/100k
 * routes and measure (a) per-route insert time, (b) undo log growth,
 * (c) GC pressure.
 */

import { run, bench, summary, do_not_optimize } from 'mitata';

import { Router } from '../../src/router';

function genStaticRoutes(n: number): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let i = 0; i < n; i++) {
    out.push(['GET', `/users/${i}/orders/${i % 100}`]);
  }
  return out;
}

function genParamRoutes(n: number): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let i = 0; i < n; i++) {
    out.push(['GET', `/tenant-${i}/users/:id/orders/:oid`]);
  }
  return out;
}

async function main() {
  for (const n of [1_000, 10_000, 100_000] as const) {
    const sroutes = genStaticRoutes(n);
    const proutes = genParamRoutes(n);

    console.log(`\n=== ${n} routes ===`);
    summary(() => {
      bench(`static — add + build`, () => {
        const r = new Router<string>();
        for (const [m, p] of sroutes) r.add(m, p, 'h');
        r.build();
        do_not_optimize(r);
      });
      bench(`param — add + build`, () => {
        const r = new Router<string>();
        for (const [m, p] of proutes) r.add(m, p, 'h');
        r.build();
        do_not_optimize(r);
      });
    });
  }
  await run();
}

main();
