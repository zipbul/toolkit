/* eslint-disable no-console */
/**
 * Probe whether the 10-shape 120ns match cost is dominated by:
 *   (a) inner 10k staticChildren lookup (substring + obj.get)
 *   (b) iterative walker overhead (charCodeAt scan, paramOffsets writes)
 *   (c) un-factored inner subtree allocation pressure (cache misses)
 *
 * Measure: same 10-shape workload but with each prefix having 1k tenants
 * instead of 10k. If match cost scales linearly with tenant count, (a)
 * dominates and recursive factor would help. If flat, (b) dominates and
 * factor wouldn't help.
 */
import { performance } from 'node:perf_hooks';
import { Router, ROUTER_INTERNALS_KEY } from '../src/router';

function probe(label: string, total: number, perPrefix: number): void {
  const r = new Router<number>();
  const prefixes = ['users','api','files','teams','orgs','admin','blog','shop','docs','gigs'];
  for (let s = 0; s < prefixes.length; s++) {
    for (let i = 0; i < perPrefix; i++) r.add('GET', `/${prefixes[s]}/${i}/sub/:subId`, s * perPrefix + i);
  }
  r.build();

  const probes: string[] = [];
  for (let i = 0; i < 1000; i++) {
    const sIdx = i % prefixes.length;
    const tId = i % perPrefix;
    probes.push(`/${prefixes[sIdx]}/${tId}/sub/abc`);
  }

  // Warmup
  for (let w = 0; w < 200_000; w++) r.match('GET', probes[w % probes.length]!);

  const t0 = performance.now();
  for (let m = 0; m < 5_000_000; m++) r.match('GET', probes[m % probes.length]!);
  const ns = ((performance.now() - t0) * 1e6) / 5_000_000;
  console.log(`  ${label.padEnd(30)} total=${total}  perPrefix=${perPrefix}  match=${ns.toFixed(2)}ns`);

  // Walker tier introspection
  const internals = (r as any)[ROUTER_INTERNALS_KEY];
  void internals;
}

probe('10p × 100t = 1k', 1000, 100);
probe('10p × 1k t = 10k', 10_000, 1000);
probe('10p × 10k t = 100k', 100_000, 10_000);
probe('10p × 50k t = 500k', 500_000, 50_000);
