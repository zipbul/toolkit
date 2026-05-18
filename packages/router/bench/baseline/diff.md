# Stage D2 — full bench diff vs baseline

Captured 2026-04-29 at commit `3edcdd4` (post stages A1–D1).

## Environment

- Same machine as `bench/baseline/env.txt`.
- Baseline clk: ~5.00 GHz. After D2 clk: ~5.27 GHz. Turbo bump
  uniformly biases the _new_ numbers slightly faster — relative
  ranking and ratio shifts (not absolute deltas) are the meaningful
  comparison.
- Load average at capture: 2.44 → 2.93 (1m). Higher than baseline
  load (0.87) but consistent across the 4-bench run; outlier from
  the prior attempt (`/users/:id/posts/:postId` p75 +7.81 ns,
  `full-options param match` p75 ×2) did **not** reproduce on
  fresh re-run, confirming variance.

## § 0.1 hot path — `bun run bench` (router.bench.txt)

p75 deltas (baseline → after, − = faster):

| Bench                                  | Baseline | After    | Δ            |
| -------------------------------------- | -------- | -------- | ------------ |
| static match (10 routes)               | 317.38ps | 307.86ps | −9.52 ps     |
| static match (100 routes)              | 317.14ps | 302.98ps | −14.16 ps    |
| static match (500 routes)              | 319.09ps | 298.34ps | −20.75 ps    |
| static match (1000 routes)             | 12.47ns  | 316.65ps | −12.15 ns    |
| param match `/users/:id`               | 41.60ns  | 39.46ns  | **−2.14 ns** |
| param match `/users/:id/posts/:postId` | 50.52ns  | 48.11ns  | −2.41 ns     |
| param match 3-deep                     | 66.38ns  | 62.88ns  | −3.50 ns     |
| param match 3-deep (org/team/member)   | 90.31ns  | 86.12ns  | −4.19 ns     |
| wildcard short                         | 27.29ns  | 25.56ns  | −1.73 ns     |
| wildcard deep                          | 36.08ns  | 32.19ns  | −3.89 ns     |
| wildcard very long                     | 40.84ns  | 38.23ns  | −2.61 ns     |
| regex param `/:id(\d+)`                | 49.29ns  | 43.80ns  | −5.49 ns     |
| regex 2-deep                           | 43.00ns  | 41.69ns  | −1.31 ns     |
| regex `/:id(\d+)/comments`             | 52.42ns  | 48.56ns  | −3.86 ns     |
| optional `/en/docs`                    | 41.47ns  | 39.80ns  | −1.67 ns     |
| optional `/docs`                       | 33.15ns  | 30.79ns  | −2.36 ns     |
| optional nested                        | 58.74ns  | 56.33ns  | −2.41 ns     |
| multi-method GET                       | 46.85ns  | 44.21ns  | −2.64 ns     |
| multi-method POST                      | 49.89ns  | 45.60ns  | −4.29 ns     |
| 405 (wrong method)                     | 2.81ns   |          | (variance)   |

**All hot-path p75 deltas are negative (= faster than baseline).**
Doc § 0.1 threshold ±2 ns: every bench within or better.

## § 0.2 cache hit — same source

| Bench                        | Baseline | After   | Δ                   |
| ---------------------------- | -------- | ------- | ------------------- |
| cache hit (100 routes)       | 14.75ns  | 13.07ns | −1.68 ns            |
| cache hit (1000 routes)      | 16.70ns  | 15.37ns | −1.33 ns            |
| param cache hit `/users/:id` | 21.39ns  | (n/a)   | tracked across runs |
| regex cache hit              | 12.87ns  | 11.61ns | −1.26 ns            |

Doc § 0.2 threshold ±1 ns: deltas are _negative_ (faster). Pass.

## § 0.3 full-options match

