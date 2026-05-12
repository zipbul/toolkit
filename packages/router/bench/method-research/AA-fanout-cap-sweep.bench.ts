/**
 * AA) MAX_FANOUT = 64 in segment-compile.ts. Probe at fanouts of
 * 16/32/64/128/256 to see whether codegen latency or runtime perf
 * justify the current cap.
 */
import { run, bench, summary, do_not_optimize } from 'mitata';
import { Router } from '../../src/router';
import { performance } from 'node:perf_hooks';

function makeFanoutRouter(fanout: number): Router<string> {
  const r = new Router<string>();
  for (let i = 0; i < fanout; i++) {
    r.add('GET', `/route_${i}`, `h${i}`);
  }
  return r;
}

async function main() {
  for (const fanout of [16, 32, 64, 128, 256] as const) {
    const t0 = performance.now();
    const r = makeFanoutRouter(fanout);
    r.build();
    const buildMs = performance.now() - t0;
    const probes: string[] = [];
    for (let i = 0; i < 10; i++) probes.push(`/route_${(i * fanout / 10) | 0}`);

    console.log(`\n=== fanout=${fanout} (build=${buildMs.toFixed(2)}ms) ===`);
    summary(() => {
      bench(`match`, () => {
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
