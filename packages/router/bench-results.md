# Bench results — checked-in baseline

> [!IMPORTANT]
> **Bench infrastructure was overhauled** (RSS scavenger settle, multi-router
> fresh-process isolation, custom-bench percentile, env metadata). The
> numerical tables below were recorded under the **previous** harness; they
> remain useful as a directional sanity reference but should be re-measured
> end-to-end before the next release. See "Harness overhaul" section at
> the bottom for the structural changes.

Run `bun bench/regression-snapshot.ts` to reproduce. The numbers are a
sanity checkpoint, not a strict contract — they vary across runs because
of JIT/IC warmup and libpas scavenging. The bench reports min / median /
mean / p99 / stddev% across 11 trials so the noise floor is visible.

The **σ% column (relative stddev)** is the trust signal:

- **σ ≤ 10%** — measurement is stable; median is reliable.
- **σ 10-25%** — noise present; lean on `min` rather than `median`.
- **σ > 25%** — measurement is noise-dominated (typical for sub-10 ns
  ops where clock granularity rivals the work). Only `min` carries
  signal. The bench formatter flags these rows with `⚠`.

## Regression policy

| Bucket | Trust metric | Regression threshold |
|---|---|---|
| build/* (σ < 15% typical) | median | +20% from baseline |
| match cold (σ < 15% typical) | median | +20% from baseline |
| match hot (σ > 25% typical) | min | +30% from baseline |
| RSS delta | absolute value | +30 MB from baseline |

A breach should pause merge and either justify the new baseline (with a
commit message linking the change) or revert.

## Last recorded run

> [!CAUTION]
> **All numeric tables below are pre-overhaul** and were intentionally
> blanked to prevent stale citation. Run the new harness (see
> "Harness overhaul" section at the bottom) and re-record before quoting
> any number. The methodology / how-to-update sections remain accurate.

| Field | Value |
|---|---|
| Date | _stale — pending re-measurement_ |
| Bun | _stale_ |
| Platform | _stale_ |
| Trials per sample | _stale_ |

### Build time (router construction + seal + codegen + warmup)

_Stale — pending re-measurement under the new harness. Run
`bun bench/regression-snapshot.ts` and re-record._

### Match time

_Stale — pending re-measurement under the new harness. Run
`bun bench/regression-snapshot.ts` and re-record._

### RSS snapshot

_Stale — pending re-measurement under the new harness. The new
RSS measurement protocol settles the libpas scavenger for 1500 ms
before reading; pre-overhaul values cannot be compared directly._

## 100k routes baseline — zipbul vs memoirist (head-to-head)

_Stale — pending re-measurement under the new harness
(`bun bench/100k-external-baselines.ts`, RUNS=3 with median/P99).
The new harness spawns one fresh child per (adapter × scenario × run)
so cross-router RSS/JIT shared-cache contamination is eliminated;
pre-overhaul numbers cannot be compared directly._

## Cross-router comparison

_Stale — pending re-measurement under the new harness
(`bun bench/comparison.bench.ts` — orchestrator now spawns one fresh
child per adapter, so cross-router JIT-cache sharing no longer biases
the comparison). Re-run and re-record._

## How to update

1. Run `bun bench/regression-snapshot.ts > /tmp/snap.txt`.
2. Compare each line against the table above using the metric in the
   `Trust` column.
3. If a value breaches the regression threshold, investigate the cause
   before updating the baseline. Don't silently re-record.
4. Update the date + values in the table; keep the cross-router
   comparison aligned with the latest `comparison.bench.ts` output.

## Methodology notes

- `process.hrtime.bigint()` provides ns granularity; clock variance is
  ~50 ns on Linux x64 with the default scheduler. Sub-10 ns reported
  times are amortized across the 200k iters within a trial.
- `Bun.gc(true)` runs a synchronous full GC before each build sample so
  RSS measurements aren't contaminated by uncollected garbage from the
  prior sample.
- Warmup: 1000 iterations (or `iters` whichever is smaller) before
  trial recording. JSC's baseline-tier compile fires around iteration
  100; DFG fires later. The warmup overshoots both.
- 11 trials chosen so the median lands on a real sample (index 5, the
  middle of a sorted 11-array).

## Harness overhaul (structural changes — re-measurement pending)

The bench infrastructure was rebuilt for fairness and reproducibility.
Tables above were recorded under the previous harness; structural
changes below mean the next baseline refresh will land different
numbers even with no router code change.

**Measurement correctness fixes**:
- `bench/helpers.ts` extracted: single source of truth for `gc()` (5×
  pass), `settleScavenger()` (1500 ms `Bun.sleepSync` then gc — libpas
  decommit is asynchronous; without the wait, RSS deltas read 2-4×
  high), `mem()`, `fmtMem()`, `percentile()`, `median()`, `printEnv()`.
- `settleScavenger()` applied at every memory measurement boundary:
  `100k-verification.ts` between scenarios, `100k-bun-serve-baseline.ts`
  between prep/init/measure phases, `regression-snapshot.ts` before
  RSS-before reads (was previously `forceGc()`-only).
- `cache-cardinality.bench.ts` split into three monomorphic call sites:
  *cache-hit (warm, resident key)*, *cache-evict (new key, forces LRU)*,
  *miss path (no matching route)* — previously a single bench mixed all
  three costs together.

**Cross-router fairness — process isolation**:
- `comparison.bench.ts` and `complex-shapes.bench.ts` now use an
  orchestrator/worker split.
  Calling `bun bench/<file>.ts` (no argv) spawns one fresh child
  process per router/adapter; the child registers only that router with
  mitata. JIT code cache, structure cache, and RSS baseline are not
  shared between routers. Trade-off: mitata's cross-router summary
  (normalized comparisons, p-values) is sacrificed for true
  process-level isolation; compare via stdout raw values.
- `100k-external-baselines.ts` orchestrator runs **3 spawns per
  (adapter, scenario) pair** (32 pairs × 3 = 96 spawns total) and
  aggregates median / P99 over the three runs via the shared
  `percentile()` helper.

**Custom-bench percentile**:
- `100k-bun-serve-baseline.ts` runs the warm loop `WARM_RUNS = 3`
  times per path and reports median / P99 / min / max. The server is
  restarted between every cold measurement and between every warm run,
  so neither cold nor warm samples are contaminated by prior-state
  JIT/connection cache.
- `100k-verification.ts` standalone still emits a single sample per
  scenario; the recommended path for percentile output is
  `100k-gate-runner.ts`, which spawns `100k-verification.ts` three
  times per scenario in fresh processes and aggregates.

**Environment metadata for reproducibility**:
- Every bench prints a single-line `printEnv()` header at startup with
  `bun=<ver> node=<ver> platform=<os> arch=<cpu> cpu="<model>"
  cores=<n> governor=<gov> kernel=<ver> loadavg=<1m,5m,15m>
  cgroup="<path>"`. Reproductions across machines can now reconcile
  CPU model, frequency-scaling governor, and cgroup memory/CPU limits
  from stdout alone.

**Argv hygiene**:
- End users invoke every bench with no argv. The `argv` channel is
  retained only as worker-mode IPC for orchestrator self-spawn
  (`comparison*`, `complex-shapes`, `100k-external-baselines`) and for
  `100k-gate-runner.ts` → `100k-verification.ts` scenario dispatch.
  Previously-exposed flags (`--json-only`, `RUNS=` env, `COUNT=`
  argv) are removed.

**Deleted (obsolete probes)**: `bench/percent-gate.bench.ts` (URL
decode gate micro-tuning, never referenced), `bench/shape-creation.bench.ts`
(2023 JSC object-shape artefact).
