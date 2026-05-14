/* eslint-disable no-console */
/**
 * Full matrix: M routes × N optional (1..6).
 * Measures settled RSS to determine optimal cap K.
 */
import { Router } from '../src/router';

function rss(): number { return process.memoryUsage().rss / 1024 / 1024; }
async function settle(ms: number): Promise<void> {
  if (typeof Bun !== 'undefined') Bun.gc(true);
  await new Promise(r => setTimeout(r, ms));
  if (typeof Bun !== 'undefined') Bun.gc(true);
}

// Temporarily bypass cap by calling expandOptional directly is invasive.
// Instead, modify build to skip cap by removing the gate.
// For this matrix, we patch the Router import path. Simpler: import
// the cap constant and its enforcement is in registration. Skip by
// using a custom registration that bypasses. Or read MAX from source.
// For pure measurement, we just probe N=1..4 (within current cap), and
// for N=5, 6 we modify cap temporarily.

// Direct approach: import MAX, override at runtime to a high value.
// MAX_OPTIONAL_SEGMENTS_PER_ROUTE is `const`, can't reassign.
// → Run two passes: first under N≤4, then patch source to N≤16, run again.
// For now, just measure N=1..4 (and report N=5-6 is reject by cap).

const Ms = [1000, 10_000, 100_000];
const Ns = [1, 2, 3, 4, 5, 6];

console.log('=== Full matrix: M routes × N optional (settled RSS) ===');
console.log('M | N | variants/route | total | RSS settled | KB/route | per variant byte');
for (const N of Ns) {
  for (const M of Ms) {
    await settle(500);
    const r0 = rss();
    const r = new Router<number>();
    try {
      for (let i = 0; i < M; i++) {
        const segs = Array.from({length: N}, (_, j) => `s${j}_${i}/:p${j}_${i}?`).join('/');
        r.add('GET', `/r${i}/${segs}`, i);
      }
      r.build();
      await settle(2500);
      const used = rss() - r0;
      const totalVar = M * (1 << N);
      const kbPerRoute = (used * 1024) / M;
      const bytePerVar = (used * 1024 * 1024) / totalVar;
      console.log(`${M.toString().padStart(6)} | ${N} | ${1<<N} | ${totalVar.toString().padStart(8)} | +${used.toFixed(1).padStart(6)}MB | ${kbPerRoute.toFixed(2)}KB | ${bytePerVar.toFixed(1)}B`);
    } catch (e: any) {
      console.log(`${M.toString().padStart(6)} | ${N} | - | - | ERROR: ${e.message?.slice(0, 60)}`);
    }
  }
}

console.log('\n=== Match perf (random hit on /r0/...) ===');
for (const N of Ns) {
  await settle(500);
  const M = 10_000;
  const r = new Router<number>();
  for (let i = 0; i < M; i++) {
    const segs = Array.from({length: N}, (_, j) => `s${j}_${i}/:p${j}_${i}?`).join('/');
    r.add('GET', `/r${i}/${segs}`, i);
  }
  r.build();
  const probes: string[] = [];
  for (let i = 0; i < 100; i++) {
    const segs = Array.from({length: N}, (_, j) => `s${j}_${i}/v${j}`).join('/');
    probes.push(`/r${i}/${segs}`);
  }
  for (let w = 0; w < 200_000; w++) r.match('GET', probes[w % 100]!);
  const t0 = performance.now();
  for (let m = 0; m < 5_000_000; m++) r.match('GET', probes[m % 100]!);
  const ns = ((performance.now() - t0) * 1e6) / 5_000_000;
  console.log(`N=${N}: match=${ns.toFixed(2)}ns`);
}
