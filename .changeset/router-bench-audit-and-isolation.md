---
"@zipbul/router": patch
---

Bench audit, lint/format tooling setup, router lint compliance, circular-dep removal. **No published API change** — `dist/` is unaffected; consumers see no behavioral difference.

## Part 1 — Bench audit & harness fixes (line-by-line + Codex/Explore second-opinion)

### Measurement correctness (output was lying)

- `router.bench.ts`: removed non-existent `enableCache`, `ignoreTrailingSlash`, `caseSensitive` options (silently ignored by `RouterOptions`). The cache-hit vs no-cache and case-insensitive benches were measuring nothing of the kind; sections deleted. `fullOptionsRouter` now uses the real options (`trailingSlash: 'ignore'`, `pathCaseSensitive: false`). Static-match 10/100/500/1000 collapsed to a single hash-bucket bench (all four are O(1) static-bucket lookups; the four-row scaling was misleading).
- `100k-verification.ts`: `100k churn` scenario removed — hit/miss paths were fixed strings, defeating the advertised "unique-path churn" intent. Real churn measurement already lives in `cacheTraversalFeasibility()`. `100k-gate-runner.ts` scenarios list updated.
- `complex-shapes.bench.ts`: `regex` shape now skips memoirist with `regex: null` (was registering a tester-less variant under the "regex (testers)" label — apples-to-oranges vs zipbul). Label corrected from "2 testers" to "3 testers".
- `comparison.bench.ts`: `miss` scenario's `wrongMethod` axis now hits a registered path; the previous unregistered path collapsed wrong-method into the plain miss axis.
- `regression-snapshot.ts`: `p99NsPerOp` JSON field renamed to `maxNsPerOp`. With TRIALS=11 the nearest-rank p99 index lands on the max sample.

### Statistical honesty

- `helpers.ts` `percentile()`: docstring warns small-N inputs collapse p75/p99 to max. `100k-gate-runner.ts`, `100k-external-baselines.ts`: `buildP75/P99` collapsed to `buildMax`. `100k-bun-serve-baseline.ts`: `warmedP99` removed.
- `first-call-latency.ts`: replaced local `Math.floor(n*0.99)` with shared `percentile()`.

### Methodology consistency

