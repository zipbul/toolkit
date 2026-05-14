/* eslint-disable no-console */
/**
 * ULTIMATE.md §5.3 B re-verification on this codebase's actual SegmentNode
 * staticChildren shape. Compares Record<string,SegmentNode> vs Map at the
 * exact key counts the router produces.
 *
 * Workload: 100k tenant (single root.staticChildren with 100k SegmentNode children).
 */
import { performance } from 'node:perf_hooks';

interface FakeNode { id: number; staticChildren: Record<string, FakeNode> | null }

function bench(label: string, fn: () => unknown, iter: number): number {
  for (let i = 0; i < 200_000; i++) fn();
  const t0 = performance.now();
  for (let i = 0; i < iter; i++) fn();
  const ns = ((performance.now() - t0) * 1e6) / iter;
  console.log(`  ${label.padEnd(50)} ${ns.toFixed(2).padStart(7)} ns`);
  return ns;
}

function buildKeys(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(`r${i}`);
  return out;
}

function buildObj(keys: string[]): Record<string, FakeNode> {
  const o = Object.create(null) as Record<string, FakeNode>;
  for (let i = 0; i < keys.length; i++) o[keys[i]!] = { id: i, staticChildren: null };
  return o;
}

function buildMap(keys: string[]): Map<string, FakeNode> {
  const m = new Map<string, FakeNode>();
  for (let i = 0; i < keys.length; i++) m.set(keys[i]!, { id: i, staticChildren: null });
  return m;
}

for (const n of [100, 1000, 10_000, 100_000]) {
  console.log(`\n== ${n} keys ==`);
  const keys = buildKeys(n);
  const obj = buildObj(keys);
  const map = buildMap(keys);

  // Cycle through keys to defeat IC.
  const probes: string[] = [];
  for (let i = 0; i < 8192; i++) probes.push(keys[(i * 2654435761) >>> 0 % n]!);

  let i = 0;
  bench('object[k] lookup', () => obj[probes[(i++) & 8191]!], 5_000_000);
  let j = 0;
  bench('map.get(k)        ', () => map.get(probes[(j++) & 8191]!), 5_000_000);

  // Substring-based lookup (mirrors actual walker pattern).
  const url = '/' + keys[Math.floor(n / 2)]! + '/x';
  let k = 0;
  bench('obj[url.substring(1, end)]', () => {
    const u = url;
    let end = 1;
    while (end < u.length && u.charCodeAt(end) !== 47) end++;
    return obj[u.substring(1, end)];
  }, 5_000_000);
  let l = 0;
  bench('map.get(url.substring(1, end))', () => {
    const u = url;
    let end = 1;
    while (end < u.length && u.charCodeAt(end) !== 47) end++;
    return map.get(u.substring(1, end));
  }, 5_000_000);
  void j; void k; void l;
}
