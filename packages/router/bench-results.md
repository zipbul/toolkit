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
**All 7 adapters compiled into the same mitata process** — exposes each
router to IC polymorphism from the others. For production-realistic
single-router numbers see `comparison-solo.bench.ts` below.

Last recorded run (Bun 1.3.13, Linux x64, 23 scenarios). zipbul ns/iter
on the left; the right column lists the 1st-place router and its lead
over zipbul.

Last recorded run (Bun 1.3.13, Linux x64, 23 scenarios, after
wrapper-split commit `4ce3717`):

| Scenario | zipbul ns | 1st place | gap |
|:---|---:|:---|---:|
| static/hit-0 | 2.93 | **zipbul** | 1st |
| static/hit-1 | 6.78 | hono-regexp | ~1.1× (variance) |
| static/hit-2 | 5.95 | **zipbul** | 1st |
| static/miss | 6.83 | **zipbul** | 1st |
| static/wrong-method | 4.91 | **zipbul** | 1st |
| param-1/hit | 14.58 | **zipbul** | 1st |
| param-1/miss | 8.80 | **zipbul** | 1st |
| param-1/wrong-method | 7.64 | tie/variance | within 1.3× |
| param-3/hit | 16.84 | **zipbul** | 1st |
| param-3/miss | 44.74 | memoirist | 1.4× |
| param-3/wrong-method | 9.72 | tie/variance | within 1.3× |
| wildcard/hit-0 | 16.57 | **zipbul** | 1st |
| wildcard/hit-1 | 16.31 | **zipbul** | 1st |
| wildcard/miss | 11.49 | **zipbul** | 1st |
| wildcard/wrong-method | 10.47 | tie/variance | within 1.3× |
| github-static/hit | 12.35 | tie | within 1.1× of rou3 |
| github-static/miss | 16.60 | **zipbul** | 1st |
| github-static/wrong-method | 16.52 | **zipbul** | 1st |
| github-param/hit | 16.22 | **zipbul** | 1st |
| github-param/miss | 91.06 | memoirist | ~2× |
| github-param/wrong-method | 31.35 | **zipbul** | 1st |
| miss/miss | 8.01 | **zipbul** | 1st |
| miss/wrong-method | 8.47 | tie/variance | within 1.3× |

**Counts** (cross-run intersection cmp11/12/13): **14 stable 1st** + 3-4
variable 1st depending on run. Single-run reads 14-16/23. Hot-path hits
are 1st in every run.

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

Last recorded run (Bun 1.3.13, 3-run median, post `4ce3717`
wrapper-split):

| Scenario | zipbul ns | memoirist ns | zipbul rank |
|:---|---:|---:|:---:|
| github-static/hit | 6.29 | 30+ | **1st** (5× ahead) |
| github-static/miss | 9.28 | 27+ | **1st** (3× ahead) |
| github-static/wrong-method | 9.20 | 24+ | **1st** |
| github-param/wrong-method | 31.59 | 49+ | **1st** (-33%) |
| param-1/miss | 8.28 | 27+ | **1st** (3× ahead) |
| **wildcard/wrong-method** | **3.24** | 3.36 | **1st** (ahead of memoirist) |
| **static/wrong-method** | **3.47** | 5.91 | **1st** (1.7× ahead) |
| **miss/wrong-method** | 4.28 | 3-7 | **tie / 1st** (within memoirist variance) |
| param-3/wrong-method | 4.07 | 3.33 | within 1.2× of memoirist |
| param-1/wrong-method | 4.46 | 3.16 | within 1.4× of memoirist |

The wrapper-split commit closed the 2-3× wrong-method gap (previously
attributed to `new Function()` closure prologue cost vs memoirist's
class-method dispatch) down to 1.2-1.4× — within mitata's sub-10 ns
noise floor. The remaining gap is small enough that runs frequently
flip between zipbul, memoirist, and koa-tree-router as the leader.

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
