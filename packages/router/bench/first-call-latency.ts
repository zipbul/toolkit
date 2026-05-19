import { performance } from 'node:perf_hooks';

import { Router } from '../src/router';
import { percentile, printEnv } from './helpers';

type Shape = 'static-small' | 'static-large' | 'param-medium';

function makeRouter(shape: Shape): Router<number> {
  const r = new Router<number>();
  switch (shape) {
    case 'static-small':
      for (let i = 0; i < 10; i++) {
        r.add('GET', `/r${i}`, i);
      }
      break;
    case 'static-large':
      for (let i = 0; i < 1000; i++) {
        r.add('GET', `/api/v1/r${i}`, i);
      }
      break;
    case 'param-medium':
      for (let i = 0; i < 100; i++) {
        r.add('GET', `/t${i}/u/:id/p/:pid`, i);
      }
      break;
  }
  r.build();
  return r;
}

function pickHitPath(shape: Shape): string {
  switch (shape) {
    case 'static-small':
      return '/r0';
    case 'static-large':
      return '/api/v1/r0';
    case 'param-medium':
      return '/t0/u/42/p/7';
  }
}

function probe(shape: Shape, samples: number): { ns: number[]; checksum: number } {
  const ns: number[] = [];
  let checksum = 0;
  for (let s = 0; s < samples; s++) {
    const r = makeRouter(shape);
    const path = pickHitPath(shape);
    const t0 = performance.now();
    const out = r.match('GET', path);
    const dt = (performance.now() - t0) * 1e6;
    ns.push(dt);
    if (out !== null && out !== undefined) {
      checksum++;
    }
  }
  ns.sort((a, b) => a - b);
  return { ns, checksum };
}

function stats(ns: number[]): { p50: number; p99: number; mean: number; min: number; max: number } {
  const sum = ns.reduce((a, b) => a + b, 0);
  return {
    p50: percentile(ns, 50),
    p99: percentile(ns, 99),
    mean: sum / ns.length,
    min: ns[0]!,
    max: ns[ns.length - 1]!,
  };
}

printEnv();
const SAMPLES = 200;
console.log(`first-call latency (samples=${SAMPLES}) — ns`);
console.log(
  `${'shape'.padEnd(16)} ${'p50'.padStart(10)} ${'p99'.padStart(10)} ${'mean'.padStart(10)} ${'min'.padStart(10)} ${'max'.padStart(10)}`,
);
let totalChecksum = 0;
for (const shape of ['static-small', 'static-large', 'param-medium'] as const) {
  totalChecksum += probe(shape, 5).checksum;
  const { ns, checksum } = probe(shape, SAMPLES);
  totalChecksum += checksum;
  const s = stats(ns);
  console.log(
    `${shape.padEnd(16)} ${s.p50.toFixed(0).padStart(10)} ${s.p99.toFixed(0).padStart(10)} ${s.mean.toFixed(0).padStart(10)} ${s.min.toFixed(0).padStart(10)} ${s.max.toFixed(0).padStart(10)}`,
  );
}
if (totalChecksum < 0) {
  console.log(totalChecksum);
}
