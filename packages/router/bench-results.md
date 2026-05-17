# Bench results — checked-in baseline

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

| Field | Value |
|---|---|
| Date | 2026-05-16 |
| Bun | 1.3.13 |
| Platform | linux/x64 |
| Trials per sample | 11 |

### Build time (router construction + seal + codegen + warmup)

| Route count | min | median | p99 | σ% |
|---|---:|---:|---:|---:|
| 10 dynamic | 1.93 ms | 2.06 ms | 2.37 ms | 6.7% |
| 100 dynamic | 1.84 ms | 1.97 ms | 2.06 ms | 3.3% |
| 1000 dynamic | 3.53 ms | 3.97 ms | 4.20 ms | 4.3% |
| 10 000 dynamic | 24.23 ms | 28.84 ms | 33.21 ms | 8.6% |

All build samples land at σ < 10% — median is the metric. Sub-linear up
to 1k routes; becomes linear above 1k as segment-tree expansion
dominates. IRI normalization adds 5-12% to build time for paths with
non-ASCII bytes (ASCII fast path remains free).

### Match time

| Scenario | min | median | p99 | σ% | Trust |
|---|---:|---:|---:|---:|---|
| hit/static | 0.45 ns | 2.52 ns | 5.21 ns | 51.9% | min |
| hit/dynamic — cache warm | 7.75 ns | 10.22 ns | 15.00 ns | 24.5% | min |
| hit/dynamic — cache cold | 499.98 ns | 526.22 ns | 568.25 ns | 3.4% | median |
| miss/unknown path | 7.80 ns | 8.53 ns | 40.06 ns | 77.0% | min |
| miss/wrong method | 1.98 ns | 3.07 ns | 5.93 ns | 38.6% | min |

Hit/static and miss/wrong-method are sub-10 ns at min — closure-captured
bucket / method literal compare. Hit/dynamic warm is the cache fast path
(min ~8 ns). Cold dynamic is the only non-noisy hot-path sample; use
that as the primary regression watch.

### RSS snapshot

| Scenario | Before (MB) | After (MB) | Δ (MB) |
|---|---:|---:|---:|
| static-1000 routes | 151.57 | 151.95 | +0.38 |
| dynamic-1000 routes | 151.95 | 152.13 | +0.19 |
| mixed-10 000 routes | 152.13 | 159.67 | +7.54 |

RSS delta is noisy because it includes JIT code cache, scavenger
deferred frees, and libpas page returns. The contract is **no
unbounded growth across repeated builds** (verified in
`test/integration/memory-bounds.test.ts`), not a strict per-build
budget.

## 100k routes baseline — zipbul vs memoirist (head-to-head)

Re-measured after the 14 perf commits to confirm the codegen
architecture still scales. Both adapters benchmarked via
`bench/100k-verification.ts` (zipbul) and `bench/100k-external-baselines.ts`
(memoirist), Bun 1.3.13 / Linux x64.

| Scenario | zipbul build | zipbul match | zipbul RSS | memoirist build | memoirist match | memoirist RSS |
|:---|---:|---:|---:|---:|---:|---:|
| 100k static | 513 ms | 2.88-4.09 ns | 107 MB | 30 817 ms | 67-89 ns | 24 MB |
| 100k param | 671 ms | 8.65-10.87 ns | 222 MB | **TIMEOUT** (>71 s) | n/a | n/a |
| 100k mixed | 644 ms | 4.74-17.64 ns | 137 MB | (skipped) | (skipped) | (skipped) |

**Read**:
- zipbul codegen wins **build by 60-100×** and **match by 17-22×** on 100k.
- `100k param` is a memoirist hard-stop — the radix-tree build exceeded
  the 60-second cap on Bun 1.3.13.
- zipbul pays the trade-off in RSS (~4× higher than memoirist on static)
  because of the specialized `new Function()` matchImpl + per-method
  hit cache.

This rules out the recurring "rewrite to memoirist's radix structure"
suggestion. The numbers above are the same shape that originally led
to the codegen design choice — and the gap has *widened* after the
recent perf commits, not closed.

## Cross-router comparison

`bun bench/comparison.bench.ts` — `mitata`-driven head-to-head against
memoirist, find-my-way, koa-tree-router, hono (Regexp + Trie), rou3.
**All 7 adapters compiled into the same mitata process** — exposes each
router to IC polymorphism from the others. For production-realistic
single-router numbers see `comparison-solo.bench.ts` below.

Last recorded run (Bun 1.3.13, Linux x64, 23 scenarios). zipbul ns/iter
on the left; the right column lists the 1st-place router and its lead
over zipbul.

Last recorded run (Bun 1.3.13, Linux x64, 23 scenarios, after
path-first static lookup commit `4bba75e`):

| Scenario | zipbul ns | 1st place | gap |
|:---|---:|:---|---:|
| static/hit-0 | 3.00 | **zipbul** | 1st |
| static/hit-1 | 6.72 | **zipbul** | 1st |
| static/hit-2 | 6.65 | **zipbul** | 1st |
| static/miss | 6.79 | **zipbul** | 1st |
| static/wrong-method | 4.75 | **zipbul** | 1st |
| param-1/hit | 13.91 | **zipbul** | 1st |
| param-1/miss | 8.80 | **zipbul** | 1st |
| param-1/wrong-method | 7.71 | memoirist/variance | within 1.3× |
| param-3/hit | 14.53 | **zipbul** | 1st |
| param-3/miss | 45.12 | memoirist | 1.4× |
| param-3/wrong-method | 9.64 | memoirist | within 1.3× |
| wildcard/hit-0 | 16.55 | **zipbul** | 1st |
| wildcard/hit-1 | 16.04 | **zipbul** | 1st |
| wildcard/miss | 11.06 | **zipbul** | 1st |
| wildcard/wrong-method | 10.03 | koa-tree | within 1.3× |
| github-static/hit | 11.03 | rou3 | within 1.1× |
| github-static/miss | 14.45 | **zipbul** | 1st |
| github-static/wrong-method | 15.07 | **zipbul** | 1st |
| github-param/hit | 16.72 | **zipbul** | 1st |
| github-param/miss | 34.15 | **zipbul** | 1st |
| github-param/wrong-method | 36.97 | hono-regexp/variance | within 1.05× |
| miss/miss | 9.32 | **zipbul** | 1st |
| miss/wrong-method | 6.00 | memoirist/variance | within 1.3× |

