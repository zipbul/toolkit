/**
 * Regression-snapshot bench. Captures the canonical match/build/RSS
 * surface that the enterprise checklist requires. Output is machine-
 * readable JSON + a human-readable markdown block to stdout.
 *
 * Usage:
 *   bun bench/regression-snapshot.ts                # human-readable + JSON
 *   bun bench/regression-snapshot.ts --json-only    # JSON only (for CI)
 *
 * The numbers don't claim absolute repeatability — JIT warmup, IC tier-up
 * and libpas scavenging vary across runs. They serve as a sanity
 * checkpoint: if a number moves by >20% from the recorded baseline in
 * bench-results.md, that's a regression worth investigating.
 */
import { Router } from '../src/router';

interface Sample {
  name: string;
  iters: number;
  trials: number;
  minNsPerOp: number;
  medianNsPerOp: number;
  meanNsPerOp: number;
  p99NsPerOp: number;
  stddevPct: number;
}

function nowNs(): bigint {
  return process.hrtime.bigint();
}

function timeIt(name: string, iters: number, fn: () => void): Sample {
  // Warmup pass.
  for (let i = 0; i < Math.min(iters, 1000); i++) fn();

  // 11 trials so the median lands on a real sample. min + p99 highlight
  // the noise floor / tail. stddevPct (relative to mean) is the noise
  // signal — anything > 10% means the measurement isn't stable enough
  // to feed a regression alarm; the formatter flags those rows with ⚠.
  const TRIALS = 11;
  const samples: number[] = [];
  for (let t = 0; t < TRIALS; t++) {
    const start = nowNs();
    for (let i = 0; i < iters; i++) fn();
    const end = nowNs();
    samples.push(Number(end - start) / iters);
  }
  samples.sort((a, b) => a - b);
  const min = samples[0]!;
  const median = samples[Math.floor(TRIALS / 2)]!;
  const p99Idx = Math.min(TRIALS - 1, Math.floor(TRIALS * 0.99));
  const p99 = samples[p99Idx]!;
  const mean = samples.reduce((a, b) => a + b, 0) / TRIALS;
  // Sample stddev (Bessel's correction). With TRIALS=11 the divisor is
  // 10 rather than 11; the resulting σ is ~5% larger than population σ.
  // Using sample σ because the 11 trials are observations of a wider
  // population (every JIT/IC state that could fire during a real run).
  const variance = samples.reduce((acc, s) => acc + (s - mean) ** 2, 0) / (TRIALS - 1);
  const stddev = Math.sqrt(variance);
  const stddevPct = (stddev / mean) * 100;

  return {
    name,
    iters,
    trials: TRIALS,
    minNsPerOp: min,
    medianNsPerOp: median,
    meanNsPerOp: mean,
    p99NsPerOp: p99,
    stddevPct,
  };
}

function rssMB(): number {
  return process.memoryUsage().rss / (1024 * 1024);
}

