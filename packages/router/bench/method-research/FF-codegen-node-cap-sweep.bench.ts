/**
 * FF) The default node-cap is 256. BB showed routers with 100+ static
 * routes bail out (each route → multiple tree nodes once segments are
 * split). Probe how match latency changes with the codegen vs iterative
 * fallback path across realistic route counts.
 *
 * We can't easily lift the cap inline without modifying segment-compile,
 * so this bench focuses on confirming the iterative fallback path is the
 * one being taken for 100+ routes (already shown by EE — repeat for
 * fresh signal).
 */
import { run, bench, summary, do_not_optimize } from 'mitata';
import { Router } from '../../src/router';

async function main() {
  for (const n of [10, 50, 100, 200, 500, 1000] as const) {
    const r = new Router<string>();
    for (let i = 0; i < n; i++) r.add('GET', `/api/v1/route_${i}/sub`, `h${i}`);
    r.build();
    const probes = [`/api/v1/route_0/sub`, `/api/v1/route_${n - 1}/sub`];

    console.log(`\n=== ${n} routes (each /api/v1/route_*/sub — 4 segments) ===`);
    summary(() => {
      bench('match', () => {
        let s = 0;
        for (let i = 0; i < 1024; i++) {
          const m = r.match('GET', probes[i % probes.length]!);
          if (m !== null) s++;
        }
        do_not_optimize(s);
      });
    });
  }
  await run();
}

main();