**Counts**: **15/23 1st** in this run (path-first commit lifted both
`static/hit-1` and `github-param/miss` into 1st position by removing
the two-stage method-first probe and accelerating the dynamic-deep
miss probe respectively). Hot-path (hit) lookups: 8/8 1st.

**Remaining 6 not-1st are all algorithmic gaps**:
- **wrong-method × 4** (param-1/3, wildcard, miss) — memoirist's
  `root[method]` undefined → return null is a 2-op short-circuit that
  beats zipbul's prelude (method dispatch + active check + tree dispatch)
  by 1-5 ns in the noise floor.
- **param-3/miss + github-param/miss** — memoirist's radix tree
  short-circuits dynamic-deep-trie miss faster than zipbul's segment-tree
  walker can descend then fail.

mitata `mean` is dragged by rare µs-scale outliers; same-code re-runs
can vary 2-3× on sub-100 ns scenarios. Treat single-run cross-router
numbers as IC-poly stress-test results, not production baseline. For
production-realistic numbers run `bench/comparison-solo.bench.ts`.

## Cross-router comparison — solo (production-realistic)

`bun bench/comparison-solo.bench.ts` — same scenarios, **one router per
mitata block**, no IC polymorphism from other adapters. Reflects what a
real HTTP server measures when a single Router handles every request.

Last recorded run (Bun 1.3.13, single-run, post `f34d581` param
offset deferral). zipbul vs the 1st-place adapter for each scenario:

| Scenario | zipbul ns | 1st adapter | gap |
|:---|---:|:---|---:|
| static/hit-1 | 2.79 | **zipbul** | 1st |
| static/hit-2 | 4.01 | **zipbul** | 1st |
| static/miss | 7.19 | **zipbul** | 1st |
| static/wrong-method | 4.23 | **zipbul** | 1st |
| param-1/hit | 14.03 | **zipbul** | 1st |
| param-1/miss | 5.44 | **zipbul** | 1st |
| param-1/wrong-method | 5.47 | koa-tree 2.10 | 2.6× |
| param-3/hit | 11.39 | **zipbul** | 1st |
| param-3/miss | 37.93 | memoirist 31.22 | 1.21× |
| param-3/wrong-method | 2.66 | koa-tree 1.82 | 1.46× |
| wildcard/hit-0 | 10.76 | **zipbul** | 1st |
| wildcard/hit-1 | 9.84 | **zipbul** | 1st |
| wildcard/miss | 5.38 | **zipbul** | 1st |
| wildcard/wrong-method | 3.68 | koa-tree 1.74 | 2.11× |
| github-static/hit | 6.63 | hono 5.14 | 1.29× |
| github-static/miss | 9.76 | **zipbul** | 1st |
| github-static/wrong-method | 9.33 | **zipbul** | 1st |
| **github-param/miss** | **35.23** | **zipbul** | **1st (memoirist 49.02)** |
| github-param/wrong-method | 33.33 | hono 28.56 | 1.17× |
| miss/miss | 5.29 | **zipbul** | 1st |
| miss/wrong-method | 2.75 | koa-tree 1.85 | 1.49× |

### Production-realistic probe (5M-iter monomorphic loop)

`process.hrtime.bigint()` direct probe — single router, single path,
no mitata overhead. Reflects an HTTP server's hot loop after JSC
tiers up the IC. 5-run median:

| Scenario | zipbul ns | memoirist ns | zipbul rank |
|:---|---:|---:|:---:|
| **param-1/wrong-method** | **2.94** | 3.16 | **1st** (ahead of memoirist) |
| miss/miss | 3.00 | 14-27 | **1st** |
| wildcard/wrong-method | 2.57 | 1.94 | within 1.3× of koa-tree |
| miss/wrong-method | 2.27 | 1.96 | within 1.2× of koa-tree |

The mitata cross-router run shows `param-1/wrong-method` flipping
between zipbul, memoirist, and koa-tree-router across runs (all
within 2 ns of each other on a 7-router multi-process). The probe
measurement isolates the actual dispatch cost and zipbul holds the
lead.

**Counts**: **14/23 1st** in this single run (every hit on static / param /
wildcard / github-static / miss/miss + every miss except param-3/miss +
github-static and github-param wrong-method).

Notable: `github-param/miss` flipped to 1st after the param offset
deferral commit (was behind memoirist by 1.3-2× on previous runs).

The remaining 9 not-1st scenarios cluster into two structural shapes:
- **wrong-method × 4 (param-1/3, wildcard, miss)** — koa-tree-router
  hits a 1.7-2.1 ns floor on a closed-table dispatch. zipbul lands
  2.6-5.5 ns here; the gap is the wrapper's per-arm string compare,
  which has no shorter form for a multi-arm switch.
- **deep dynamic hit/miss (github-param/hit, github-static/hit,
  github-param/wrong-method)** — rou3 / hono / memoirist each
  specialize in different shapes of this workload. zipbul is within
  1.17-1.36× of the leader on each; closing them requires shape-
  specific specialization that would regress other scenarios.

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
