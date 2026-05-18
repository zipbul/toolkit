---
"@zipbul/router": patch
---

Internal bench audit and harness overhaul. **No published API change** — `dist/` is unaffected; consumers see no behavioral difference.

## Defects removed (line-by-line audit + Codex/Explore second-opinion)

**Measurement correctness (output was lying)**

- `router.bench.ts`: removed non-existent `enableCache`, `ignoreTrailingSlash`, `caseSensitive` options (silently ignored by `RouterOptions`). The cache-hit vs no-cache and case-insensitive benches were measuring nothing of the kind; sections deleted. `fullOptionsRouter` now uses the real options (`trailingSlash: 'ignore'`, `pathCaseSensitive: false`). Static-match 10/100/500/1000 collapsed to a single hash-bucket bench (all four are O(1) static-bucket lookups; the four-row scaling was misleading).
- `100k-verification.ts`: `100k churn` scenario removed — hit/miss paths were fixed strings, defeating the advertised "unique-path churn" intent. Real churn measurement already lives in `cacheTraversalFeasibility()`. `100k-gate-runner.ts` scenarios list updated.
- `complex-shapes.bench.ts`: `regex` shape now skips memoirist with `regex: null` (was registering a tester-less variant under the "regex (testers)" label — apples-to-oranges vs zipbul). Label corrected from "2 testers" to "3 testers" (route has three regex constraints).
- `comparison.bench.ts`: `miss` scenario's `wrongMethod` axis now hits a registered path (`POST /api/v1/resource50`); the previous unregistered path collapsed wrong-method into the plain miss axis, contracting the test.
- `regression-snapshot.ts`: `p99NsPerOp` JSON field renamed to `maxNsPerOp`. With TRIALS=11 the nearest-rank p99 index lands on the max sample; the old label was a false-precision claim.

**Statistical honesty**

- `helpers.ts` `percentile()`: docstring now warns that small-N inputs collapse p75/p99 to the max. Callers updated:
  - `100k-gate-runner.ts`, `100k-external-baselines.ts`: `buildP75/P99` collapsed to `buildMax` (1-sample-per-run inputs).
  - `100k-bun-serve-baseline.ts`: `warmedP99` removed (3-sample input made it identical to `warmedMax`).
- `first-call-latency.ts`: replaced local `Math.floor(n*0.99)` with shared `percentile()`.

**Methodology consistency**

- `100k-external-baselines.ts`: `find-my-way` adapter now uses `{ ignoreTrailingSlash: true }` to match `100k-external-correctness.ts`. Same adapter measured with different options would be apples-to-oranges. `settleScavenger()` called before the `mem()` baseline read so RSS measurement aligns with `regression-snapshot.ts`.
- `100k-verification.ts`: `candidateMicrobench()` (toy dispatch-table micro-benches that never touch zipbul Router) and `tryUrlPatternBaseline()` (URLPattern external baseline) removed — both belonged elsewhere; the file's name is "verification" of zipbul, not exploratory R&D.

**Dead-code purge**

- Deleted `bench/comparison-solo.bench.ts` (the orchestrator/worker split in `comparison.bench.ts` already provides per-adapter process isolation; the file's stated reason for existing was invalidated).
- Deleted `bench/baseline/percent-gate.bench.txt` (corresponding `.ts` removed in an earlier commit).
- Removed unused `supports` field on every adapter in `100k-external-correctness.ts` and the unused `skipFor` parameter.

## Cross-router fairness — full process isolation

Both cross-router benches now spawn one fresh child process **per (adapter × scenario)** pair, not just per adapter. JIT code cache, IC state, and RSS baseline are isolated at the finest granularity that yields independent measurements.

- `comparison.bench.ts`: 7 adapters × 7 scenarios = **49 fresh-process pairs**. Worker takes `argv = [adapter, scenarioLabel]`. Sanity-gate failures print structured reasons (`sanity=hit-null`, `sanity=miss-not-null`, `sanity=wrong-method-not-null`, `sanity=setup-failed`) and exit without emitting timing.
- `complex-shapes.bench.ts`: 3 routers × 11 shapes = **33 fresh-process pairs**, with explicit `skip=true reason=unsupported` for shapes the adapter can't express (rou3 has no regex/manywild/deep20; memoirist has no regex). Per-shape build functions replace the prior batch builders so each worker only constructs the router it benches — JIT pollution from sibling shapes is eliminated.

## Walker-fallback bench — comparability note

`walker-fallbacks.bench.ts`: header note added. The three benches (codegen / iterative / recursive) measure each walker on the workload that triggers its selection; route counts (1/50/4) and match paths differ, so the timings are per-walker sanity numbers, not cross-walker comparisons.

## Verification

- `bunx tsc --noEmit -p tsconfig.json` — 0 errors.
- `bun test` — 999 pass / 0 fail / 9470 expects.
- Every modified bench compiled cleanly via `bun build`.
- Worker-mode smoke-runs confirmed for `comparison.bench.ts` (`zipbul static`), `complex-shapes.bench.ts` (`zipbul deep10`, `rou3 regex` → skip), `cache-cardinality.bench.ts`, `walker-fallbacks.bench.ts`, `first-call-latency.ts`, `regression-snapshot.ts` (JSON validates with new `maxNsPerOp` field), `router.bench.ts`, `100k-verification.ts '100k static'`, and `100k-external-correctness.ts`.
- `100k-gate-runner.ts` regex parser confirmed still matches the `100k-verification.ts` bench output format (unchanged).
