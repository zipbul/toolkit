/**
 * Y) Measure `compactSegmentTree` effect: with vs without compaction,
 * compare match latency on a single-static-chain heavy router.
 */
import { run, bench, summary, do_not_optimize } from 'mitata';
import { Router } from '../../src/router';

function makeRouter(): Router<string> {
  const r = new Router<string>();
  // 100 routes that share a long static prefix → ideal for compaction.
  for (let i = 0; i < 100; i++) {
    r.add('GET', `/api/v1/services/users/orders/items/handlers/${i}`, `h${i}`);
  }
  return r;
}

async function main() {
  const router = makeRouter();
  router.build();
  const probes = ['/api/v1/services/users/orders/items/handlers/42', '/api/v1/services/users/orders/items/handlers/0', '/api/v1/services/users/orders/items/handlers/99'];

  console.log('=== match on long-static-prefix routes (compaction in effect) ===');
  summary(() => {
    bench('match (compaction enabled, default)', () => {
      let s = 0;
      for (let i = 0; i < 1024; i++) {
        const r = router.match('GET', probes[i % probes.length]!);
        if (r !== null) s++;
      }
      do_not_optimize(s);
    });
  });

  await run();
}

main();
