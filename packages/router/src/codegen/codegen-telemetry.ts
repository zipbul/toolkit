/**
 * Codegen telemetry / feedback registry.
 *
 * Records observed compile time, source size, first-call (post-warmup)
 * latency, and generated-function counts per shape signature so subsequent
 * builds for the same shape can downgrade or skip codegen when prior
 * observations exceeded the budget.
 *
 * Shape signature is intentionally coarse (nodes, maxFanout, testers) so
 * different routers with structurally similar trees share a feedback row.
 */

interface ShapeTelemetry {
  shape: string;
  observedCompileMs: number;
  observedSourceBytes: number;
  observedFirstCallNs: number;
  generatedFunctionCount: number;
  bailReason: string | null;
  /**
   * Set true once an observation crossed the per-shape compile budget
   * (default 10 ms). Future builds with the same shape skip codegen and
   * fall back to the iterative walker so they do not pay the regression.
   */
  disabled: boolean;
}

export interface BuildAggregate {
  generatedFunctionCount: number;
  bailedFunctionCount: number;
  totalCompileMs: number;
  totalEmitMs: number;
  warmupCalls: number;
  warmupTotalNs: number;
}

const COMPILE_OBSERVED_HARD_MS = 10;

const shapeRegistry = new Map<string, ShapeTelemetry>();
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

export function shouldSkipCodegen(shape: string): boolean {
  const t = shapeRegistry.get(shape);
  return t !== undefined && t.disabled;
}

export function recordCompile(
  shape: string,
  compileMs: number,
  sourceBytes: number,
): void {
  const existing = shapeRegistry.get(shape);
  const disabled = compileMs > COMPILE_OBSERVED_HARD_MS;
  shapeRegistry.set(shape, {
    shape,
    observedCompileMs: compileMs,
    observedSourceBytes: sourceBytes,
    observedFirstCallNs: existing?.observedFirstCallNs ?? -1,
    generatedFunctionCount: (existing?.generatedFunctionCount ?? 0) + 1,
    bailReason: null,
    disabled: disabled || (existing?.disabled ?? false),
  });
  buildAggregate.generatedFunctionCount++;
  buildAggregate.totalCompileMs += compileMs;
}

export function recordBail(shape: string, reason: string): void {
  const existing = shapeRegistry.get(shape);
  shapeRegistry.set(shape, {
    shape,
    observedCompileMs: existing?.observedCompileMs ?? 0,
    observedSourceBytes: existing?.observedSourceBytes ?? 0,
    observedFirstCallNs: existing?.observedFirstCallNs ?? -1,
    generatedFunctionCount: existing?.generatedFunctionCount ?? 0,
    bailReason: reason,
    disabled: existing?.disabled ?? false,
  });
  buildAggregate.bailedFunctionCount++;
}

export function recordWarmupCall(shape: string, ns: number): void {
  const existing = shapeRegistry.get(shape);
  if (existing !== undefined) {
    if (existing.observedFirstCallNs < 0 || ns < existing.observedFirstCallNs) {
      existing.observedFirstCallNs = ns;
    }
  }
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

