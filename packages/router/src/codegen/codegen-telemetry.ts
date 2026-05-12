/**
 * Codegen telemetry — per-build aggregate counters surfaced through
 * `internals.codegenAggregate` for regression / diagnostic tooling.
 *
 * The earlier `shapeRegistry` (per-shape ShapeTelemetry rows: compile
 * time, source bytes, first-call latency, bail reason) was write-only —
 * `recordCompile` / `recordBail` / `recordWarmupCall` populated it but
 * no production caller ever read it back, and the per-shape disable
 * feedback that consumed it was retired (`COMPILE_OBSERVED_HARD_MS`
 * proved unreachable under the existing `MAX_NODES_DEFAULT = 256` cap;
 * see `bench/method-research/GG-compile-time-large-trees.bench.ts`,
 * p99 ≤ 4.33 ms). The Map and its row interface are gone; only the
 * `BuildAggregate` rollup that the diagnostic hatch actually exposes
 * is kept.
 */

/**
 * JSC IC tier-up warmup loop count. Bench `bench/method-research/
 * Z-warmup-iter-sweep.bench.ts` — 5/10/20/40/80 sweep on 10/50/200
 * route trees: median first-call latency plateaus at warmup=20 (the
 * 5/10 step gets within 1-2 ns, beyond 20 is noise). One source so
 * `segment-walk.ts` and `emitter.ts` can't drift.
 */
export const WARMUP_ITERATIONS = 20;

export interface BuildAggregate {
  generatedFunctionCount: number;
  bailedFunctionCount: number;
  totalCompileMs: number;
  totalEmitMs: number;
  warmupCalls: number;
  warmupTotalNs: number;
}

let buildAggregate: BuildAggregate = freshBuildAggregate();

function freshBuildAggregate(): BuildAggregate {
  return {
    generatedFunctionCount: 0,
    bailedFunctionCount: 0,
    totalCompileMs: 0,
    totalEmitMs: 0,
    warmupCalls: 0,
    warmupTotalNs: 0,
  };
}

export function shapeSignature(nodes: number, maxFanout: number, testers: number): string {
  return `n=${nodes}|f=${maxFanout}|t=${testers}`;
}

export function recordCompile(_shape: string, compileMs: number, _sourceBytes: number): void {
  buildAggregate.generatedFunctionCount++;
  buildAggregate.totalCompileMs += compileMs;
}

export function recordBail(_shape: string, _reason: string): void {
  buildAggregate.bailedFunctionCount++;
}

export function recordWarmupCall(_shape: string, ns: number): void {
  buildAggregate.warmupCalls++;
  buildAggregate.warmupTotalNs += ns;
}

export function recordEmitMs(ms: number): void {
  buildAggregate.totalEmitMs += ms;
}

export function snapshotBuildAggregate(): BuildAggregate {
  return { ...buildAggregate };
}

export function resetBuildAggregate(): void {
  buildAggregate = freshBuildAggregate();
}

