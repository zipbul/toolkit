/**
 * Shared bench measurement helpers.
 *
 * Bench scripts import from here so RSS/heap/env measurement stays
 * consistent. The settleScavenger contract is load-bearing: without it
 * RSS deltas read 2-4× high (libpas decommit is async after Bun.gc).
 */
import { readFileSync } from 'node:fs';

/** Five passes — JSC needs more than one cycle to clean post-build
 *  segment-tree shares; verified to drive heap 270→12 MiB on `100k param`. */
export function gc(): void {
  if (typeof Bun !== 'undefined') {
    for (let i = 0; i < 5; i++) Bun.gc(true);
  }
}

/** Synchronously wait for the libpas scavenger to decommit freed pages
 *  back to the OS. Bun.gc(true) drops the JSC heap; the scavenger only
 *  returns RSS asynchronously (~300 ms tick). 1.5 s settles every shape
 *  we measure. Sync via Bun.sleepSync so callers stay synchronous. */
export function settleScavenger(ms = 1500): void {
  if (typeof Bun !== 'undefined') Bun.sleepSync(ms);
  gc();
}

export function mem(): NodeJS.MemoryUsage {
  gc();
  return process.memoryUsage();
}

export function fmtMem(before: NodeJS.MemoryUsage, after: NodeJS.MemoryUsage): string {
  const rss = (after.rss - before.rss) / 1024 / 1024;
  const heap = (after.heapUsed - before.heapUsed) / 1024 / 1024;
  const arrayBuffers = (after.arrayBuffers - before.arrayBuffers) / 1024 / 1024;
  return `rss=${rss.toFixed(2)}MB heap=${heap.toFixed(2)}MB arrayBuffers=${arrayBuffers.toFixed(2)}MB`;
}

/** Single-line environment snapshot every bench script calls before the
 *  first measurement. Captures runtime + kernel + CPU + governor +
 *  cgroup + loadavg so stdout-only output reproduces across machines.
 *  Linux-only fields are skipped silently on other platforms. */
export function printEnv(): void {
  const parts: string[] = [
    `bun=${typeof Bun !== 'undefined' ? Bun.version : 'n/a'}`,
    `node=${process.version}`,
    `platform=${process.platform}`,
    `arch=${process.arch}`,
  ];
  const tryRead = (path: string): string | null => {
    try { return readFileSync(path, 'utf8'); } catch { return null; }
  };
  const cpu = tryRead('/proc/cpuinfo');
  if (cpu !== null) {
    const model = cpu.match(/^model name\s*:\s*(.*)$/m)?.[1]?.trim();
    if (model !== undefined) parts.push(`cpu=${JSON.stringify(model)}`);
    const cores = cpu.match(/^processor\s*:/gm)?.length;
    if (cores !== undefined) parts.push(`cores=${cores}`);
  }
  const gov = tryRead('/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor')?.trim();
  if (gov !== undefined && gov !== null && gov !== '') parts.push(`governor=${gov}`);
  const kernel = tryRead('/proc/sys/kernel/osrelease')?.trim();
  if (kernel !== undefined && kernel !== null && kernel !== '') parts.push(`kernel=${kernel}`);
  const loadavg = tryRead('/proc/loadavg')?.trim().split(/\s+/).slice(0, 3).join(',');
  if (loadavg !== undefined && loadavg !== null && loadavg !== '') parts.push(`loadavg=${loadavg}`);
  const cgroup = tryRead('/proc/self/cgroup')?.trim().split('\n').pop();
  if (cgroup !== undefined && cgroup !== null && cgroup !== '') parts.push(`cgroup=${JSON.stringify(cgroup)}`);
  console.log(parts.join(' '));
}

/** Nearest-rank percentile. Returns NaN on empty input.
 *  Caveat: with very small samples (n ≤ 4) p75 and p99 collapse to the max
 *  sample; callers reporting both as distinct columns should either raise
 *  the run count or drop the higher percentile from the output. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx]!;
}

export function median(values: readonly number[]): number {
  return percentile(values, 50);
}
