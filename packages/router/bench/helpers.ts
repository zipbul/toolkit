import { readFileSync } from 'node:fs';

export function gc(): void {
  if (typeof Bun !== 'undefined') {
    for (let i = 0; i < 5; i++) {
      Bun.gc(true);
    }
  }
}

export function settleScavenger(ms = 1500): void {
  if (typeof Bun !== 'undefined') {
    Bun.sleepSync(ms);
  }
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

export function printEnv(): void {
  const parts: string[] = [
    `bun=${typeof Bun !== 'undefined' ? Bun.version : 'n/a'}`,
    `node=${process.version}`,
    `platform=${process.platform}`,
    `arch=${process.arch}`,
  ];
  const tryRead = (path: string): string | null => {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  };
  const cpu = tryRead('/proc/cpuinfo');
  if (cpu !== null) {
    const model = cpu.match(/^model name\s*:\s*(.*)$/m)?.[1]?.trim();
    if (model !== undefined) {
      parts.push(`cpu=${JSON.stringify(model)}`);
    }
    const cores = cpu.match(/^processor\s*:/gm)?.length;
    if (cores !== undefined) {
      parts.push(`cores=${cores}`);
    }
  }
  const gov = tryRead('/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor')?.trim();
  if (gov !== undefined && gov !== null && gov !== '') {
    parts.push(`governor=${gov}`);
  }
  const kernel = tryRead('/proc/sys/kernel/osrelease')?.trim();
  if (kernel !== undefined && kernel !== null && kernel !== '') {
    parts.push(`kernel=${kernel}`);
  }
  const loadavg = tryRead('/proc/loadavg')?.trim().split(/\s+/).slice(0, 3).join(',');
  if (loadavg !== undefined && loadavg !== null && loadavg !== '') {
    parts.push(`loadavg=${loadavg}`);
  }
  const cgroup = tryRead('/proc/self/cgroup')?.trim().split('\n').pop();
  if (cgroup !== undefined && cgroup !== null && cgroup !== '') {
    parts.push(`cgroup=${JSON.stringify(cgroup)}`);
  }
  console.log(parts.join(' '));
}

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) {
    return Number.NaN;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx]!;
}

export function median(values: readonly number[]): number {
  return percentile(values, 50);
}
