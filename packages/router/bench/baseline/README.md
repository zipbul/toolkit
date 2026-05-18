# Bench Baseline Snapshots

Persistent baseline captures for the router refactor described in
`packages/router/REFACTOR.md`. Every subsequent refactor PR must compare
its measurements against these files on the same machine and report
delta in the PR body.

## Files

| File                       | Source                                                                          | Purpose                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `router.bench.txt`         | `bun run bench` (= `bench/router.bench.ts`)                                     | Self-regression: hot-path matching, cache, full-options, build time. § 0.1~0.4 of REFACTOR.md. |
| `comparison.bench.txt`     | `bun run bench/comparison.bench.ts`                                             | Competitor parity: find-my-way, hono (Trie + RegExp), koa-tree-router, memoirist, rou3. § 0.5. |
| `complex-shapes.bench.txt` | `bun run bench/complex-shapes.bench.ts`                                         | Complex route-shape regression.                                                                |
| `env.txt`                  | `uname` + `bun --version` + `lscpu` + `/proc/cpuinfo` MHz + scaling info + load | Reproducibility metadata.                                                                      |

## Refresh policy

**Do not refresh** unless one of the following changes:

- Host machine (CPU model, kernel, virtualization layer)
- Bun runtime version
- A competitor library is upgraded in `package.json` devDependencies
  (changes the relative numbers in `comparison.bench.txt`)
- Refactor stage F12 final cleanup (post-1.0 release)

If you must refresh, follow the exact procedure in REFACTOR.md § 0.5
appendix C, **strip ANSI codes** (`sed -i 's/\x1b\[[0-9;]*m//g' *.bench.txt`),
and update `env.txt` with the new metadata. Always commit the refresh
in a single dedicated PR labeled `bench-baseline`.

## Comparison procedure (every PR)

```bash
cd packages/router
# 1. Run current measurements (clean, no other CPU load)
bun run bench > /tmp/router.now.txt 2>&1
sed -i 's/\x1b\[[0-9;]*m//g' /tmp/router.now.txt

# 2. Diff against baseline
diff bench/baseline/router.bench.txt /tmp/router.now.txt | head -100

# 3. Hot-path threshold check (manual today; F11 will automate)
# - § 0.1 hot-path p75 deltas must be within ±2 ns
# - § 0.2 cache p75 deltas within ±1 ns
# - comparison.bench: relative ranking preserved, absolute ±5%
```

Attach the diff or a summary table to the PR body. PRs without a delta
report are not mergeable per REFACTOR.md § 1 principle 2.

## ANSI cleanliness

All `*.bench.txt` files are stored without terminal color codes so that
`diff` produces meaningful output. The capture commands in REFACTOR.md
§ C strip ANSI explicitly. If you see escape codes in this directory,
re-strip with the sed command above before committing.
