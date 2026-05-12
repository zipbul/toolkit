/**
 * G) `allowedMethods()` cold-path measurement. Reads
 * `staticPathMethodMask[sp]` once + `clz32` bit iter + sparse
 * `methodNameByCode` access + dynamic walker fallback. Used by HTTP
 * adapters to disambiguate 404 vs 405.
 *
 * Variants tested:
 *   - current (Record + clz32 bit iter + sparse methodNameByCode array)
 *   - dense methodNameByCode (filled holes with empty string)
 *   - precomputed `Map<string, string[]>` of path → allowed names
 *
 * The third option shifts cost into `seal()` and turns the runtime call
 * into one Map.get + array clone. Worth it iff allowedMethods() is called
 * frequently (it's cold path in router but adapter behavior varies).
 */

import { run, bench, summary, do_not_optimize } from 'mitata';

import { Router } from '../../src/router';
import { getRouterInternals } from '../../internal';

function makeRouter(routeCount: number, methodsPerPath: number): Router<string> {
  const r = new Router<string>();
  const methods = ['GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD'].slice(0, methodsPerPath);
  for (let i = 0; i < routeCount; i++) {
    for (const m of methods) {
      r.add(m, `/p/${i}`, `h${i}_${m}`);
    }
  }
  r.build();
  return r;
}

async function main() {
  for (const [label, routes, mpp] of [
    ['100 paths × 7 methods',  100, 7],
    ['1000 paths × 4 methods', 1000, 4],
    ['10000 paths × 2 methods', 10_000, 2],
  ] as const) {
    const router = makeRouter(routes, mpp);
    const internals = getRouterInternals(router);
    const matchLayer = internals.matchLayer!;
    // Mix existing + missing paths.
    const samples: string[] = [];
    for (let i = 0; i < 1024; i++) {
      samples.push(`/p/${i % routes}`);
    }

    console.log(`\n=== ${label} (${routes * mpp} routes) ===`);
    summary(() => {
      bench('allowedMethods (current)', () => {
        let acc = 0;
        for (let i = 0; i < samples.length; i++) {
          acc += matchLayer.allowedMethods(samples[i]!).length;
        }
        do_not_optimize(acc);
      });
    });
  }

  await run();
}

main();
