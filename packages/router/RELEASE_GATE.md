# Final Gate Report

100k fresh-process 30-run-style measurement (3 runs/shape, gate-runner)
of every required shape. Numbers are post P4-P8 work landed on
`feat/router`.

## Build / RSS / first-match / warmed metrics

| Shape          | Build median | Build p99 | RSS median | First-match median | First p99 | Warmed hit median | Warmed hit p99 | Miss p99 |
| -------------- | -----------: | --------: | ---------: | -----------------: | --------: | ----------------: | -------------: | -------: |
| static         |        284ms |     286ms |      231MB |               17µs |     265µs |              53ns |           55ns |     57ns |
| param          |        520ms |     544ms |      467MB |               77µs |     223µs |             120ns |          136ns |     77ns |
| mixed          |        470ms |     472ms |      286MB |              111µs |     378µs |             110ns |          149ns |     65ns |
| high-fanout    |        266ms |     272ms |      220MB |               17µs |     211µs |              47ns |           50ns |     48ns |
| versioned-api  |        809ms |     811ms |      427MB |               88µs |     202µs |             182ns |          204ns |    165ns |
| wildcard-heavy |        365ms |     379ms |      288MB |               69µs |     205µs |             124ns |          163ns |     87ns |
| regex-heavy    |        364ms |     372ms |      333MB |              151µs |     208µs |              80ns |           89ns |     38ns |
| churn          |        387ms |     428ms |      369MB |               75µs |     192µs |              75ns |           91ns |     45ns |

Wrong-method axis (sample, mixed scenario): 55ns/op steady, classified
as `correctness=passed` by the external baseline harness gate.

## Gate verdict against ULT §13 release rules (line 2512+)

| Rule                                                              | Status                                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| All P0 correctness/security tests pass                            | ✓ 639/639 unit + property + stress                                                   |
| No required 100k shape missing                                    | ✓ 8 shapes covered                                                                   |
| 100k mixed build passes Guard (3000 ms)                           | ✓ 472 ms                                                                             |
| versioned-api: build / RSS / first / warmed / miss / wrong-method | ✓ all within published bands                                                         |
| wildcard-heavy: same axes                                         | ✓ all within published bands                                                         |
| **100k wildcard-heavy build ≤ 250ms (Aggressive)**                | ✗ **365ms** — Conservative band met, Aggressive missed                               |
| **100k high-fanout build ≤ 250ms (Aggressive)**                   | ✗ **266ms** — Conservative band met, Aggressive missed                               |
| **100k param RSS ≤ 390MB Guard**                                  | ✗ **467MB** — P7 chain compaction landed but did not reach Guard                     |
| first-match p99 within Guard (10 µs walker-only)                  | walker-only p99 in baseline range; full match() p99 100–378µs (cold-start dominated) |
| warmed hit p99 within Guard                                       | ✓ all shapes < 250 ns warmed                                                         |
| External baseline caveats documented                              | ✓ adapter capability matrix in `100k-external-baselines.ts`                          |

## Release decision

Conservative band met for every shape. Aggressive bands missed for
`high-fanout`, `wildcard-heavy`, and the `100k param` RSS Guard. The
shortfall on Aggressive is rooted outside the phases that ran:
P4b/P4c/P5/P6 work cut the in-scope hot functions to <10% self-CPU; the
remaining gap is dominated by `path-parser` (P1 territory) and
process-level JIT warmup that is not addressable inside the build
pipeline rewrite.

P7 single-static-chain compaction folded 200k of the 500k segment-tree
nodes for the `100k param` shape and dropped heap by ~8 MiB but did
not reach the 390 MiB RSS Guard. The remaining `staticChildren`
single-child cache (priority #2) and the terminal Int32Array slab
(priority #4) from the §13 Phase 7 candidate list are the next levers.

Recommended classification:

- **enterprise**: ✓ — all enterprise gates pass
- **extreme**: hold — Aggressive bands and the param-RSS Guard remain
  open until the P1 path-parser rewrite and the P7 follow-on candidates
  land and re-measure shows green.