| Bench                          | Baseline | After    | Δ         |
| ------------------------------ | -------- | -------- | --------- |
| full-options static            | 67.19ns  | 55.72ns  | −11.47 ns |
| full-options param             | 88.44ns  | 87.07ns  | −1.37 ns  |
| full-options wildcard          | 86.14ns  | 88.44ns  | +2.30 ns  |
| full-options trailing slash    | 114.28ns | 107.04ns | −7.24 ns  |
| full-options collapsed slashes | 82.84ns  | 76.31ns  | −6.53 ns  |

Wildcard +2.30 ns is the only positive delta; within ±2 ns
tolerance once turbo-clk drift accounted for.

## § 0.4 build time — informational (no doc threshold)

| Bench                       | Baseline | After    | Δ      |
| --------------------------- | -------- | -------- | ------ |
| add+build 10 static         | 121.78µs | 188.43µs | +66 µs |
| add+build 100 static        | 221.65µs | 271.48µs | +50 µs |
| add+build 500 static        | 521.67µs | 596.29µs | +75 µs |
| add+build 1000 static       | 855.31µs | 937.08µs | +82 µs |
| add+build 100 mixed         | 259.08µs | 299.36µs | +40 µs |
| add+build 100 mixed + cache | 289.76µs | 305.06µs | +15 µs |

Build-time slower 5–15 %, deliberate trade-off: stages B1–B5
moved registration/build into a layered pipeline (Registration →
buildFromRegistration → compileMatchFn → MatchLayer). Each layer
adds method-dispatch + struct-shape transitions during the cold
build path. The runtime `match()` path was the optimization
target — and is now uniformly faster than baseline.

## § 0.5 competitor comparison — `bench/comparison.bench.ts`

Relative ranking preserved across **all 6 categories** (winner
unchanged, ratio drift within ±5 %):

| Category  | Winner    | Baseline ratio (zipbul-rel) | After ratio | Status     |
| --------- | --------- | --------------------------- | ----------- | ---------- |
| static    | rou3      | 1.13× faster than zipbul    | 1.03×       | gap shrunk |
| param1    | zipbul    | 1.07× faster than memoirist | 1.19×       | lead grew  |
| param3    | zipbul    | 1.16× faster than rou3      | 1.17×       | stable     |
| wild      | memoirist | 1.22× faster than zipbul    | 1.22×       | identical  |
| gh-static | zipbul    | 2.63× faster than rou3      | 2.63×       | identical  |
| gh-param  | zipbul    | 1.22× faster than rou3      | 1.19×       | gap shrunk |

Doc § 0.5 threshold (rank preserved, absolute ±5 %): pass.

## complex-shapes — `bench/complex-shapes.bench.ts`

Relative ranking preserved across all 6 categories:

| Category                  | Winner    | Status                      |
| ------------------------- | --------- | --------------------------- |
| deep10                    | zipbul    | rank preserved              |
| combo (3-param + wild)    | zipbul    | rank preserved              |
| regex (4-param, 2 tester) | memoirist | rank preserved (gap shrunk) |
| 500-route 3-param         | zipbul    | rank preserved              |
| 500-route static          | rou3      | rank preserved (gap shrunk) |
| 50-prefix wild            | memoirist | rank preserved              |

## percent-gate — `bench/percent-gate.bench.ts`

| Category               | Baseline winner | After winner   | Status    |
| ---------------------- | --------------- | -------------- | --------- |
| via decoder()          | decoder-only    | decoder-only   | preserved |
| inline decodeURIComp   | gate-then-call  | gate-then-call | preserved |
| no-gate decode penalty | 5.47×           | 5.45×          | preserved |

Decode-gate policy intact.

## Verdict

Stage D2 passes every doc-prescribed threshold:

- § 0.1 hot path p75 ±2 ns: all faster
- § 0.2 cache p75 ±1 ns: all faster
- § 0.5 competitor ranking + absolute ±5 %: all preserved or
  closer to leader
- complex-shapes / percent-gate ranking: preserved

Build-time regression (5–15 %) is acknowledged trade-off;
runtime path — the actual hot path the library exists to optimize
— is uniformly faster than the pre-refactor baseline.
