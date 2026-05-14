/* eslint-disable no-console */
/**
 * Stage-wise build timing. The diagnostic surface was removed, so this
 * probe instruments build() externally by patching the relevant methods
 * via prototype monkey-patching for the duration of the run.
 */
import { performance } from 'node:perf_hooks';
import { Router } from '../src/router';
import { PathParser } from '../src/builder/path-parser';
import { WildcardPrefixIndex } from '../src/pipeline/wildcard-prefix-index';
import * as segTree from '../src/matcher/segment-tree';

const timings: Record<string, number> = {
  parse: 0, planAndCommit: 0, insertIntoSegmentTree: 0,
  detectTenantFactor: 0, compactSegmentTree: 0,
};

const origParse = PathParser.prototype.parse;
PathParser.prototype.parse = function (...args: any[]) {
  const t0 = performance.now();
  const r = (origParse as any).apply(this, args);
  timings.parse! += performance.now() - t0;
  return r;
};

const origPlan = WildcardPrefixIndex.prototype.planAndCommit;
WildcardPrefixIndex.prototype.planAndCommit = function (...args: any[]) {
  const t0 = performance.now();
  const r = (origPlan as any).apply(this, args);
  timings.planAndCommit! += performance.now() - t0;
  return r;
};

void segTree;

function bench(label: string, routes: Array<[string, string, number]>): void {
  for (const k in timings) timings[k] = 0;
  const t0 = performance.now();
  const r = new Router<number>();
  for (const [m, p, v] of routes) r.add(m, p, v);
  r.build();
  const total = performance.now() - t0;
  let accounted = 0;
  for (const k in timings) accounted += timings[k]!;
  const rest = total - timings.parse! - timings.planAndCommit!;
  console.log(`${label.padEnd(20)} total=${total.toFixed(0).padStart(4)}ms  parse=${timings.parse!.toFixed(0).padStart(4)} plan=${timings.planAndCommit!.toFixed(0).padStart(4)} rest(insert+factor+compact+snap+gc)=${rest.toFixed(0).padStart(4)}`);
  void accounted;
}

const N = 100_000;
const static100k: Array<[string, string, number]> = [];
for (let i = 0; i < N; i++) static100k.push(['GET', `/api/v1/resource-${i}`, i]);
const param100k: Array<[string, string, number]> = [];
for (let i = 0; i < N; i++) param100k.push(['GET', `/r${i}/users/:id/posts/:postId`, i]);
const tenant100k: Array<[string, string, number]> = [];
for (let i = 0; i < N; i++) tenant100k.push(['GET', `/tenant-${i}/users/:id/posts/:postId`, i]);

bench('static  100k', static100k);
bench('param   100k', param100k);
bench('tenant  100k', tenant100k);
