# Bench results

> Recorded with `bun bench/regression-snapshot.ts` and
> `bun bench/comparison.bench.ts`. The cross-router orchestrator spawns
> one fresh child process per `(adapter × scenario)` pair so JIT, IC, and
> RSS state are isolated across measurements.

| Field    | Value                                                                               |
| -------- | ----------------------------------------------------------------------------------- |
| Runtime  | `bun 1.3.13` (`node 24.3.0`)                                                        |
| Platform | Linux x64                                                                           |
| CPU      | 13th Gen Intel Core i7-13700K                                                       |
| Adapters | find-my-way 9, memoirist 0.4, rou3 0.7, hono 4.12, koa-tree-router 0.13, radix3 1.1 |

## Self-bench (build / match / RSS)

`bun bench/regression-snapshot.ts` — 11 trials per row, `σ` is relative
stddev. **min** is the trust signal: σ above ~10 % means clock-granularity
or libpas noise dominates, lean on `min`.

### `build()`

| Routes |   median |      min |      max |     σ |
| -----: | -------: | -------: | -------: | ----: |
|     10 |  2.28 ms |  2.10 ms |  3.33 ms | 17.3% |
|    100 |  2.51 ms |  2.37 ms |  3.16 ms |  9.8% |
|  1 000 |  4.58 ms |  4.20 ms |  5.12 ms |  6.0% |
| 10 000 | 27.62 ms | 25.77 ms | 29.85 ms |  4.9% |

### `match()`

| Scenario                  |    median |       min |       max |     σ |
| ------------------------- | --------: | --------: | --------: | ----: |
| hit / static              |   3.64 ns |   0.33 ns |   7.49 ns | 70.1% |
| hit / dynamic, warm cache |   9.06 ns |   8.01 ns |  18.99 ns | 32.4% |
| hit / dynamic, cache-cold | 597.84 ns | 552.25 ns | 668.91 ns |  5.5% |
| miss / unknown path       |   3.01 ns |   0.36 ns |   9.27 ns | 62.4% |
| miss / wrong method       |   2.64 ns |   2.13 ns |   5.87 ns | 37.8% |

Static-hit and unknown-path entries report `min` near JSC's monomorphic
inline ceiling — at that grain mitata's `do_not_optimize` cannot fully
defeat JIT folding, so `median` carries the real signal.

### RSS after `build()`

| Scenario      |   before |    after |       Δ |
| ------------- | -------: | -------: | ------: |
| static 1 000  | 64.88 MB | 65.12 MB | 0.25 MB |
| dynamic 1 000 | 63.30 MB | 63.63 MB | 0.33 MB |
| mixed 10 000  | 63.36 MB | 68.52 MB | 5.16 MB |

## Cross-router comparison

`bun bench/comparison.bench.ts` — every `(adapter × scenario)` pair runs
in a fresh child process; each table lists `avg` ns/op of the first hit
sample (ordered fastest first).

### Static (100 routes)

| Adapter         | avg ns | p75 ns |
| --------------- | -----: | -----: |
| zipbul          |   2.98 |   3.47 |
| hono-regexp     |   4.09 |   5.51 |
| rou3            |   5.59 |   7.58 |
| memoirist       |  39.29 |  48.25 |
| koa-tree-router |  40.82 |  50.16 |
| find-my-way     |  96.54 | 107.80 |
| hono-trie       | 145.48 | 165.71 |

### Single param (`/users/:id`)

| Adapter         | avg ns | p75 ns |
| --------------- | -----: | -----: |
| zipbul          |  12.15 |  11.64 |
| memoirist       |  40.03 |  45.99 |
| rou3            |  50.81 |  52.86 |
| hono-regexp     | 106.42 | 123.52 |
| koa-tree-router | 118.48 | 134.15 |
| find-my-way     | 119.07 | 133.82 |
| hono-trie       | 236.57 | 296.23 |

### 3-deep params (`/repos/:owner/:repo/issues/:number`)

| Adapter         | avg ns | p75 ns |
| --------------- | -----: | -----: |
| zipbul          |  11.74 |  12.63 |
| rou3            |  70.28 |  68.01 |
| memoirist       |  79.89 |  76.46 |
| hono-regexp     | 113.92 | 137.83 |
| find-my-way     | 198.73 | 241.06 |
| koa-tree-router | 282.38 | 305.90 |
| hono-trie       | 336.79 | 355.06 |

### Wildcard (`/static/*path`, deep tail)

| Adapter         | avg ns | p75 ns |
| --------------- | -----: | -----: |
| zipbul          |  11.52 |  10.02 |
| hono-regexp     |  67.31 |  69.76 |
| find-my-way     |  73.45 |  78.34 |
| rou3            | 101.79 | 107.50 |
| hono-trie       | 132.73 | 114.95 |
| koa-tree-router | 136.98 | 151.40 |

memoirist is excluded by the sanity gate on this scenario (wildcard hit
returns null).

### GitHub-realistic — static endpoint (65-route fixture, `/user`)

| Adapter         | avg ns | p75 ns |
| --------------- | -----: | -----: |
| zipbul          |   0.32 |   0.24 |
| hono-regexp     |   2.75 |   2.41 |
| rou3            |   2.87 |   2.50 |
| memoirist       |  17.38 |  15.08 |
| find-my-way     |  39.34 |  33.28 |
| koa-tree-router |  61.26 |  64.45 |
| hono-trie       |  87.81 |  75.20 |

### GitHub-realistic — 3-param endpoint (65-route fixture, `/repos/:owner/:repo/issues/:number`)

| Adapter         | avg ns | p75 ns |
| --------------- | -----: | -----: |
| zipbul          |  12.80 |  11.08 |
| rou3            |  73.23 |  66.06 |
| memoirist       |  88.12 |  85.73 |
| find-my-way     | 185.52 | 181.92 |
| hono-regexp     | 235.94 | 263.93 |
| hono-trie       | 397.98 | 377.79 |
| koa-tree-router | 404.41 | 390.17 |

### Miss / unknown path

| Adapter         | avg ns | p75 ns |
| --------------- | -----: | -----: |
| zipbul          |   0.07 |   0.05 |
| memoirist       |  12.45 |  12.19 |
| hono-regexp     |  19.84 |  16.68 |
| koa-tree-router |  26.14 |  23.82 |
| rou3            |  26.39 |  23.38 |
| find-my-way     |  33.03 |  30.17 |
| hono-trie       | 128.46 | 112.36 |

The sub-ns rows on `static` and `miss` reflect JSC inlining the bench
body when the call site is monomorphic and the result is unused
downstream — true single-call cost is in the few-ns range. The
relative gap against other adapters is the load-bearing signal.

## Reproduce

```bash
bun bench/regression-snapshot.ts   # self-bench, JSON output
bun bench/comparison.bench.ts      # 49 (adapter × scenario) pairs
bun bench/complex-shapes.bench.ts  # 33 (router × shape) pairs
bun bench/100k-gate-runner.ts      # 100k-scale verification
```

Hardware variance is ±20 % and sub-10 ns ops hit clock-granularity
noise. Re-record on the same machine before drawing release-gate
conclusions.
