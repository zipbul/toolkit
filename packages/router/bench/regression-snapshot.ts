import { Router } from '../src/router';
import { gc as forceGc, settleScavenger as settleRss } from './helpers';

interface Sample {
  name: string;
  iters: number;
  trials: number;
  minNsPerOp: number;
  medianNsPerOp: number;
  meanNsPerOp: number;
  maxNsPerOp: number;
  stddevPct: number;
}

function nowNs(): bigint {
  return process.hrtime.bigint();
}

function timeIt(name: string, iters: number, fn: () => unknown): Sample {
  let checksum = 0;
  for (let i = 0; i < Math.min(iters, 1000); i++) {
    const r = fn();
    if (r !== null && r !== undefined) {
      checksum++;
    }
  }

  const TRIALS = 11;
  const samples: number[] = [];
  for (let t = 0; t < TRIALS; t++) {
    const start = nowNs();
    for (let i = 0; i < iters; i++) {
      const r = fn();
      if (r !== null && r !== undefined) {
        checksum++;
      }
    }
    const end = nowNs();
    samples.push(Number(end - start) / iters);
  }
  if (checksum < 0) {
    console.log(checksum);
  }
  samples.sort((a, b) => a - b);
  const min = samples[0]!;
  const median = samples[Math.floor(TRIALS / 2)]!;
  const max = samples[TRIALS - 1]!;
  const mean = samples.reduce((a, b) => a + b, 0) / TRIALS;
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
    maxNsPerOp: max,
    stddevPct,
  };
}

function rssMB(): number {
  return process.memoryUsage().rss / (1024 * 1024);
}

function buildStaticRouter(count: number): Router<string> {
  const r = new Router<string>();
  for (let i = 0; i < count; i++) {
    r.add('GET', `/static/${i}`, `s-${i}`);
  }
  r.build();
  return r;
}

function buildDynamicRouter(count: number): Router<string> {
  const r = new Router<string>();
  for (let i = 0; i < count; i++) {
    r.add('GET', `/api/v1/group-${i}/items/:id`, `d-${i}`);
  }
  r.build();
  return r;
}

function buildMixedRouter(count: number): Router<string> {
  const r = new Router<string>();
  for (let i = 0; i < count / 2; i++) {
    r.add('GET', `/static/${i}`, `s-${i}`);
  }
  for (let i = 0; i < count / 2; i++) {
    r.add('GET', `/api/v1/group-${i}/items/:id`, `d-${i}`);
  }
  r.build();
  return r;
}

function buildSamples(): Sample[] {
  const samples: Sample[] = [];

  for (const count of [10, 100, 1000, 10_000]) {
    const routes: Array<[string, string, string]> = [];
    for (let i = 0; i < count; i++) {
      routes.push(['GET', `/api/v1/group-${i}/items/:id`, `h-${i}`]);
    }

    forceGc();
    const iters = count <= 100 ? 50 : count <= 1000 ? 10 : 2;
    samples.push(
      timeIt(`build/${count}-dynamic-routes`, iters, () => {
        const r = new Router<string>();
        for (const [m, p, v] of routes) {
          r.add(m, p, v);
        }
        r.build();
        return r;
      }),
    );
  }

  return samples;
}

function matchSamples(): Sample[] {
  const samples: Sample[] = [];

  {
    const r = buildStaticRouter(100);
    samples.push(timeIt('match-hit/static', 200_000, () => r.match('GET', '/static/42')));
  }

  {
    const r = buildDynamicRouter(100);
    samples.push(timeIt('match-hit/dynamic-cache-warm', 200_000, () => r.match('GET', '/api/v1/group-42/items/9999')));
  }

  {
    const r = buildDynamicRouter(100);
    let n = 0;
    samples.push(timeIt('match-hit/dynamic-cache-cold', 100_000, () => r.match('GET', `/api/v1/group-42/items/${n++}`)));
  }

  {
    const r = buildMixedRouter(100);
    samples.push(timeIt('match-miss/unknown-path', 200_000, () => r.match('GET', '/no/such/route')));
  }

  {
    const r = buildMixedRouter(100);
    samples.push(timeIt('match-miss/wrong-method', 200_000, () => r.match('POST', '/static/42')));
  }

  return samples;
}

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
    settleRss();
    const before = rssMB();
    const r = builder();
    r.match('GET', '/api/v1/group-0/items/x');
    settleRss();
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

async function main(): Promise<void> {
  const out = {
    timestamp: new Date().toISOString(),
    bun: process.versions.bun,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    build: buildSamples(),
    match: matchSamples(),
    rss: rssSnaps(),
  };
  console.log(JSON.stringify(out, null, 2));
}

try {
  await main();
} catch (e) {
  console.error(e);
  process.exit(1);
}
