/* eslint-disable no-console */

import { spawnSync } from 'node:child_process';

type RunResult = {
  buildMs: number;
  rssMb: number;
  heapMb: number;
  arrayBuffersMb: number;
  firstNs: number[];
  hitNs: number[];
  missNs: number[];
};

const defaultScenarios = [
  '100k static',
  '100k param',
  '100k mixed',
  '100k high-fanout',
  '100k versioned-api',
  '100k wildcard-heavy',
  '100k regex-heavy',
  '100k churn',
];
const scenarios = process.argv.length > 2 ? process.argv.slice(2) : defaultScenarios;
const runs = Number(process.env.RUNS ?? '3');

function percentile(values: number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index]!;
}

function median(values: number[]): number {
  return percentile(values, 50);
}

function parseRun(stdout: string): RunResult {
  const build = stdout.match(/build=([0-9.]+)ms mem=rss=([0-9.-]+)MB heap=([0-9.-]+)MB arrayBuffers=([0-9.-]+)MB/);
  if (build === null) throw new Error(`failed to parse build line\n${stdout}`);

  const firstNs = [...stdout.matchAll(/^first .+? (\d+)ns$/gm)].map(match => Number(match[1]));
  const hitNs = [...stdout.matchAll(/^hit .+? ([0-9.]+) ns\/op checksum=/gm)].map(match => Number(match[1]));
  const missNs = [...stdout.matchAll(/^miss .+? ([0-9.]+) ns\/op checksum=/gm)].map(match => Number(match[1]));

  return {
    buildMs: Number(build[1]),
    rssMb: Number(build[2]),
    heapMb: Number(build[3]),
    arrayBuffersMb: Number(build[4]),
    firstNs,
    hitNs,
    missNs,
  };
}

function fmt(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : 'n/a';
}

for (const scenario of scenarios) {
  const results: RunResult[] = [];
  console.log(`\n## ${scenario}`);

  for (let i = 0; i < runs; i++) {
    const child = spawnSync(
      'bun',
      ['packages/router/bench/100k-verification.ts', scenario],
      { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 1024 * 1024 * 16 },
    );

    if (child.status !== 0) {
      console.error(child.stdout);
      console.error(child.stderr);
      throw new Error(`${scenario} run ${i + 1} failed with status ${child.status}`);
    }

    const parsed = parseRun(child.stdout);
    results.push(parsed);
    console.log(
      `run=${i + 1} build=${fmt(parsed.buildMs)}ms rss=${fmt(parsed.rssMb)}MB heap=${fmt(parsed.heapMb)}MB `
      + `firstMax=${fmt(Math.max(...parsed.firstNs), 0)}ns hitMax=${fmt(Math.max(...parsed.hitNs))}ns missMax=${fmt(Math.max(...parsed.missNs))}ns`,
    );
  }

  const builds = results.map(result => result.buildMs);
  const rss = results.map(result => result.rssMb);
  const heap = results.map(result => result.heapMb);
  const buffers = results.map(result => result.arrayBuffersMb);
  const first = results.flatMap(result => result.firstNs);
  const hits = results.flatMap(result => result.hitNs);
  const misses = results.flatMap(result => result.missNs);

  console.log(
    `summary scenario="${scenario}" runs=${runs} `
    + `buildMedian=${fmt(median(builds))}ms buildP75=${fmt(percentile(builds, 75))}ms buildP99=${fmt(percentile(builds, 99))}ms `
    + `rssMedian=${fmt(median(rss))}MB heapMedian=${fmt(median(heap))}MB arrayBuffersMedian=${fmt(median(buffers))}MB `
    + `firstMedian=${fmt(median(first), 0)}ns firstP75=${fmt(percentile(first, 75), 0)}ns firstP99=${fmt(percentile(first, 99), 0)}ns `
    + `hitMedian=${fmt(median(hits))}ns hitP75=${fmt(percentile(hits, 75))}ns hitP99=${fmt(percentile(hits, 99))}ns `
    + `missMedian=${fmt(median(misses))}ns missP75=${fmt(percentile(misses, 75))}ns missP99=${fmt(percentile(misses, 99))}ns`,
  );
}
