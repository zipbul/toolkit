# verify/INDEX.md — 72 items, all reproducers run with stamped VERDICT

Reproducer files cover *every* item. `run-all.sh` runs them and writes
`verify/RESULTS.txt`. Each result printed with a `VERDICT:` line.

| # | 영역 | reproducer files | 상태 |
|---|---|---|---|
| 1 | static path partial-failure tree leak | 01,01b,01c,01d | REFUTED |
| 2 | path-parser→segment-tree double splitting | 02,02b | REPRODUCED |
| 3 | extractSegments empty-segment skip → semantic mismatch | 03,03b,03c | REFUTED |
| 4 | sibling chain prev! invariant | 04 | REFUTED |
| 5 | anchor stripping not propagated | 05 | REFUTED |
| 6 | route-duplicate message inconsistency | 06 | REPRODUCED |
| 7 | for…in usage | 07 | REFUTED (style only) |
| 8 | sibling backtracking params pollution | 08 | REFUTED |
| 9 | root params usage timing (TS-guaranteed) | 09 | REFUTED |
| 10 | iterative pos tracking root | 10 | REFUTED |
| 11 | multi empty suffix | 11 | REFUTED |
| 12 | wildcard fast-path duplication | 12 | REFUTED |
| 13 | minLen calculation | 13 | REFUTED |
| 14 | 8-prefix threshold split | 14 | CODE-VERIFIED |
| 15 | decoder reuse across siblings | 15 | REFUTED |
| 16 | codegen vs walker root-slash | 16 | REFUTED |
| 17 | hasWideFanout missing wildcard | 17 | REFUTED |
| 18 | _t suffix valVar collision | 18 | REFUTED |
| 19 | testerBlock break semantics | 19 | REFUTED |
| 20 | strictTerminal posVar<len | 20 | REFUTED |
| 21 | wildcardTerminal multi guard | 21 | REFUTED |
| 22 | param empty rejection | 22 | REFUTED |
| 23 | next.store sub-branch | 23 | REFUTED |
| 24 | posVar<=len dead guard | 24 | REFUTED |
| 25 | MAX_SOURCE arbitrary | 25 | CODE-VERIFIED |
| 26 | F28 stale comment | 26 | REPRODUCED |
| 27 | useCache hardcoded dead field | 27 | REPRODUCED |
| 28 | cacheMaxSize codegen inlined | 28 | REPRODUCED |
| 29 | specialized vs walker codegen overlap | 29 | REFUTED |
| 30 | tinyFactory handlers mutability | 30 | REPRODUCED (intentional) |
| 31 | hasAnyStatic single-method branch | 31 | REFUTED |
| 32 | missCacheByMethod fallthrough | 32 | REFUTED |
| 33 | EMPTY_PARAMS cache-write dead | 33 | REPRODUCED |
| 34 | per-match params alloc | 34 | REPRODUCED (intentional) |
| 35 | addAll partial failure leak | 35 | REFUTED |
| 36 | star method partial application | 36 | REFUTED |
| 37 | handlerIndex reuse unreachable check | 37 | REFUTED |
| 38 | checkWildcard prefix regex inefficiency | 38 | REFUTED |
| 39 | first-wildcard break unnecessary | 39 | REFUTED |
| 40 | static-wildcard empty prefix edge | 40 | REFUTED |
| 41 | snapshot freeze depth | 41 | REPRODUCED (internal only) |
| 42 | testerCache failed-registration leak | 42 | REFUTED |
| 43 | detectWildCodegenSpec duplicate calls | 43 | REPRODUCED |
| 44 | for…in proto-less ordering | 44 | REFUTED |
| 45 | sparse array iteration | 45 | REFUTED |
| 46 | option default SSoT | 46 | CODE-VERIFIED |
| 47 | path-parser pattern raw (==#5) | 47 | DUP-#5 |
| 48 | tokenize empty body | 48 | REFUTED |
| 49 | decorator combo silent parse | 49 | REFUTED |
| 50 | parseWildcard duplicate check | 50 | REFUTED |
| 51 | activeParams.clear timing | 51 | REFUTED |
| 52 | validatePattern normalize unused | 52 | DUP-#5 |
| 53 | validateParamName empty | 53 | REFUTED |
| 54 | options object mutation | 54 | REFUTED |
| 55 | performBuild throw stuck | 55 | REFUTED (no trigger path) |
| 56 | closure vs internals dual tracking | 56 | REPRODUCED (intentional) |
| 57 | hasAnyStatic recompute | 57 | REPRODUCED |
| 58 | cache evict no-bound | 58 | REFUTED |
| 59 | cache T\|null dead branch | 59 | REPRODUCED |
| 60 | cache capacity vs maxSize | 60 | REPRODUCED (intentional) |
| 61 | DEFAULT_METHODS always allocated | 61 | REPRODUCED (intentional) |
| 62 | getOrCreate undefined check | 62 | REFUTED |
| 63 | codeMap freeze | 63 | REPRODUCED (intentional) |
| 64 | specialized wild matchImpl dead | 64 | REPRODUCED |
| 65 | for…in walker-strategy ordering | 65 | REFUTED |
| 66 | paramNames/paramValues 32-slot dead | 66 | REPRODUCED |
| 67 | resetMatchState unused | 67 | REPRODUCED |
| 68 | allowedMethods sharedParams pollution | 68 | REFUTED |
| 69 | matchState reuse | 69 | REFUTED |
| 70 | NullProtoObj prototype mutability | 70 | REPRODUCED (internal only) |
| 71 | NullProtoObj portability JSC-only | 71 | REPRODUCED (intentional) |
| 72 | RouterError data type usage | 72 | REFUTED |

## Summary by verdict

| verdict | count |
|---|---|
| REPRODUCED | 22 |
| REFUTED | 51 |
| CODE-VERIFIED | 3 |
| DUP-#5 | 2 |
| PARTIAL | 0 |

## Fixed by current implementation

| # | 항목 | 수정 방식 |
|---|---|---|
| 1, 35, 37, 42 | failed-registration leaks | 실패한 삽입의 tree/tester/handler/owner state rollback |
| 3 | `//` semantic mismatch | repeated slash registration reject |
| 5, 47, 52 | anchor not propagated | parser stores normalized regex source |
| 36 | star expansion atomic | `*`/method-array registration failure rollback |
| 49 | decorator combo `:a+?` | optional+wildcard decorator 조합 reject |
| 54 | options mutation | constructor-time options snapshot |

## Remaining reproduced items (수정/정리 후보)

| # | 항목 | 영향 |
|---|---|---|
| 2 | double splitting | 빌드 시간 미세 |
| 6 | route-duplicate message | 메시지 일관성 |
| 14 | 8-prefix SSoT split | 유지보수 |
| 26 | F28 stale comment | cleanup |
| 27, 64 | useCache dead + specialized dead | dead code |
| 33 | EMPTY_PARAMS dead branch | dead branch |
| 41 | snapshot inner Map mutable | internal-only |
| 46 | option default SSoT | 유지보수 |
| 57 | hasAnyStatic recompute | 코드 정리 |
| 59 | cache T\|null dead | dead code |
| 66 | paramNames/paramValues dead state | 코드 정리 |
| 67 | resetMatchState unused | dead function |
| 70 | NullProtoObj prototype mutable | internal-only (defensive) |
