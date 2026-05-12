/**
 * M) Production Router calls `optimizeNextInvocation(matchImpl)` after
 * codegen to force JSC tier-up. Measure the actual lookup cost AFTER
 * tier-up on the production code path — `methodCodes[method]` lookup
 * inside the emitted matchImpl.
 *
 * Variants:
 *   1. cold call (no tier-up applied)
 *   2. warmed (loop runs but no explicit tier-up hint)
 *   3. optimizeNextInvocation hinted
 */

import { optimizeNextInvocation, jscDescribe } from 'bun:jsc';
import { run, bench, summary, do_not_optimize } from 'mitata';

import { Router } from '../../src/router';

function makeRouter(): Router<string> {
  const r = new Router<string>();
  for (const m of ['GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD']) {
    for (let i = 0; i < 10; i++) r.add(m, `/p${i}`, `${m}-${i}`);
  }
  r.build();
  return r;
}

async function main() {
  // Variant 1 — cold
  const cold = makeRouter();
  const samples = ['/p0','/p1','/p2','/p3','/p4','/p5','/p6','/p7','/p8','/p9'];
  const methods = ['GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD'];

  console.log('=== Phase 1: warmed lookup (production path) ===');
  // Warm naturally.
  const warm = makeRouter();
  for (let i = 0; i < 5000; i++) {
    do_not_optimize(warm.match(methods[i % methods.length]!, samples[i % samples.length]!));
  }

  const N = 1024;
  summary(() => {
    bench('cold (no warmup)', () => {
      let acc = 0;
      for (let i = 0; i < N; i++) {
        const r = cold.match(methods[i % methods.length]!, samples[i % samples.length]!);
        if (r !== null) acc++;
      }
      do_not_optimize(acc);
    });
    bench('warmed (5000 prior calls)', () => {
      let acc = 0;
      for (let i = 0; i < N; i++) {
        const r = warm.match(methods[i % methods.length]!, samples[i % samples.length]!);
        if (r !== null) acc++;
      }
      do_not_optimize(acc);
    });
  });

  // Phase 2 — hidden class of methodCodes after JIT
  // (Production already calls optimizeNextInvocation on matchImpl.)
  // We can describe the methodCodes Record directly.
  console.log('\n=== Phase 2: production methodCodes hidden class ===');
  // Reach internals:
  const internals = (warm as any).constructor.name;
  console.log('router class:', internals);

  // Extract via the public allowedMethods path indirectly — register a
  // single method router and inspect the codeMap from the registry:
  console.log('(inspection requires internals access; see methodregistry-map-vs-record bench)');

  await run();
}

main();
