/**
 * EE) Compare match latency: codegen path vs iterative fallback. The
 * BB bench showed 100+ static routes BAIL out of codegen — quantify
 * whether the iterative fallback is meaningfully slower than
 * codegen would have been.
 */
import { run, bench, summary, do_not_optimize } from 'mitata';
import { Router } from '../../src/router';

function smallRouter(n: number): Router<string> {
  // Keep small enough to stay in codegen path.
  const r = new Router<string>();
  for (let i = 0; i < n; i++) r.add('GET', `/route_${i}`, `h${i}`);
  return r;
}

async function main() {
  for (const n of [10, 30, 50, 100, 200, 500] as const) {
    const router = smallRouter(n);
    router.build();
    const probes = ['/route_0', `/route_${(n / 2) | 0}`, `/route_${n - 1}`];
    console.log(`\n=== ${n} routes — match cost ===`);
    summary(() => {
      bench('match', () => {
        let s = 0;
        for (let i = 0; i < 1024; i++) {
          const m = router.match('GET', probes[i % probes.length]!);
          if (m !== null) s++;
        }
        do_not_optimize(s);
      });
    });
  }
  await run();
}

main();
