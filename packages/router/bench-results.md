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

## Cross-router comparison

`bun bench/comparison.bench.ts` — `mitata`-driven head-to-head against
memoirist, find-my-way, koa-tree-router, hono (Regexp + Trie), rou3.

Last recorded run (Bun 1.3.13, Linux x64, 23 scenarios). zipbul ns/iter
on the left; the right column lists the 1st-place router and its lead
over zipbul.

| Scenario | zipbul ns | 1st place | gap |
|:---|---:|:---|---:|
| static/hit-0 | 3.56 | **zipbul** | 1st |
| static/hit-1 | 6.27 | hono-regexp | 1.09× |
| static/hit-2 | 5.79 | **zipbul** | 1st |
| static/miss | 7.73 | **zipbul** | 1st |
| static/wrong-method | 5.22 | **zipbul** | 1st |
| param-1/hit | 14.35 | **zipbul** | 1st |
| param-1/miss | 27.28 | memoirist | 1.33× |
| param-1/wrong-method | 7.64 | **zipbul** | 1st |
| param-3/hit | 15.05 | **zipbul** | 1st |
| param-3/miss | 45.89 | memoirist | 1.17× |
| param-3/wrong-method | 9.43 | memoirist | 1.24× |
| wildcard/hit-0 | 15.01 | **zipbul** | 1st |
| wildcard/hit-1 | 14.86 | **zipbul** | 1st |
| wildcard/miss | 29.23 | hono-regexp | 1.11× |
| wildcard/wrong-method | 9.73 | koa-tree-router | 1.22× |
| github-static/hit | 9.42 | **zipbul** | 1st |
| github-static/miss | **90.73** | memoirist | **5.59×** ⚠ |
| github-static/wrong-method | 27.06 | memoirist | 1.47× |
| github-param/hit | 16.76 | **zipbul** | 1st |
| github-param/miss | 119.25 | memoirist | 2.44× |
| github-param/wrong-method | 35.42 | memoirist | 1.16× |
| miss/miss | 9.10 | **zipbul** | 1st |
| miss/wrong-method | 6.02 | memoirist | 1.09× |

**Counts**: 1st in 11 scenarios (every hit + 3 of 8 miss/wrong-method).
Hot-path = 1st on every `hit` scenario.

**Outlier — `github-static/miss`** (zipbul 90.73 ns vs memoirist 16.23 ns,
5.59× behind). Reproducible across runs; not measurement noise. The
65-route github-API route set hits a deep-trie miss case where
memoirist's structure short-circuits faster than zipbul's segment-tree
walker. Hot-path matches (hit scenarios) are unaffected. Investigate if
your workload runs heavy on miss probes against a deep route trie.

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