function forceGc(): void {
  if (typeof (globalThis as unknown as { Bun?: { gc?: (sync: boolean) => void } }).Bun?.gc === 'function') {
    (globalThis as unknown as { Bun: { gc: (sync: boolean) => void } }).Bun.gc(true);
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────

function buildStaticRouter(count: number): Router<string> {
  const r = new Router<string>();
  for (let i = 0; i < count; i++) r.add('GET', `/static/${i}`, `s-${i}`);
  r.build();
  return r;
}

function buildDynamicRouter(count: number): Router<string> {
  const r = new Router<string>();
  for (let i = 0; i < count; i++) r.add('GET', `/api/v1/group-${i}/items/:id`, `d-${i}`);
  r.build();
  return r;
}

function buildMixedRouter(count: number): Router<string> {
  const r = new Router<string>();
  for (let i = 0; i < count / 2; i++) r.add('GET', `/static/${i}`, `s-${i}`);
  for (let i = 0; i < count / 2; i++) r.add('GET', `/api/v1/group-${i}/items/:id`, `d-${i}`);
  r.build();
  return r;
}

// ── Build-time bench ──────────────────────────────────────────────────────

function buildSamples(): Sample[] {
  const samples: Sample[] = [];

  for (const count of [10, 100, 1000, 10_000]) {
    const routes: Array<[string, string, string]> = [];
    for (let i = 0; i < count; i++) routes.push(['GET', `/api/v1/group-${i}/items/:id`, `h-${i}`]);

    forceGc();
    const iters = count <= 100 ? 50 : count <= 1000 ? 10 : 2;
    samples.push(timeIt(`build/${count}-dynamic-routes`, iters, () => {
      const r = new Router<string>();
      for (const [m, p, v] of routes) r.add(m, p, v);
      r.build();
    }));
  }

  return samples;
}

// ── Match-time bench ──────────────────────────────────────────────────────

function matchSamples(): Sample[] {
  const samples: Sample[] = [];

  // hit/static — pre-built MatchOutput reuse path.
  {
    const r = buildStaticRouter(100);
    samples.push(timeIt('match-hit/static', 200_000, () => {
      r.match('GET', '/static/42');
    }));
  }

  // hit/dynamic (first call per URL == 'dynamic', then cached).
  {
    const r = buildDynamicRouter(100);
    samples.push(timeIt('match-hit/dynamic-cache-warm', 200_000, () => {
      r.match('GET', '/api/v1/group-42/items/9999');
    }));
  }

  // hit/dynamic-cold (rotating URLs, defeats the cache).
  {
    const r = buildDynamicRouter(100);
    let n = 0;
    samples.push(timeIt('match-hit/dynamic-cache-cold', 100_000, () => {
      r.match('GET', `/api/v1/group-42/items/${n++}`);
    }));
  }

  // miss/unknown-path.
  {
    const r = buildMixedRouter(100);
    samples.push(timeIt('match-miss/unknown-path', 200_000, () => {
      r.match('GET', '/no/such/route');
    }));
  }

  // miss/wrong-method.
  {
    const r = buildMixedRouter(100);
    samples.push(timeIt('match-miss/wrong-method', 200_000, () => {
      r.match('POST', '/static/42');
    }));
  }

  return samples;
}

// ── RSS snapshot ──────────────────────────────────────────────────────────

interface RssSnap {
  scenario: string;
  rssBeforeBuildMB: number;
  rssAfterBuildMB: number;
  deltaMB: number;
}

function rssSnaps(): RssSnap[] {
  const snaps: RssSnap[] = [];

  for (const [scenario, builder] of [
    ['static-1000', () => buildStaticRouter(1000)],
    ['dynamic-1000', () => buildDynamicRouter(1000)],
    ['mixed-10000', () => buildMixedRouter(10_000)],
  ] as const) {
    forceGc();
    const before = rssMB();
    const r = builder();
    // Touch it so JIT/codegen runs.
    r.match('GET', '/api/v1/group-0/items/x');
    forceGc();
    const after = rssMB();
    snaps.push({
      scenario,
      rssBeforeBuildMB: Number(before.toFixed(2)),
      rssAfterBuildMB: Number(after.toFixed(2)),
      deltaMB: Number((after - before).toFixed(2)),
    });
  }

  return snaps;
}

// ── Output ────────────────────────────────────────────────────────────────

function formatNs(ns: number): string {
  if (ns < 1000) return `${ns.toFixed(2)} ns`;
  if (ns < 1_000_000) return `${(ns / 1000).toFixed(2)} µs`;
  return `${(ns / 1_000_000).toFixed(2)} ms`;
}

function formatSample(s: Sample): string {
  const flag = s.stddevPct > 10 ? '⚠' : ' ';
  return `  ${s.name.padEnd(40)} min=${formatNs(s.minNsPerOp).padStart(9)} med=${formatNs(s.medianNsPerOp).padStart(9)} p99=${formatNs(s.p99NsPerOp).padStart(9)} σ=${s.stddevPct.toFixed(1).padStart(5)}% ${flag}`;
}

async function main(): Promise<void> {
  const jsonOnly = process.argv.includes('--json-only');
  const build = buildSamples();
  const match = matchSamples();
  const rss = rssSnaps();

  const out = {
    timestamp: new Date().toISOString(),
    bun: process.versions.bun,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    build,
    match,
    rss,
  };

  if (jsonOnly) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  console.log('=== zipbul/router regression snapshot ===');
  console.log(`bun=${out.bun} platform=${out.platform}/${out.arch}`);
  console.log('');
  console.log('## build-time');
  for (const s of build) console.log(formatSample(s));
  console.log('');
  console.log('## match-time');
  for (const s of match) console.log(formatSample(s));
  console.log('');
  console.log('## RSS snapshot (after build + first match)');
  for (const s of rss) {
    console.log(`  ${s.scenario.padEnd(20)} before=${s.rssBeforeBuildMB.toFixed(2).padStart(7)} MB  after=${s.rssAfterBuildMB.toFixed(2).padStart(7)} MB  Δ=${s.deltaMB.toFixed(2).padStart(7)} MB`);
  }
  console.log('');
  console.log('--- JSON ---');
  console.log(JSON.stringify(out));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
