/* eslint-disable no-console */
/**
 * Measure the three unmeasured codegen caps:
 *   #1  MAX_FANOUT=64                 (segment-compile.ts)
 *   #2  entries.length > 8 wildcard   (segment-walk.ts)
 *   #3  collectWarmupPaths max = 8    (segment-compile.ts)
 *
 * Each probe builds a router shape designed to fall on opposite sides of
 * the cap, then records first-call latency + steady-state match latency.
 * The bench is then re-run after the relevant cap is loosened by hand;
 * comparing the two numbers shows whether the cap protects something
 * real or is dead weight.
 */
import { performance } from 'node:perf_hooks';
import { Router } from '../src/router';

type Probe = {
  name: string;
  fanout: number;
  routes: () => Array<[string, string, number]>;
  hit: string;
};

const SAMPLES_BUILD = 50;
const SAMPLES_FIRST_CALL = 200;
const ITER_STEADY = 200_000;

function buildProbeRouter(routes: Array<[string, string, number]>): { router: Router<number>; buildMs: number } {
  const r = new Router<number>();
  for (const [m, p, v] of routes) r.add(m, p, v);
  const t0 = performance.now();
  r.build();
  const buildMs = performance.now() - t0;
  return { router: r, buildMs };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

function p99(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length * 0.99)]!;
}

function measure(probe: Probe): void {
  const buildSamples: number[] = [];
  const firstCallSamples: number[] = [];
  let steadyNs = 0;

  for (let i = 0; i < SAMPLES_BUILD; i++) {
    const { buildMs } = buildProbeRouter(probe.routes());
    buildSamples.push(buildMs);
  }

  for (let i = 0; i < SAMPLES_FIRST_CALL; i++) {
    const { router } = buildProbeRouter(probe.routes());
    const t0 = performance.now();
    router.match('GET', probe.hit);
    const dt = (performance.now() - t0) * 1e6;
    firstCallSamples.push(dt);
  }

  const { router } = buildProbeRouter(probe.routes());
  // warmup steady-state
  for (let i = 0; i < 50_000; i++) router.match('GET', probe.hit);
  const t0 = performance.now();
  for (let i = 0; i < ITER_STEADY; i++) router.match('GET', probe.hit);
  steadyNs = ((performance.now() - t0) * 1e6) / ITER_STEADY;

  console.log(
    `${probe.name.padEnd(28)} build=${median(buildSamples).toFixed(2).padStart(6)}ms ` +
    `first-call p50=${median(firstCallSamples).toFixed(0).padStart(7)}ns ` +
    `p99=${p99(firstCallSamples).toFixed(0).padStart(7)}ns ` +
    `steady=${steadyNs.toFixed(1).padStart(6)}ns`,
  );
}

// #1 fanout caps — width N static children at root
function fanoutProbe(n: number): Probe {
  return {
    name: `#1 fanout-${n}`,
    fanout: n,
    routes: () => {
      const rs: Array<[string, string, number]> = [];
      for (let i = 0; i < n; i++) rs.push(['GET', `/r${i}`, i]);
      return rs;
    },
    hit: `/r${Math.floor(n / 2)}`,
  };
}

// #2 wildcard-entries — N static-prefix wildcard routes
function wildEntriesProbe(n: number): Probe {
  return {
    name: `#2 wild-entries-${n}`,
    fanout: 0,
    routes: () => {
      const rs: Array<[string, string, number]> = [];
      for (let i = 0; i < n; i++) rs.push(['GET', `/p${i}/*rest`, i]);
      return rs;
    },
    hit: `/p${Math.floor(n / 2)}/a/b/c`,
  };
}

// #3 collectWarmupPaths breadth — direct children at root
function warmupBreadthProbe(n: number): Probe {
  return {
    name: `#3 warmup-breadth-${n}`,
    fanout: 0,
    routes: () => {
      const rs: Array<[string, string, number]> = [];
      for (let i = 0; i < n; i++) rs.push(['GET', `/c${i}/inner`, i]);
      return rs;
    },
    hit: `/c${Math.floor(n / 2)}/inner`,
  };
}

console.log('codegen-cap probes — fixed RNG, fixed iter counts');
console.log(`build samples=${SAMPLES_BUILD}, first-call samples=${SAMPLES_FIRST_CALL}, steady iter=${ITER_STEADY}`);

console.log('\n## #1 MAX_FANOUT — fanouts (incl. extreme)');
for (const n of [10, 64, 128, 256, 500, 1000, 5000]) measure(fanoutProbe(n));

console.log('\n## #2 wildcard entries — counts (incl. extreme)');
for (const n of [4, 8, 32, 64, 128, 256, 512]) measure(wildEntriesProbe(n));

console.log('\n## #3 collectWarmupPaths breadth — counts (incl. extreme)');
for (const n of [4, 8, 32, 64, 128, 256]) measure(warmupBreadthProbe(n));