- `100k-external-baselines.ts`: `find-my-way` adapter uses `{ ignoreTrailingSlash: true }` matching `100k-external-correctness.ts`. `settleScavenger()` called before `mem()` baseline.
- `100k-verification.ts`: removed `candidateMicrobench()` and `tryUrlPatternBaseline()` (didn't measure zipbul Router).

### Cross-router fairness — full pair isolation

- `comparison.bench.ts`: 7 adapters × 7 scenarios = **49 fresh-process pairs**. Worker takes `argv = [adapter, scenarioLabel]`. Sanity-gate failures print structured reasons.
- `complex-shapes.bench.ts`: 3 routers × 11 shapes = **33 fresh-process pairs** with per-shape build functions (no JIT pollution from sibling shapes). Unsupported pairs print `skip=true reason=unsupported`.

### Dead-code purge

- Deleted `bench/comparison-solo.bench.ts`, `bench/baseline/percent-gate.bench.txt`.
- Removed unused `supports` field, `skipFor` parameter in `100k-external-correctness.ts`.
- Removed unused devDependencies `@hattip/router` and `itty-router` (referenced only by since-deleted benches).

### Walker-fallback bench note

`walker-fallbacks.bench.ts`: header note that the three benches measure each walker on the workload that triggers its selection — route counts and match paths differ, so the timings are per-walker sanity numbers, not cross-walker comparisons.

## Part 2 — Lint/format/dead-code tooling (toolkit-wide)

Copied from `zipbul/` sibling repo for consistency with the broader Zipbul ecosystem standards. All configs at toolkit root (`.oxlintrc.jsonc`, `.oxfmtrc.jsonc`, `knip.json`). Root `package.json` scripts: `typecheck`, `lint`, `format`, `format:check`, `knip`, `dpdm`. devDependencies pinned to versions matching the sibling repo (`oxlint@^1.41.0`, `oxlint-tsgolint@^0.11.1`, `oxfmt@^0.26.0`, `knip@^5.63.1`, `dpdm@^4.2.0`).

### tsconfig stricter (`toolkit/tsconfig.json`)

`noUnusedLocals`, `noUnusedParameters`, `noPropertyAccessFromIndexSignature` all enabled (was `false`). Router passes cleanly.

### Sensible overrides (`.oxlintrc.jsonc`)

- `packages/router/bench/**/*.ts`: `no-explicit-any`, `no-loop-func`, `import/no-dynamic-require`, `default-case` off. Adapter testing against 7 external routers with disparate return shapes requires loose typing; per-shape `Shape` union switches use exhaustive type-narrowing that TypeScript verifies.
- `**/*.spec.ts`/`**/*.test.ts`: `no-explicit-any` off (intentional `any` for type-error coverage); `jest/no-conditional-in-test` off (Result-type narrowing `if (err.data.kind === 'X')` is legitimate TypeScript narrowing, not a test antipattern).

### Router exports-last refactor (12 files)

All `export function`/`export interface`/`export class` declarations moved to a single bottom `export { ... }` / `export type { ... }` block per file. Files touched: `pattern-tester.ts`, `path-policy.ts`, `wildcard-method-expand.ts`, `emitter.ts`, `prefix-factor.ts`, `factor-detect.ts`, `path-parser.ts`, `route-expand.ts`, `wildcard-prefix-index.ts`, `router.ts`, `pipeline/registration.ts`, `codegen/segment-compile.ts`, `tree/segment-tree.ts`.

### Circular dependency removal

Extracted `SegmentNode` + `ParamSegment` interfaces from `src/tree/segment-tree.ts` into a new `src/tree/node-types.ts`. `segment-tree.ts` now imports the types from `./node-types` and re-exports them; `undo.ts` also imports from `./node-types`. Eliminates the type-only `segment-tree → undo → segment-tree` cycle that `dpdm` flagged.

### Test/spec import dedup

- `src/builder/path-parser.spec.ts`, `src/builder/route-expand.spec.ts`, `src/router.spec.ts`: merged duplicate inline imports (one at top, one mid-file) into single top imports — fixes `import/no-duplicates` and `import/first`.

### Format pass

`oxfmt` applied to every `.ts`, `.md`, `.json` in the monorepo. 204 files reformatted (printWidth 130, trailingComma all, sorted package.json scripts, sorted imports per group).

## Verification

- `bunx tsc --noEmit -p packages/router/tsconfig.json` — 0 errors.
- `bun test` (router-scoped) — 999 pass / 0 fail / 9533 expects.
- `bunx oxlint packages/router` — 0 warnings / 0 errors.
- `bunx dpdm packages/router/src/**/*.ts packages/router/index.ts` — no circular dependencies.
- Bench worker smoke runs confirmed for `comparison.bench.ts`, `complex-shapes.bench.ts`, `cache-cardinality.bench.ts`, `walker-fallbacks.bench.ts`, `first-call-latency.ts`, `regression-snapshot.ts`, `router.bench.ts`, `100k-verification.ts`, `100k-external-correctness.ts`. `100k-gate-runner.ts` regex parser still matches `100k-verification.ts` output format.

## Known follow-ups (out of router scope)

- `cors`, `multipart`, `rate-limiter`, `result`, `query-parser` still have lint violations (53 errors total across those packages). Pre-existing; not addressed in this PR. Tracking separately.
- `knip` reports ~11 router exports + 9 router types as unused outside their own file. Most are internal helpers (`flushStaticBuffer`, `emitParamBranch`, etc.) — safe to delete or keep as internal-API surface. Decided not to remove now to avoid scope creep.
- Pre-existing stale `dist/` artifacts in `packages/result` and `packages/shared` cause 26 cross-package test failures when running `bun test` from monorepo root. Unrelated; tracked separately.
