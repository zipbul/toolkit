/**
 * JSC IC tier-up warmup loop count. Bench `bench/method-research/
 * Z-warmup-iter-sweep.bench.ts` — 5/10/20/40/80 sweep on 10/50/200
 * route trees: median first-call latency plateaus at warmup=20 (the
 * 5/10 step gets within 1-2 ns, beyond 20 is noise). One source so
 * `segment-walk.ts` and `emitter.ts` can't drift.
 */
export const WARMUP_ITERATIONS = 20;
