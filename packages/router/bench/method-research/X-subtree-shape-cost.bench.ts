/**
 * X) `detectTenantFactor` calls `subtreeShape(child)` for every child
 * (1000+ tenants). subtreeShape recursively concatenates strings then
 * joins. Hypothesis: at 100k tenants the join cost is significant.
 */

import { run, bench, summary, do_not_optimize } from 'mitata';
import { Router } from '../../src/router';
import { detectTenantFactor } from '../../src/matcher/segment-tree';
import { getRouterInternals } from '../../internal';

function makeTenantRouter(n: number): Router<string> {
  const r = new Router<string>();
  for (let i = 0; i < n; i++) {
    r.add('GET', `/tenant-${i}/users/:id/orders/:oid`, `h${i}`);
  }
  return r;
}

async function main() {
  for (const n of [1_000, 10_000, 100_000]) {
    const router = makeTenantRouter(n);
    router.build();
    const internals = getRouterInternals(router);
    const root = (internals.registration as any).snapshot?.segmentTrees?.[0];
    if (!root) { console.error('no root'); continue; }

    console.log(`\n=== ${n} tenants — detectTenantFactor cold ===`);
    summary(() => {
      bench(`detectTenantFactor (cold)`, () => {
        do_not_optimize(detectTenantFactor(root, 100));
      });
    });
  }
  await run();
}

main();
