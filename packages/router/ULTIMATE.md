# ULTIMATE.md: Bun/JSC Router Optimization Blueprint

이 문서는 Bun 전용 라우터를 극한까지 최적화하기 위한 계획 문서다.
기준은 추측이 아니라 `packages/router/bench/bun-technique-matrix.ts`, 기존 router end-to-end bench, 현재 코드 전수 검토, Bun 1.3.13 기준 로컬 실행 결과, Bun 1.3.x 공식 릴리스 노트, RFC 9110/RFC 3986/RFC 3629 기준을 교차 확인한 결과다.

목표는 단순히 "TypedArray를 많이 쓰는 라우터"가 아니다. Bun은 JavaScriptCore(JSC) 기반이므로, 현재 근거상 가장 강한 가설은 JSC가 잘 최적화하는 object shape/property lookup을 활용하고, allocation/GC가 생기는 지점만 제거하는 hybrid 설계다.

최상위 규모 목표는 **100,000 registered routes in a single router**이다. 이 문서의 모든 correctness, memory, build, match, cache, codegen, validation 전략은 100k routes에서 무너지지 않는 것을 기준으로 판단한다.

단, 이 문서는 “모든 후보를 이미 끝까지 구현했다”는 선언이 아니다. 현재 확정된 기법, 기각된 기법, end-to-end 검증이 더 필요한 후보를 분리한다. 최종 최고 설계로 확정하려면 이 문서의 Verification Gate를 통과해야 한다.

## 0. Document Finality Contract

이 문서의 완성 기준은 “현재 구현이 이미 완벽하다”가 아니다. 완성 기준은 다음이다.

- 구현자가 이 문서만 보고 어떤 결함을 먼저 고칠지 결정할 수 있어야 한다.
- 어떤 최적화가 확정, 조건부, 기각인지 오해 없이 구분되어야 한다.
- 성능/메모리 수치가 재현 범위를 넘어서 과장되지 않아야 한다.
- 100k routes에서 최종 승인하려면 어떤 테스트, 벤치, profile을 통과해야 하는지 닫혀 있어야 한다.
- 미검증 항목은 “모름”으로 남기지 않고, 검증 명령/측정 단위/승인 기준으로 변환되어야 한다.
- 보안/표준 정책은 secure/default와 compat/unsafe의 경계가 명확해야 한다.

구현 언어/런타임 스코프 (Implementation language/runtime scope):

- Implementation language: **TypeScript only**, executing on Bun JSC.
- No native bindings (no N-API/FFI).
- No WebAssembly hot path or build artifact.
- No transpilation to other JS runtimes (Node/Deno) is targeted; cross-runtime compatibility is explicitly out-of-scope.
- All performance and memory primitives are JS/TS built-ins or Bun stdlib (`Object.create(null)`, `Map`, `Int32Array`, `URLPattern`, `Bun.hash`, `Bun.serve`, `Bun.nanoseconds`, etc.).
- External diagnostic tooling (`bun --cpu-prof`, `bun --heap-prof`, Linux `perf`, `valgrind`) may be used for measurement-only purposes; the router source code never depends on them at runtime.

문서 내 용어의 의미:

- `Confirmed`: 현재 코드/벤치/표준으로 사실 확인된 내용.
- `Provisional`: 방향성은 강하지만 end-to-end gate 전까지 최종 채택하지 않는 내용.
- `Candidate`: 실험 대상. 기본 설계가 아니다.
- `Rejected`: 현재 재현 근거상 채택하지 않는 내용.
- `Gate`: 구현 완료 또는 enterprise/extreme claim 전에 반드시 통과해야 하는 검증.
- `build()` / `seal()`: `build()` is the public API boundary; `seal()` is the internal snapshot-validation operation. When this document says `seal()`, it means the internal work performed during public `build()`.

최종 claim 금지 조건:

- single-run microbench만으로 “최고”, “완벽”, “엔터프라이즈급”이라고 쓰지 않는다.
- cache-hot 반복 조회만으로 router match path 전체 성능이라고 말하지 않는다.
- static-only external baseline을 dynamic/param/wildcard 성능으로 일반화하지 않는다.
- native JS RegExp guard를 ReDoS 완전 방지로 표현하지 않는다.
- heap/RSS delta 한 번으로 retained memory 최종값이라고 말하지 않는다.
- 구현되지 않은 strict/security policy를 현재 품질로 주장하지 않는다.

---

## 1. 재현 근거

실행 명령:

```sh
bun packages/router/bench/bun-technique-matrix.ts
```

주요 결과:

| 항목 | 결과 |
| --- | ---: |
| method null-proto object lookup | 1.12 ns/op |
| method switch dispatch | 2.10 ns/op |
| method Map.get | 7.80 ns/op |
| method bitmask availability | 2.18 ns/op |
| bitmap+popcount rank | 4.95 ns/op |
| method bool array availability | 2.69 ns/op |
| method Set<number> availability | 3.43 ns/op |
| method Set<string> availability | 9.66 ns/op |
| terminal direct handler index | 2.07 ns/op |
| terminal array method lookup | 2.41 ns/op |
| terminal tagged fast path | 2.39 ns/op |
| terminal tagged poly path | 2.18 ns/op |
| direct object static hit (small key set, JSC IC fast path) | 3.44 ns/op |
| direct object static hit (100k key set, post-IC) | **27.71 ns/iter** (§5.3 B) |
| `Map<string, number>` static hit (100k key set) | **13.87 ns/iter** (§5.3 B — 1.99× faster) |
| length bucket static hit | 5.49 ns/op |
| packed key lookup hit | 25.50 ns/op |
| open-address hash lookup hit | 18.59 ns/op |
| fanout4 object lookup | 4.02 ns/op |
| fanout16 object lookup | 3.08 ns/op |
| fanout64 object lookup | 3.27 ns/op |
| fanout64 array scan | 54.82 ns/op |
| Uint32Array indexed read | 3.02 ns/op |
| DataView getUint32 | 3.59 ns/op |
| TextEncoder.encode per match | 47.04 ns/op |
| Bun.hash string | 71.58 ns/op |
| String#indexOf slash | 4.46 ns/op |
| manual slash scan | 1.36 ns/op |
| string length read | 2.35 ns/op |
| toLowerCase unchanged ascii | 2.70 ns/op |
| manual lowercase unchanged ascii | 17.54 ns/op |
| build-time specialized equality | 1.57 ns/op |
| cache key concat lookup | 11.37 ns/op |
| per-method cache path lookup | 4.19 ns/op |
| throw/catch validation | 55.94 ns/op |
| issue-array validation | 3.33 ns/op |
| substring param allocation | 38.47 ns/op |
| offset-only param accounting | 2.66 ns/op |
| object nodes 500k approx delta | rss +33.80 MB, heap +37.72 MB |
| Int32Array 500k*8 approx delta | rss +18.38 MB, heap +0 MB |

Measurement footnotes:

- `substring param allocation` returns a string, while `TextEncoder.encode` returns a `Uint8Array`; those two rows reflect separate hot-path allocation costs and must not be treated as a direct same-output comparison.
- The object/Int32Array memory rows include allocator/page behavior, not just raw payload. `Int32Array 500k*8` means 500,000 rows with 8 `Int32` slots each: 4,000,000 elements * 4 bytes = 15.26 MiB raw element payload. The measured RSS delta is larger because of runtime allocation overhead and page accounting.
- The object allocation probe can show heap delta larger than RSS delta because GC timing, allocator arenas, and OS page accounting are not synchronized in the single-process measurement.

해석:

- Bun/JSC에서는 null-prototype object property lookup이 매우 강하다.
- Fanout microbench rows are not monotonic (`fanout4` can be slower than `fanout16`) because JSC inline-cache state, branch prediction, and benchmark noise matter at single-digit ns/op scale; use them as directional candidate evidence only.
- HTTP method 입력은 문자열을 null-proto object로 숫자 code로 바꾸는 것이 가장 빠르다.
- method availability, allowed-methods, terminal multi-method 판정은 bitmask가 bool array와 Set보다 빠르다.
- `Map`, `switch`, naive SoA/linear scan, packed hash, open-address hash는 이 workload에서 object lookup을 이기지 못했다.
- `TypedArray`는 raw indexed read와 memory density에는 유리하지만, child lookup 전체를 대체하면 자동으로 빨라지지 않는다.
- hot path에서 `Bun.hash`, `TextEncoder`, `DataView`, `throw/catch`는 기각한다.
- slash 탐색은 microbench 실행마다 `indexOf('/')`와 manual scan의 승패가 흔들렸다. 따라서 manual scan 기본 채택은 금지하고, 실제 segment walker end-to-end에서만 결정한다.
- case normalization은 manual uppercase pre-scan보다 `toLowerCase()` 직접 호출이 빨랐다.
- allocation 제거는 확실히 중요하다. param substring 생성보다 offset 기반 전달이 훨씬 빠르다.

주의:

- 위 표는 primitive 선택 근거다. 실제 router 전체에서 code size, JIT tier-up, route distribution, cache cardinality, first-match latency까지 증명하지는 않는다.
- 단일 ns/op 실행값은 절대값으로 고정하지 않는다. 최소 3회 반복 median/p75/p99와 ranking 안정성으로 판단한다.

---

## 2. Bun 1.3.x Research Inputs

공식 Bun 1.3.x 포스트 전체를 확인한 결과, 라우터에 직접 반영할 근거는 다음이다.

Pinned local runtime for measurements:

- Bun `1.3.13`
- Node compatibility runtime reports `v24.3.0`
- Platform `linux x64`
- All ns/op and memory numbers in this document are local results from this environment unless otherwise stated.
- Release-note inputs are design hints only. Local benchmark/profile gates override release-note inference.

| Source | Relevant fact | Router decision |
| --- | --- | --- |
| Bun 1.3.13 | JavaScriptCore upgrade: string length folding, `String#indexOf` single-character fast path, SIMD case-insensitive comparison, GC bulk-copy improvements | string primitive와 JSC object fast path를 유지한다. 문자열을 byte buffer로 강제 변환하지 않는다. |
| Bun 1.3.13 | Source maps moved to compact bit-packed binary format with in-place reads; lookup cost increased slightly while memory dropped | dense metadata는 packed/TypedArray로 옮기되, lookup 전체를 packed buffer로 대체하지 않는다. |
| Bun 1.3.13 | Runtime memory allocator/libpas improvements reduce baseline memory | memory bench는 Bun version pinned 상태로만 비교한다. |
| Bun 1.3.12 | Faster tier-up, `Array.isArray` intrinsic, faster single-character `String#includes`, register allocation improvements | small stable hot functions and monomorphic runtime tables are preferred. |
| Bun 1.3.12 | URLPattern became up to 2.3x faster by removing temporary JS allocations | allocation-free matching is a proven Bun/JSC direction. Compare against URLPattern, but do not replace the router with URLPattern. |
| Bun 1.3.7 | ARM64 compound boolean expressions compile better, reducing branch misprediction/code size | generated boolean chains are valid candidates when code size is bounded. |
| Bun 1.3 | `Bun.serve()` has native routes with params/catch-all | benchmark against Bun native routes as an external baseline. |
| Bun 1.3 | `request.cookies` parses lazily when accessed | params avoid eager object/string materialization where API compatibility permits it. |
| Bun 1.3.2 / 1.3.7 / 1.3.9 | CPU and heap profiling flags/APIs exist | final optimization must be checked with `--cpu-prof`, `--cpu-prof-interval`, and `--heap-prof`, not only mitata. |

External baselines required before claiming final superiority:

- current router
- Bun native `Bun.serve({ routes })`
- `URLPattern`
- popular userland routers where compatible

All external baselines must include the 100k route profile where the baseline can reasonably support it. If a baseline cannot support 100k routes, document the failure mode instead of omitting it.

External baseline limits:

- Pin package version and adapter source in the result.
- Timeout: 180s per 100k scenario unless a stricter timeout is documented.
- Memory cap: process RSS must stay below 2 GiB unless the host benchmark profile explicitly allows more.
- Failure classes: `build-timeout`, `first-match-timeout`, `memory-limit`, `unsupported-semantics`, `incorrect-result`, `adapter-error`.
- A baseline that lacks equivalent param/wildcard/method semantics is reported as reference-only for that missing semantic area.

---

## 3. Current Implementation Facts

현재 코드 기준 사실:

- Static routes are compiled into per-method null-proto buckets and looked up by normalized full path. **Method sharding is justified by routing semantics (different methods on the same path), not by raw lookup speed**: §5.3 line 735 measurement shows sharded `32× ~3.1k` is 1.5× slower than unsharded 100k for both object and Map representations due to indexing overhead. The static-table representation itself (object vs `Map<string, number>`) is Provisional pending Phase 5b — see §4 decision-state.
- Dynamic routes are segment tries, not radix trees or char tries.
- Static child lookup inside segment nodes uses null-proto object children.
- Params are recorded into an `Int32Array` offset buffer during traversal.
- Params are materialized by generated factories at return/cache time.
- Method registry already supports custom method names and preserves case-sensitive identity.
- Method registry has a default 32-method limit, which aligns with bitmask-based availability checks. This is a scoped performance cap, not an HTTP standard limit.
- Validation is batch-oriented in `build()` / `seal()`, not fail-fast in `add()`.

Current defects that must be fixed before performance work:

- `optionalParamBehavior` is not passed from `Router` into `Registration.seal()`, so `omit` behavior can be ignored.
- Dynamic match currently calls the params factory twice for one successful dynamic match: once for return params and once for cached params.
- Method token validation is missing. Empty/invalid methods can be registered.
- Registered route path validation is incomplete: query, fragment, control chars, malformed percent escapes, dot segments, and full RFC 3986 path policy are not enforced.
- Static hit cache order is not proven optimal. The current emitted match checks miss/hit cache before static table; static-heavy workloads may prefer static table before hit cache.

---

## 4. Non-Final Areas

아래 항목은 아직 “최고 방법”으로 확정하지 않는다. 반드시 100k end-to-end 재현 후 결정한다.

- 100k hit/miss ns/op: current numbers are cache-hot repeated lookup snapshots, not cold static-table/tree-walk proof.
- Static cache order: static-first is the provisional default; cache-first is allowed only if end-to-end p75/p99 proves it better for the selected workload.
- Static table layout: method-first bucket vs path-first method array.
- Codegen threshold: generated equality / generated walker의 route-count, source-size, compile-time 한계.
- Terminal representation: current terminal arrays vs fast/poly tagged terminal.
- Slash scanning: `indexOf('/')` vs manual scan vs generated scanner.
- Lazy params materialization: API compatibility, allocation, cache behavior를 함께 검증해야 한다.
- Dynamic traversal allocation: current walker still creates segment `substring()` values; removing or accepting this cost must be decided by end-to-end proof.
- Static build/runtime duplication: build-only static structures and runtime static tables may both be retained; this must be measured and compacted if confirmed.
- 100k mixed build bottleneck: wildcard/static conflict validation is a strong root-cause candidate, but phase-level instrumentation must prove it before implementation.
- Perfect hash / bitmap / radix compressed trie: 현재 기본 설계가 아니라 P3 candidate only.
- Strict malformed percent runtime policy: secure/default rejects or no-matches malformed/unsafe encoding; compat may preserve raw pass-through only when explicitly selected.
- Fixed 100k ns/MiB targets: initial target bands are defined below; final release bands must be refreshed from 3-run gate data.

Decision state:

| Area | State | Reason | Next gate |
| --- | --- | --- | --- |
| method dispatch via null-proto object | Confirmed | microbench에서 `Map`/`switch`보다 빠름 | 100k method mix regression |
| method availability via bitmask | Confirmed within <=32 methods | `Set`/bool array보다 빠르고 32-method limit과 일치 | allowed-method/wrong-method tests and explicit >32 failure |
| static full-path object table | Provisional pending Phase 5b | small-key microbench strong (1.12 ns) but §5.3 line 725 shows `Map<string,number>` 1.92× faster at 100k unsharded; §5.4 third re-confirmation | Phase 5b end-to-end measurement on `100k static` |
| dynamic segment trie | Confirmed as baseline | current implementation and semantics fit route grammar | 100k param/wildcard profile |
| full TypedArray/SoA router | Rejected | lookup workload에서 object lookup을 이기지 못함 | reopen only with end-to-end proof |
| `Bun.hash` hot path | Rejected | measured string hash cost too high | none |
| TextEncoder byte routing | Rejected | per-match encode allocation/cost too high | none |
| DataView node table | Rejected | no speed advantage over TypedArray/object path | none |
| open-address child hash | Rejected | object lookup faster in measured fanout | none |
| static-first static lookup | Required default | current code path is being moved to static-first; candidate microbench only selects the candidate, and final adoption still requires fresh-process end-to-end p75/p99 proof | static-heavy + churn benchmark |
| path-first static layout | Candidate | microbench promising, memory shape unproven | end-to-end memory and method semantics |
| terminal tag fast/poly | Candidate | microbench delta small in per-method tree | end-to-end terminal/handler table proof |
| manual slash scan | Candidate | microbench varies by run/path distribution | segment walker end-to-end proof |
| lazy read-only params | Candidate | chosen direction for future allocation reduction; current immediate fix preserves immutable/cache-safe params semantics | correctness + mutation + perf test |
| wildcard conflict index | Required | phase diagnostics and 50k stress identify prefix conflict scanning as the build-time blocker; implementation still must pass 100k gates | Phase 4 RED/GREEN and 100k mixed Guard |
| wildcard/static/wildcard issue-kind symmetry | Required | same collision class must emit the same issue kind regardless of registration order | bidirectional route-unreachable fixtures |
| regex sibling cap | Required | bounded conservative regex disjointness comparisons need `regex-sibling-limit` | 33+ same-segment regex siblings fixture |
| total expansion cap | Required | per-route optional cap alone allows pathological total expanded route count | `expansion-total-limit` fixture |
| compressed dynamic chains | Candidate | memory candidate, not speed baseline | 100k param heap object breakdown |

---

## 5. 100k Reproduction Results

Latest local reproduction commands:

```sh
bun packages/router/bench/100k-verification.ts '100k static'
bun packages/router/bench/100k-verification.ts '100k param'
bun packages/router/bench/100k-verification.ts '100k mixed'
bun packages/router/bench/100k-verification.ts '100k high-fanout'
bun packages/router/bench/100k-verification.ts candidates
bun packages/router/bench/100k-external-baselines.ts <router>
timeout 180s bun packages/router/bench/100k-bun-serve-baseline.ts 100000
```

Scope and trust level:

- These are local single-run snapshots, not the final Verification Gate result.
- `Build` in the tables means `router.add()` for all routes plus `router.build()`, not `build()` alone.
- Build time and memory deltas are useful directionally because route arrays are prepared before router registration/build measurement.
- Memory in single-run snapshot tables is process delta after explicit GC. Memory in fresh-process gate tables is process memory delta parsed from the scenario output and summarized by median.
- Unit rule: benchmark memory output is `bytes / 1024 / 1024`; read historical `MB` labels in this document as MiB. New target tables use `MiB` explicitly. Per-route budgets are bytes/route.
- Hit/miss ns/op values are single-run warmed probe min-max values.
- Hit/miss ns/op values are cache-hot repeated lookups. They do not prove cold static-table, dynamic walker, cache-churn, or first-match latency.
- Param/mixed hit numbers mostly prove cached result retrieval after the first match; they do not prove uncached dynamic traversal or params materialization cost.
- First-match ns is printed by the harness, but the table below does not aggregate it and does not provide p75/p99.
- Memory deltas are process deltas. Final claims require fresh-process 3-run median/p75/p99 and `rss`, `heapUsed`, and `arrayBuffers`.
- `arrayBuffers` is currently omitted from the snapshot table; final gates must include it.
- Current preflight checks only prove hit/miss existence unless a bench explicitly verifies exact value, params, and method semantics.

Current router 100k results:

| Shape | Add+build | Memory delta (MiB-style harness MB) | Single-run warmed hit probe min-max | Single-run warmed miss probe min-max | Verdict |
| --- | ---: | ---: | ---: | ---: | --- |
| 100k static | 307.61 ms | rss +184.45 MB, heap +75.69 MB | 17.66-26.59 ns/op | 15.81-16.64 ns/op | cache-hot match fast; last-route static hit is slower than best static probes; memory acceptable only provisionally |
| 100k param | 795.21 ms | rss +692.66 MB, heap +373.01 MB | 17.07-17.39 ns/op | 15.19-15.94 ns/op | cache-hot match fast, memory too high |
| 100k mixed | 21903.80 ms | rss +390.13 MB, heap +132.75 MB | 17.84-23.41 ns/op | 14.75-15.40 ns/op | cache-hot match fast, build unacceptable |
| 100k high-fanout | 298.12 ms | rss +181.04 MB, heap +79.60 MB | 16.52-23.89 ns/op | 12.10-15.86 ns/op | cache-hot match fast, object lookup directionally holds |

Memory unit note: historical `MB` labels in this table are MiB-style harness output, `bytes / 1024 / 1024`.

External 100k static baselines: static-only, single-run, warmed-loop probe min-max:

| Router | Add+build | Memory delta (MiB-style harness MB) | Single-run warmed hit probe min-max | Single-run warmed miss | Verdict |
| --- | ---: | ---: | ---: | ---: | --- |
| zipbul | 313.63 ms | rss +176.60 MB, heap +40.46 MB | 16.90-21.29 ns/op | 18.60 ns/op | balanced, not fastest static hit |
| rou3 | 181.63 ms | rss +85.62 MB, heap +26.15 MB | 7.12-8.27 ns/op | 62.54 ns/op | static hit faster, miss slower |
| hono-regexp | 94.69 ms | rss +51.41 MB, heap +27.66 MB | 5.38-6.45 ns/op | 33.66 ns/op | static hit faster, but lazy first-match compile and semantic parity must be measured |
| hono-trie | 158.98 ms | rss +90.80 MB, heap +35.27 MB | 116.88-359.15 ns/op | 122.50 ns/op | slower match |
| koa-tree-router | 69.73 ms | rss +55.45 MB, heap +28.04 MB | 73.30-275.75 ns/op | 39.44 ns/op | slower match |
| memoirist | 33460.09 ms | rss +43.35 MB, heap +26.45 MB | 55.29-107.99 ns/op | 33.82 ns/op | build too slow |
| find-my-way | 56856.08 ms | rss +334.93 MB, heap +135.21 MB | 162.98-329.09 ns/op | 104.07 ns/op | build and match too slow |
| URLPattern linear | 831.38 ms | rss +452.08 MB | last-match 103.11 ms/op | not measured | not viable as N-pattern router; unit is ms/op, unlike ns/op rows above |
| Bun.serve routes | build-timeout >180s | route object prep later measured separately | not available | not available | phase split below shows prep completes and `Bun.serve()` init does not complete within the 100k gate |

External baseline caveats:

- The external table is static-only. It must not be generalized to param, wildcard, mixed, or security semantics.
- Adapters must be upgraded to verify exact value, params, wildcard capture, wrong method, and falsy values.
- Lazy-build routers must include first-match compile time/memory or report it as a separate phase.
- `Bun.serve` must be split into route object preparation, `Bun.serve()` initialization, and first request latency before any suitability conclusion.
- `current router` and external `zipbul` memory values are not directly comparable until the harness, import path, GC timing, and route shape are unified.

Candidate reproduction:

| Candidate | Result | Decision |
| --- | ---: | --- |
| method-first static table | 2.63 ns/op | current shape remains viable |
| path-first method array | 1.70 ns/op | must test end-to-end; promising for static table |
| static-first then cache | 3.43 ns/op | likely better than cache-first for static-heavy |
| cache-first then static | 3.80 ns/op | current order may be suboptimal for static-heavy |
| miss-cache check then static | 3.91 ns/op | miss cache before static can hurt static-heavy |
| `indexOf` segment scan | 29.11 ns/op | baseline |
| manual segment scan | 22.97 ns/op | promising but must validate in walker end-to-end |

Facts before implementation:

- Current cache-hot repeated lookup is very fast at 100k for static, param, mixed, and high-fanout shapes.
- Cold static-table path, dynamic walker path, high-cardinality cache churn, and first-match latency are not yet proven by the current 100k numbers.
- 100k param memory is too high and must drive metadata/factory/terminal compaction.
- 100k mixed build time is unacceptable. Wildcard/static conflict validation is a strong candidate root cause, but phase instrumentation must prove it.
- Static-only hit is not best-in-class; `rou3` and `hono-regexp` are faster on static hit, so static table layout/order is a real optimization target.
- URLPattern linear scanning is not a suitable N-pattern replacement in this harness. Bun native routes remain inconclusive until phase split is measured.

### 5.1. Implementation Feasibility Reproduction

These checks were run after the initial document review to decide whether the plan is implementable or still speculative.

Commands:

```sh
bun packages/router/bench/100k-verification.ts '100k versioned-api'
bun packages/router/bench/100k-verification.ts '100k wildcard-heavy'
bun packages/router/bench/100k-gate-runner.ts
bun packages/router/bench/100k-verification.ts wildcard-conflict-feasibility
bun -e "<secure-validation-red-check>"
bun -e "<optional-param-red-check>"
bun -e "<params-cache-mutation-check>"
```

100k added scenario results:

| Shape | Add+build | Memory delta (MiB-style harness MB) | First hit range | Warmed hit probe min-max | Warmed miss probe min-max | Verdict |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 100k versioned-api | 1066.19 ms | rss +532.89 MB, heap +125.22 MB, arrayBuffers +0.00 MB | 56.51-348.28 us | 18.48-24.39 ns/op | 15.58-18.29 ns/op | feasible, build above Aggressive target, first-hit must be profiled |
| 100k wildcard-heavy | 546.06 ms | rss +424.37 MB, heap +196.13 MB, arrayBuffers +0.00 MB | 37.34-346.27 us | 17.71-18.49 ns/op | 15.81-16.50 ns/op | feasible, memory high, first-hit must be profiled |

Wildcard/static conflict scaling:

| Wildcards | Statics | Routes | Add+build | Verdict |
| ---: | ---: | ---: | ---: | --- |
| 1,000 | 1,000 | 2,000 | 84.12 ms | acceptable |
| 5,000 | 5,000 | 10,000 | 1062.14 ms | already high |
| 10,000 | 10,000 | 20,000 | 4096.85 ms | superlinear bottleneck reproduced |
| 25,000 | 25,000 | 50,000 | 26280.32 ms | unacceptable |

Interpretation:

- `100k versioned-api` and `100k wildcard-heavy` are feasible to build and match in the current architecture.
- The required 100k scenario coverage gap is now closed in the local harness, but the results are still single-run snapshots.
- Disjoint wildcard/static scaling reproduces the same class of build blow-up as `100k mixed`. The wildcard conflict index/trie is no longer a speculative idea; it is the primary build-feasibility fix to implement and verify.
- The conflict scaling check is not a full phase profiler. Final approval still requires internal phase timers around parse, optional expansion, static insert, dynamic insert, wildcard conflict check, snapshot build, and codegen.

Fresh-process 30-run gate (RUNS=30, sample of 30 fresh `bun` processes per scenario, true median/p75/p99 from sorted distribution):

| Shape | Build median / p75 / p99 | RSS median | Heap median | First median / p75 / p99 | Warmed hit median / p75 / p99 | Warmed miss median / p75 / p99 | Target interpretation |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 100k static | 247.87 / 254.74 / 265.65 ms | 223.56 MiB | 90.30 MiB | 25,050 / 174,851 / 222,012 ns | 19.17 / 24.24 / 37.11 ns | 16.25 / 16.84 / 18.74 ns | build passes Aggressive (250 ms p75) but p99 fails; warmed hit p99 passes Aggressive; first-match p99 fails Guard 10us by 22x |
| 100k param | 586.56 / 598.10 / 636.15 ms | 698.45 MiB | 126.20 MiB | 51,523 / 338,554 / 488,041 ns | 18.65 / 19.12 / 21.69 ns | 16.44 / 16.97 / 22.65 ns | build passes Aggressive; RSS fails Guard 390.63 MiB by 1.79x; warmed hit p99 passes Stretch; first-match p99 fails Guard by 49x |
| 100k mixed | 20,993.67 / 21,186.12 / 23,715.17 ms | 486.32 MiB | 163.84 MiB | 193,929 / 215,303 / 286,707 ns | 18.92 / 20.71 / 22.63 ns | 15.08 / 15.69 / 17.73 ns | build fails Guard 3000 ms by 7.9x at p99; RSS fails Guard by 1.24x; warmed hit p99 passes Stretch; first-match p99 fails Guard by 29x |
| 100k high-fanout | 263.30 / 267.49 / 285.74 ms | 209.68 MiB | 90.09 MiB | 31,779 / 172,213 / 302,059 ns | 18.80 / 30.25 / 50.31 ns | 16.28 / 17.11 / 24.04 ns | build passes Aggressive at median, p99 just fails; RSS passes Aggressive; warmed hit p99 passes Aggressive only; first-match p99 fails Guard by 30x |
| 100k versioned-api | 741.51 / 761.11 / 787.60 ms | 475.50 MiB | 172.33 MiB | 97,013 / 333,336 / 432,776 ns | 20.42 / 23.12 / 26.63 ns | 16.97 / 18.28 / 19.64 ns | build passes Aggressive 750 ms median, p99 fails; RSS fails Guard; warmed hit p99 passes Aggressive; first-match p99 fails Guard by 43x |
| 100k wildcard-heavy | 464.76 / 473.63 / 490.35 ms | 428.79 MiB | 193.90 MiB | 88,093 / 329,905 / 480,246 ns | 18.12 / 18.52 / 19.99 ns | 16.49 / 16.98 / 19.30 ns | build passes Aggressive; RSS fails Guard; warmed hit p99 passes Stretch; first-match p99 fails Guard by 48x |

Interpretation:

- The 30-run fresh-process gate is now executed for all six required 100k shapes (`static`, `param`, `mixed`, `high-fanout`, `versioned-api`, `wildcard-heavy`); `bun packages/router/bench/100k-gate-runner.ts` defaults to all six and `RUNS` env var controls the sample count.
- p99 is now a true 30-sample percentile rather than the prior `max-of-3` proxy; this removes the §14.3 line 670 "tail latency excellence not proven" caveat at the partial-gate level for these six shapes.
- `100k mixed` build p99 is the dominant remaining failure; it is gated by the static/wildcard conflict scan documented at lines 425–441 and is the primary target of §13 Phase 4.
- `100k param` RSS p99 stays at 698.45 MiB, gated by segment node / terminal slot count documented at lines 466–478 and is the primary target of §13 Phase 7.
- First-match p99 fails Guard 10 us across all shapes by 22x to 49x; this is the primary target of §13 Phase 6 codegen preflight + warmup strategy.
- Warmed hit/miss p99 already meets Aggressive everywhere and Stretch on `mixed`, `param`, `wildcard-heavy`; primitive selection (object lookup, bitmask, offset params) is empirically validated.

Earlier 3-run partial gate (preserved for traceability):

| Shape | Build median / p75 / p99 (3-run, p99=max) | RSS median | Heap median | First p99 | Warmed hit p99 | Warmed miss p99 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 100k static | 271.80 / 291.89 / 291.89 ms | 220.06 MiB | 92.98 MiB | 206.11 us | 33.75 ns | 18.26 ns |
| 100k param | 589.34 / 674.47 / 674.47 ms | 688.91 MiB | 128.82 MiB | 370.93 us | 19.39 ns | 17.31 ns |
| 100k high-fanout | 246.64 / 255.55 / 255.55 ms | 210.07 MiB | 87.92 MiB | 203.65 us | 29.77 ns | 16.83 ns |
| 100k versioned-api | 790.79 / 867.14 / 867.14 ms | 473.83 MiB | 171.57 MiB | 364.68 us | 27.54 ns | 19.61 ns |
| 100k wildcard-heavy | 466.68 / 537.27 / 537.27 ms | 426.41 MiB | 200.28 MiB | 376.63 us | 18.51 ns | 17.47 ns |

The 3-run row values agree with 30-run medians within 1–4% drift, confirming sample stability across run counts. `100k mixed` is now also covered by the 30-run gate (was missing from the 3-run table).

Correctness RED checks:

| Check | Current result | Verdict |
| --- | --- | --- |
| empty method | accepted | defect reproduced |
| space method `GET POST` | accepted | defect reproduced |
| registration query `/a?b` | accepted | defect reproduced |
| registration fragment `/a#b` | accepted | defect reproduced |
| registration control char | accepted | defect reproduced |
| registration dot segment `/a/../b` | accepted | defect reproduced |
| malformed percent `/a/%ZZ` | accepted | defect reproduced |
| `optionalParamBehavior: 'omit'` missing key | returns `id: undefined` | defect reproduced |
| params mutation then same-path match | second match returns original param and `sameParams=false` | current cache-safe semantics confirmed |

Implementation readiness after feasibility checks:

- Implementation-ready: optional behavior pass-through, method token validation, registration path validation, wildcard conflict index/trie, params factory double-call removal with cache-safe params semantics.
- Gate-evolved: §5.1 fresh-process **30-run** gate now covers all six required shapes including `100k mixed` (default scenario list updated in `packages/router/bench/100k-gate-runner.ts`); the earlier 3-run table is preserved for traceability with 1–4% drift vs 30-run medians.
- Evidence-confirmed: exact internal 100k mixed phase timers confirm wildcard/static conflict scan as the dominant build bottleneck.
- Evidence-confirmed: codegen telemetry confirms oversized source is generated before source-budget bail.
- Evidence-confirmed: cache traversal probes, dynamic external baselines, Bun.serve 10k/100k phase split, Bun heap profile attempt, and 100k param internal object counters have been run.
- Remaining truth boundary: full byte-accurate RSS attribution is not available from Bun heap snapshots. Optimization must be driven by measured internal object counters, fresh-process RSS gates, and before/after deltas.

Additional pre-implementation measurements:

Mixed phase proxy:

| Proxy shape | Routes | Add+build | Interpretation |
| --- | ---: | ---: | --- |
| mixed static-only | 25,000 | 65.55 ms | cheap alone |
| mixed GET param-only | 25,000 | 121.38 ms | cheap alone |
| mixed POST param-only | 25,000 | 84.26 ms | cheap alone |
| mixed wildcard-only | 25,000 | 82.14 ms | cheap alone |
| full 100k mixed | 100,000 | 38697.61 ms | blow-up appears only when shapes interact |

Interpretation:

- Full mixed build cost is not explained by individual shape insertion cost.
- The interaction pattern strongly supports wildcard/static conflict scanning as the dominant pre-implementation bottleneck.
- Internal diagnostics confirmed the same conclusion: full 100k mixed spent `39191.62 ms` in static/wildcard conflict checks, with `312,487,500` wildcard prefix scans.
- Wildcard conflict index implementation is now mandatory before broader build refactors.
- Current-router snapshot row above is a single-run non-diagnostics scenario. The 3-run table below is the same harness repeated. The internal diagnostics table is a separate instrumentation run and is intentionally slower.

100k mixed same-harness 3-run closure:

| Run | Add+build | RSS delta | Heap delta | First-hit max | Warmed hit max | Miss max |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 21263.44 ms | +480.14 MiB | +176.20 MiB | 259.40 us | 18.85 ns/op | 13.83 ns/op |
| 2 | 20934.73 ms | +478.77 MiB | +166.17 MiB | 207.49 us | 18.91 ns/op | 13.39 ns/op |
| 3 | 21330.79 ms | +476.19 MiB | +166.90 MiB | 274.15 us | 19.18 ns/op | 15.13 ns/op |

Interpretation:

- Same-harness 100k mixed build is stable around 21 seconds and fails the 3,000 ms Guard by roughly 7x.
- The 38.7-40.3 second measurements are diagnostics/proxy runs with additional instrumentation and must not be mixed into the same statistical row.
- The phase timer still proves the same root cause under diagnostics: static/wildcard conflict scanning dominates the inflated diagnostic run.

Internal mixed diagnostics:

| Metric | 100k mixed |
| --- | ---: |
| total add+build | 40263.41 ms |
| parse | 331.10 ms |
| wildcard name conflict | 53.19 ms |
| static/wildcard conflict | 39191.62 ms |
| static insert | 77.73 ms |
| optional expansion | 11.22 ms |
| dynamic insert | 167.62 ms |
| factory generation | 48.06 ms |
| snapshot | 11.24 ms |
| wildcard conflict checks | 24,999 |
| wildcard prefix scans | 312,487,500 |

Diagnostics residual note: listed phase timers account for the dominant measured phases, but their sum does not equal total add+build. The residual includes loop overhead, diagnostics accounting overhead, codegen/snapshot-adjacent work not separately listed, and general runtime/GC noise.

Cache and traversal feasibility:

| Probe | Result | Interpretation |
| --- | ---: | --- |
| cache-hot dynamic same path | 18.15 ns/op | cache retrieval is excellent |
| cache-churn dynamic unique-ish | 1090.62 ns/op | uncached/churn dynamic traversal is much slower than hot-loop values |
| wrong-method dynamic unique-ish | 396.23 ns/op | wrong-method path needs separate gate |
| 404 dynamic unique-ish | 551.66 ns/op | 404 path needs separate gate |

Heap profile attempt:

| Probe | Result |
| --- | --- |
| `bun --heap-prof 100k param` | heap snapshot generated |
| scenario memory | rss +687.48 MB, heap +125.20 MB |
| heap snapshot size | 368 KB |
| heap snapshot total self size | 1.19 MB |
| top self-size type | `code` 824,860 bytes |

Interpretation:

- Bun heap snapshot did not explain the 687 MB RSS delta.
- RSS/object attribution remains unresolved and requires additional instrumentation beyond the current heap snapshot, such as internal object counters and retained structure accounting.
- Internal diagnostics narrow the `100k param` retained-structure candidate set: `500,001` segment nodes, `200,001` static child maps, `200,000` param nodes, `100,000` terminals, and `100,000` terminal params-factory slots.
- A corrected diagnostic run showed only `1` unique params factory function for the `100k param` shape. Therefore "100,000 params factories" is false for this shape; the memory target is the terminal slot array and segment tree objects, not duplicated factory functions.
- The next memory implementation must start with segment tree/terminal-slot compaction, not generic RSS guessing.

100k param internal diagnostics:

| Metric | Value |
| --- | ---: |
| routes | 100,000 |
| segment nodes | 500,001 |
| static child maps | 200,001 |
| param nodes | 200,000 |
| terminals | 100,000 |
| params factory slots | 100,000 |
| unique params factory functions | 1 |
| parse | 174.38 ms |
| dynamic insert | 128.47 ms |
| factory generation | 35.56 ms |

Dynamic external baselines:

| Router | Scenario | Build | RSS delta | Hit latency | Miss latency | Verdict |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| zipbul current | 100k param | 863.79 ms | +679.93 MB | 18.16-19.34 ns/op | 17.68 ns/op | fastest warmed match in this dynamic external table; high RSS and first-match/profile gates still block approval |
| rou3 | 100k param | 121.24 ms | +115.88 MB | 126.21-145.12 ns/op | 68.15 ns/op | much lower build/RSS, slower match |
| hono-trie | 100k param | 207.73 ms | +215.83 MB | 422.88-683.47 ns/op | 106.58 ns/op | lower build/RSS, much slower match |
| memoirist | 100k param | 64648.37 ms | +87.52 MB | 72.05-118.63 ns/op | 29.12 ns/op | low RSS, build too slow |
| koa-tree-router | 100k param | 128.49 ms | +175.33 MB | 266.78-456.98 ns/op | 70.33 ns/op | lower build/RSS, slower match |
| hono-regexp | 100k param | failed | +51.47 MB before first match | n/a | n/a | first match throws `SyntaxError: Invalid regular expression: regular expression too large` |
| find-my-way | 100k param | >120s timeout | n/a | n/a | n/a | build did not complete within the stricter per-run timeout; external baseline policy allows up to 180s |

Interpretation:

- Current zipbul's warmed dynamic match latency is externally competitive, but RSS is not.
- External routers prove the 100k param memory target can be far below current zipbul's RSS, but their warmed match/build trade-offs differ.
- The implementation target is therefore not a full algorithm replacement by a generic external shape. It is segment/terminal memory compaction while preserving the current cache-hot match path.

Codegen diagnostics:

| Shape | Event | Source generated before bail | Emit time | Interpretation |
| --- | --- | ---: | ---: | --- |
| 100k param | source-budget bail | 124,733,430 chars | 271.48 ms | preflight is mandatory |
| 100k wildcard-heavy | source-budget bail | 72,436,417 chars | 116.14 ms | preflight is mandatory |
| 100k versioned-api | source-budget bail x4 | ~19,486,210 chars per method | 57.84-82.54 ms per method | preflight is mandatory |

Interpretation:

- Current codegen pays large source construction cost before rejecting oversized walkers.
- Codegen preflight must estimate size before source generation, not after.

Bun.serve phase split:

| Routes | Route object prep | `Bun.serve()` init | Memory delta (MiB-style harness MB) | Request latency | Verdict |
| ---: | ---: | ---: | ---: | ---: | --- |
| 10,000 | 6.31 ms | 13377.53 ms | rss +59.90 MB, heap +4.15 MB | 173.99-249.73 us/request | init already too slow at 10k |
| 100,000 | 60.27 ms | build-timeout >180s | prep-only rss +64.88 MB, heap +28.39 MB | n/a | prep completes; init does not complete within gate |

Interpretation:

- Native `Bun.serve({ routes })` is not a viable replacement for this in-process 100k router profile unless Bun native route initialization changes substantially.
- The 100k phase split confirms route object preparation is not the blocker. Because init never completed, the claim is limited to "init phase did not complete within the gate"; no init-internal memory/phase breakdown is available.

Pre-implementation closure:

| Check | Result | Decision |
| --- | --- | --- |
| `bun test` | 557 pass, 5 fail | RED confirmed before implementation |
| optional omit tests | 4 failures return missing optional as `undefined` | implementation must fix optional omit pass-through/cache behavior |
| perf guard internal snapshot test | `snapshot.terminals` is undefined | test is stale against current snapshot shape and must be corrected to the real terminal metadata field |
| `bun run build` | failed | current source has build-blocking type errors before optimization work |
| build failure class | `MatchFn` is imported from `match-state` but not exported; `segment-compile.ts` also has a `string | undefined` argument error | fix type/export boundary before final green gate |

Closure decision:

- Pre-implementation feasibility checks are closed enough to start implementation.
- "Perfect optimization" is not claimed. The bounded facts are: warmed match is already strong, RSS/build have measured bottlenecks, native `Bun.serve` is not viable for 100k in this profile, and the first implementation pass must be RED-GREEN against the listed defects and gates.
- Every optimization must re-run the 100k fresh-process gate and compare build time, RSS, first-match, warmed hit, miss, wrong-method, and cache-churn numbers before being accepted.

Review closure log:

| Review issue | Closure |
| --- | --- |
| MB/MiB ambiguity | Memory target equivalents now use `MiB`; historical harness `MB` labels are defined as MiB-style output. |
| `Ready` ambiguity | Split into `Implementation-ready`, `Gate-partial`, and `Evidence-confirmed`. |
| Missing 100k mixed 3-run | Same-harness 3-run added; diagnostics/proxy runs are explicitly separated from statistical rows. |
| Wildcard 10x target missing derivation | 10x is derived from `26280.32 / 3000 = 8.76x` plus validation/snapshot headroom; this is a best-case proxy because the 50k disjoint stress and 100k mixed Guard are different workloads. |
| Regex disjointness undefined | Secure/default uses conservative AST-only disjointness; unknown overlap rejects. |
| Numeric regex range disjointness underspecified | Numeric range disjointness is explicitly unsupported until a dedicated range parser spec exists. |
| `?` query vs optional decorator ambiguity | Registration parse order and boundary fixtures are specified. |
| Codegen compile-time gate ambiguity | Preflight hard gates and post-compile observed telemetry gates are separated. |
| 32-method limit justification | Defined as a scoped bitmask performance cap with explicit `method-limit` failure and enterprise scope `<= 32` methods. |
| 64+ method support question | Added as a P3 measured fallback candidate using two `Uint32` masks, `BigInt`, or sparse method table. |
| HEAD/OPTIONS standards caveat | Router-layer no-fallback policy now states that service-layer HEAD/OPTIONS behavior remains application/server responsibility. |
| code-cache pressure proxy undefined | Proxy is defined as generated function count, source bytes, compile wall time, first-call latency, RSS delta, and profiling symptoms; not byte-accurate JSC code-cache occupancy. |
| RSS attribution gap | Byte-accurate RSS attribution remains unavailable from Bun heap snapshots; implementation acceptance uses internal object counters plus fresh-process before/after RSS deltas. |
| versioned-api/wildcard-heavy target gaps | Dedicated planning bands and final gate rows added. |
| strict `?`/`#` delimiter policy | Runtime normalization now uses secure raw-`#` no-match and first-`?` query stripping. |
| percent-decoding completeness | Single-decode/no-double-decode, overlong UTF-8 rejection, and mixed-case dot fixtures added. |
| Phase 4 prefix-index spec gap | Prefix trie counters, regex sibling policy, complexity caveats, and pseudocode added. |
| Phase 5 RED benchmark wording | Microbench row is candidate-selection evidence only; default adoption requires fresh-process end-to-end proof. |
| maxExpandedRoutes surface wiring | Added to hard limits, options schema, defaults, Infinity rejection, issue kinds, and Phase 4 enforcement (see §7.2 security/options and §13 Phase 4 pseudocode). |
| Match phase normalization sync | Section 9.2 and Phase 2 now mirror the section 7.2 path-policy ordering. |
| Phase 4 route mutation contract | Pseudocode now validates with a staging plan before committing trie mutations for a route (see §13 Phase 4 `validateExpandedRoute`/`commitExpandedRoute`). |
| RFC by-number traceability | Added RFC 3986 §3.3/§3.5/§6.2.2.1 and RFC 3629 §3/§10 citations. |
| Wildcard/static issue-kind symmetry | Same collision class must emit the same issue kind regardless of registration order; wildcard/static reachability emits `route-unreachable`. |
| Regex sibling release gate | `maxRegexSiblingsPerSegment` is included in target bands and correctness gate fixtures. |
| Regex-sibling RED/GREEN audit | `regex-sibling-limit` has dedicated issue kind, RED fixture, GREEN criterion, target band, and correctness gate entry (see §7 issue kinds, §13 Phase 4 RED/GREEN, §14.2). |
| Phase 4 control-flow cleanup | Dead-store/redundant pseudocode issues were removed through staged validation and commit-only mutation (see §13 Phase 4 `planEdge` and `commitEdge`). |
| Subtree wildcard self-count audit | `subtreeWildcardCount` prose now matches the ancestor-inclusive commit loop (see §13 Phase 4 algorithm and `commitExpandedRoute`). |
| Phase 2 scanner mirror | Phase 2 now uses the same six-step normalization wording as section 7.2. |
| Subtree wildcard prose precision | Clarified that the prefix attachment node, not a separate wildcard node, receives `subtreeWildcardCount++`. |
| §8.6 wildcard/regex/expansion policy rows | Added wildcard/static, wildcard/wildcard, regex-sibling, and expansion-total rows to the conflict policy table. |
| Wildcard/wildcard issue-kind rationale | Documented `route-unreachable` because the later wildcard is fully covered by the prior wildcard's suffix space. |
| Param-child duplicate wording | Replaced ambiguous duplicate/conflict wording with explicit `route-duplicate`. |
| Expansion counter lifetime | `totalExpandedRoutes` is specified as a per-build/seal batch counter initialized to 0 before validating pending routes. |
| Phase 4 helper contracts | Added `createNode`, `createRegexNode`, `rootFor`, `safeRegexDisjoint`, `sameRegexAst`, `optionalExpansions`, and `sameTerminalIdentity` contracts. |
| Phase 4 node metadata | Added `regexAst` and `terminalMeta` to make regex conflict checks and terminal alias diagnostics implementable from the spec. |
| Cache/options defaults | Added `cacheSize`, `optionalParamBehavior`, `path-encoded-control`, and `option-invalid` surfaces across schema/defaults/issues/gates. |
| Expansion cap enforcement | Added per-route `maxOptionalExpansions` and global `maxExpandedRoutes` pseudocode emit sites. |
| Alias-terminal handling | Same terminal identity now aliases successfully instead of emitting `route-duplicate`; differing identity emits `route-conflict`. |
| Alias context guard | Alias success is limited to optional-expansion routes; ordinary duplicate `add()` still emits `route-duplicate`. |
| Regex same-AST child reuse | Same-position regex params with identical safe-regex AST merge as the same regex child before disjointness checks. |
| Runtime safety policy | Added runtime regex sibling priority, build/seal concurrency policy, immutable-snapshot concurrent match policy, and §14.2 fixtures. |
| §0 implementation language scope | TypeScript only on Bun JSC explicitly stated; WASM, native bindings, cross-runtime targets removed from candidate set. |
| §5.2 Profile Gate executed | `bun --cpu-prof` (mixed `checkStaticWildcardConflict` 91.12%), `bun --heap-prof` (1.19 MiB exposed of ~700 MiB RSS), JSC shape stability, freeze/clone, `new Function` telemetry, perfect hash POC — all six executed and inlined. |
| §5.3 Tier-1 re-verification | mitata + `do_not_optimize` re-runs confirm Map 1.99× faster, freeze 6.1× slower, clone-on-hit preferred at ≥5 keys, first-call median 221 ns at 16 nodes (1차 27 us는 instrumentation noise — superseded). |
| §5.4 Tier-2 follow-ups | Cuckoo hash + sealed/frozen + realistic walker measured. Cuckoo REJECT (2.8× slower under TS scope), sealed/frozen no measurable benefit, realistic walker 184.94 ns reference. |
| Phase 3 lock-in | clone-on-hit (spread) chosen; Object.freeze rejected. §13 Phase 3 line 1834 and §8.3 line 1324 updated. |
| Phase 4b/4c/5b added | New Phase 4b (segment-tree insertion for wildcard-heavy), Phase 4c (compileStaticRoute for high-fanout), Phase 5b (object vs Map static-table representation) inserted in §13. |
| Phase 6 algorithm revised | Codegen budget tightened to ≤16 nodes (p99) / ≤32 (p75 with warmup) per §5.3 D; build-time first-call warmup + iterative fallback locked. |
| §10 Cuckoo / Bun.hash REJECT | Both perfect-hash variants under TS scope empirically rejected; §10 prose updated. |

### 5.2. Pre-implementation Profile Gate (§14.5 verification, executed)

Six §14.5-required investigations were executed before any §13 implementation work. Scripts and outputs are reproducible:

```sh
bun --cpu-prof packages/router/bench/100k-verification.ts '100k mixed'
bun --heap-prof packages/router/bench/100k-verification.ts '100k param'
bun packages/router/bench/jsc-shape-stability.ts
bun packages/router/bench/freeze-vs-clone.ts
bun packages/router/bench/new-function-telemetry.ts
bun packages/router/bench/perfect-hash-poc.ts
```

**1. CPU profile of `100k mixed` (`bun --cpu-prof`)**:

| Top function | Samples | Share |
| --- | ---: | ---: |
| `checkStaticWildcardConflict` (`pipeline/registration.ts`) | 18,391 / 20,183 | **91.12%** |
| `next` | 794 | 3.93% |
| `insertIntoSegmentTree` | 116 | 0.57% |
| `stringSplitFast` | 113 | 0.56% |
| `gc` | 82 | 0.41% |

The static/wildcard conflict scan dominates 91.12% of CPU time, confirming the §5.1 line 425–441 phase timer (39,191 ms / 312,487,500 scans) at the sample level. §13 Phase 4 wildcard prefix index is the correct target.

**2. Heap profile of `100k param` (`bun --heap-prof`)**:

| Top heap type | Self size | Share of dumped heap |
| --- | ---: | ---: |
| `code:FunctionCodeBlock` | 565 KiB | 46.57% |
| `object:ModuleRecord` | 123 KiB | 10.11% |
| `object shape:Structure` | 96 KiB | 7.88% |
| Total dumped heap | **1.19 MiB** | 100% |

Bun heap snapshot exposes only 1.19 MiB out of the ~700 MiB process RSS for this scenario, confirming §5.1 line 387 truth boundary: byte-accurate RSS attribution is not available from Bun heap snapshots. The dumped heap shows JSC metadata (code blocks, structures), not user object payload. Internal object counters (segment nodes, terminal slots, factories) remain the authoritative attribution path.

**3. JSC object shape / dictionary-mode evidence (`jsc-shape-stability.ts`)**:

| Probe | ns/op |
| --- | ---: |
| sealed null-proto, 100k keys lookup | 27.93 |
| dictionary-mode null-proto (post mutation) | 27.31 |
| `Map<string, number>` 100k get | 26.68 |
| small null-proto, 4 keys (IC fast path) | 3.27 |
| null-proto MISS lookup, 100k sealed | 11.25 |
| 200-key structure transition (avg / max) | 441 / 5,584 ns |

The §1 microbench "object lookup 1.12 ns" is valid for **small key sets where JSC inline cache (IC) succeeds**. At 100k keys the IC fast path is replaced by hash table lookup at ~27 ns, and `Map<string, number>` is essentially equivalent (26.68 ns). Method dispatch (≤32 keys) and segment-trie child lookup (small fanout per node) retain the 1.12 ns IC fast path. Static full-path tables at 100k benefit only marginally over `Map`, and the dictionary-mode penalty after key churn is negligible (27.31 vs 27.93).

**4. `Object.freeze` vs clone-on-hit cost (`freeze-vs-clone.ts`)**:

| Option | ns/op | Notes |
| --- | ---: | --- |
| Fresh object literal `{...}` | 6.63 | factory baseline |
| `Object.freeze({...})` per call | **40.76** | 6.1× slower — reject for hot path |
| Clone-on-hit (spread `{...cached}`) | **12.77** | 1.93× slower — viable |
| Proxy wrapper per call | 23.41 | 3.5× slower |
| Read frozen `.id` | 2.14 | reading a frozen object is free |
| Read mutable `.id` | 2.64 | reading a mutable object is free |
| substring materialize from Int32Array offsets | 26.55 | factory step (2 params) |
| substring + `Object.freeze` | 58.95 | 2.2× over plain factory |

**Phase 3 decision locked**: cache-safe params semantics use **clone-on-cache-hit (spread)**, not `Object.freeze`. `Object.freeze` is rejected on the hot path due to 6.1× per-call cost. This supersedes the §13 Phase 3 line 1389 "frozen cached params or clone-on-cache-hit" two-option choice.

**5. `new Function` compile/first-call/code-cache pressure (`new-function-telemetry.ts`)**:

| Walker nodes | Source size | Compile time | First-call | Warmed | Notes |
| ---: | ---: | ---: | ---: | ---: | --- |
| 16 | 1.1 KiB | 0.02 ms | **27 us** | 60 ns | first-call already exceeds Guard 10 us |
| 64 | 4.2 KiB | 0.11 ms | **97 us** | 100 ns | 9.7× over Guard |
| 256 | 16.9 KiB | 0.18 ms | **350 us** | 429 ns | 35× over Guard |
| 1,024 | 67.9 KiB | 0.43 ms | **1,276 us** | 1,742 ns | 127× over Guard |
| 4,096 | 277.9 KiB | 1.34 ms | **6,144 us** | 20,622 ns | 614× over Guard |
| Code-cache pressure proxy: 200 functions × 64 nodes | | | | | RSS delta +192 KiB total, **0.96 KiB/function** |

`new Function` compile time itself is cheap (≤1.34 ms even at 4,096 nodes), but the **first-call latency is dominated by JIT tier-up and exceeds the §6 Guard `first-match p99 ≤ 10 us` for every walker size**. Even a 16-node walker costs 27 us first-call.

**Phase 6 implication — Guard re-derivation required**: the §6 line 642 first-match Guard `<= 10 us` is unattainable by codegen alone. The viable strategies are (a) build-time first-call warmup that triggers JIT tier-up before the router is exposed to user traffic, (b) iterative non-codegen fallback for first-match path, or (c) a combined approach where codegen produces only the warmed hot path and an iterative walker serves first-match. Code-cache pressure at 0.96 KiB/function × 32 methods = ~30 KiB total; this is not a real budget concern.

**6. Perfect hash + build-time `Bun.hash` POC (`perfect-hash-poc.ts`)**:

| Option (100k key set) | Lookup ns/op | Build ns/key | Verdict |
| --- | ---: | ---: | --- |
| null-proto object | 27.58 | 72.68 | baseline |
| `Bun.hash` + open-address `Int32Array` | **113.69** | 112.95 | **4.1× slower lookup → reject perfect-hash candidate** |
| **`Map<string, number>`** | **15.53** | n/a | **1.78× faster lookup at 100k full-path scale** |

The §10 line 1230 P3 "perfect hash" candidate is now empirically rejected: build-time `Bun.hash` plus open-address scan is 4.1× slower at lookup than the current null-proto object table. Build-time hash construction also costs 1.5× more than building the object table (113 vs 73 ns/key).

**Surprise finding**: `Map<string, number>` is 1.78× faster than the null-proto object at the 100k full-path scale. This contradicts the §1 line 65 "direct object static hit 3.44 ns/op" generalization for large maps. The §1 microbench reflects small key sets where JSC IC succeeds; at 100k keys, V8/JSC `Map` implementations win due to specialized hash table internals. Method-first sharding currently keeps each per-method bucket smaller (~3,125 routes per method on a balanced 32-method workload), where the gap may narrow, but the static table representation deserves a measured Phase 5b experiment: `per-method null-proto object` vs `per-method Map<string, number>` end-to-end on `100k static`.

**Profile gate closure**:

- §14.5 line 2155 `bun --cpu-prof`: executed.
- §14.5 line 2155 `bun --heap-prof`: executed; truth boundary reaffirmed.
- §14.5 line 2168 JSC object shape evidence: executed; `1.12 ns` claim scoped to small key sets.
- §14.5 line 2169 100k static buckets property lookup stability: executed; `Map` is 1.78× faster, demands Phase 5b decision.
- §14.5 line 2170 `Object.freeze` vs clone cost: executed; `clone-on-hit` locked for Phase 3.
- §14.5 line 2171 `new Function` compile/first-call/code-cache: executed; Phase 6 Guard requires non-codegen path or warmup.

### 5.3. Tier-1 follow-up re-verification (mitata + dead-code-elim guard + distributions + variants)

The §5.2 single-run microbench results were re-verified through six follow-ups using `mitata` for statistical accuracy, `do_not_optimize` to defeat dead-code elimination, and 100-sample distributions for tail behavior. New scripts: `bench/static-table-rerun.ts`, `bench/first-call-distribution.ts`, `bench/shape-and-freeze-variants.ts`.

**B + A. `Map` vs null-proto object at 100k full-path scale (mitata, do_not_optimize, sharded and adversarial variants)**:

| Probe | ns/iter (median) | p75 |
| --- | ---: | ---: |
| null-proto object 100k | 27.71 | 28.73 |
| sealed null-proto object 100k | 27.95 | 28.97 |
| **`Map<string, number>` 100k** | **13.87** | 17.23 |
| sharded null-proto (32× ~3.1k) | 42.41 | 45.69 |
| sharded `Map` (32× ~3.1k) | 25.11 | 29.13 |
| collision-prone object (long shared prefix) | 33.89 | 34.80 |
| collision-prone `Map` (long shared prefix) | 25.69 | 30.19 |
| null-proto MISS (100k sealed) | 7.17 | 7.07 |
| `Map` MISS (100k) | 8.63 | 8.54 |

The §5.2 finding holds and is strengthened: **`Map<string, number>` is 1.99× faster than null-proto object at 100k full-path scale** even with `do_not_optimize` defeating dead-code elimination. `Map` retains 1.32–1.90× advantage across diverse key distributions (short/long/shared-prefix/numeric/mixed-case). The dead-code-elimination suspicion is rejected.

**Sharded vs unsharded surprise**: sharding into 32 buckets of ~3,125 keys each is **slower than the unsharded 100k table** (42 vs 28 ns for object, 25 vs 14 ns for `Map`). Indexing overhead (`i % SHARDS` + double dereference) outweighs the per-bucket IC benefit at this scale. This contradicts the §3 line 162 "Static routes are compiled into per-method null-proto buckets" assumption that method sharding alone improves lookup; the sharding is justified for routing semantics (different methods on the same path) but not for raw lookup speed.

**MISS path**: null-proto object MISS (7.17 ns) is faster than `Map` MISS (8.63 ns). On a hot path with high miss rate, object retains a small edge.

**E. JSC shape stability across diverse key distributions (`shape-and-freeze-variants.ts`)**:

| Pattern | object 100k | Map 100k | Map advantage |
| --- | ---: | ---: | ---: |
| short | 27.08 | 12.73 | 2.13× |
| long | 31.92 | 24.17 | 1.32× |
| shared-prefix | 32.46 | 17.98 | 1.81× |
| numeric | 29.41 | 15.50 | 1.90× |
| mixed-case | 33.04 | 19.04 | 1.74× |

Map advantage is robust across 5 key patterns (short, long, shared-prefix, numeric, mixed-case): 1.32× minimum, 2.13× maximum. The object representation does not degrade catastrophically on any pattern, but it is consistently slower than `Map` at this scale.

**F. `Object.freeze` vs clone-on-hit with varying param count (`shape-and-freeze-variants.ts`)**:

| Param count | fresh factory | `Object.freeze({...})` | clone-on-hit (spread) | clone vs fresh |
| ---: | ---: | ---: | ---: | ---: |
| 2 | 11.90 ns | 44.42 ns | 14.11 ns | 1.19× slower |
| 5 | 21.47 ns | 56.99 ns | 14.90 ns | **0.69× — faster than fresh** |
| 10 | 41.36 ns | 80.57 ns | 21.90 ns | **0.53×** |
| 20 | 88.56 ns | 137.43 ns | 26.70 ns | **0.30× (3.3× faster)** |

**Phase 3 decision strengthens**: clone-on-hit is not merely "viable"; for routes with 5+ params it is faster than the fresh factory because the cached object is already constructed and only spread is required. At 20 params it is 3.3× faster than rebuilding the params object via factory. `Object.freeze` remains rejected (1.55× to 3.73× slower than fresh factory).

**D. `new Function` first-call distribution (100 fresh compiles per node count, 10-call sequence)**:

| Walker nodes | first med | first p75 | first p99 | first max | second med | 10th med |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 16 | 221 ns | 311 | 6,447 | 22,919 | 205 | 199 |
| 64 | 458 ns | 502 | 12,633 | 83,028 | 433 | 428 |
| 256 | 1,552 ns | 1,589 | 14,857 | 276,427 | 1,514 | 1,511 |
| 1,024 | 5,992 ns | 6,741 | 28,513 | 1,538,998 | 5,639 | 5,673 |

The §5.2 #5 single-run result of 27 us first-call for a 16-node walker was **measurement instrumentation noise**. The 100-sample distribution shows first-call median **221 ns** for 16 nodes and **458 ns** for 64 nodes. p75 stays under 1 us through 64 nodes. Second and tenth call drop to ~200–460 ns and stabilize.

**Phase 6 Guard re-derivation (corrected)**: the §6 line 642 first-match Guard `<= 10 us` is attainable for walker sizes up to 64 nodes at median and p75, but the p99 fails Guard at 64 nodes (12.6 us) and beyond. Strategies remain (a) per-method codegen budget capped near 32–48 nodes for the median/p75 path, (b) iterative fallback for routes that exceed the codegen size budget, (c) build-time first-call warmup that absorbs the JIT tier-up p99 outliers before the router is exposed to user traffic. Combined approach is recommended; pure codegen with unbounded walker size is not.

**C. CPU profile across all six 100k shapes (other-than-mixed)**:

| Scenario | Top hot function | Share |
| --- | --- | ---: |
| `100k mixed` | `checkStaticWildcardConflict` (`pipeline/registration.ts`) | 91.12% |
| `100k param` | `emitNode` (`codegen/segment-compile.ts`) | 27.1% |
| `100k wildcard-heavy` | `insertIntoSegmentTree` (`matcher/segment-tree.ts`) | 18.5% |
| `100k versioned-api` | `emitNode` | 19.0% |
| `100k high-fanout` | `compileStaticRoute` (`pipeline/registration.ts`) | 14.0% |
| `100k static` (sampled implicitly via mixed top-2) | `next` / `stringSplitFast` | 3.93% / 0.56% |

The 91.12% `checkStaticWildcardConflict` cost is **scenario-specific to `100k mixed`**; other shapes spread their build cost across `emitNode`, `insertIntoSegmentTree`, `compileStaticRoute`, and `parseTokens` in the 14–27% range. `gc` is consistently 8–13% across shapes, so Phase 7 memory hygiene affects every shape uniformly.

**Phase impact map by shape (corrected)**:

- `100k mixed`: Phase 4 (wildcard prefix index) is the dominant fix.
- `100k param` and `100k versioned-api`: Phase 6 (codegen preflight + warmup + iterative fallback) is the dominant fix.
- `100k wildcard-heavy`: segment tree insertion path is the dominant fix; this is not currently called out as a numbered Phase and warrants a Phase 4b candidate.
- `100k high-fanout`: `compileStaticRoute` cost suggests a Phase 4c candidate around static route compilation.
- All shapes: Phase 7 GC/memory compaction matters at the 8–13% level.

**Tier-1 follow-up closure summary**:

- §5.2 single-run results were directionally correct in 5 of 6 cases.
- **Corrected**: Phase 6 first-call cost (16-node median 221 ns, not 27 us); Guard 10 us is reachable for ≤32-node walkers at p75.
- **Strengthened**: Map > object at 100k holds under mitata + do_not_optimize across 5 key distributions and adversarial collision-prone patterns.
- **Strengthened**: clone-on-hit (spread) is faster than fresh factory at ≥5 params; this changes the Phase 3 decision from "viable" to "preferred".
- **New**: sharding-into-32 makes lookup slower, not faster — caveat for any per-method optimization that argues from "smaller bucket = faster IC".
- **Confirmed scoped**: 91.12% wildcard conflict bottleneck is specific to `100k mixed`; `100k param` / `versioned-api` need Phase 6 codegen rework, `wildcard-heavy` and `high-fanout` need new Phase 4b/4c candidates.

### 5.4. Tier-2 follow-ups (Cuckoo hash, sealed/frozen, realistic walker)

`bench/tier2-followups.ts` runs four further investigations under mitata + `do_not_optimize`:

| Probe | Result | Decision |
| --- | ---: | --- |
| plain null-proto object lookup (100k) | 28.61 ns/iter | baseline |
| `Object.preventExtensions` sealed lookup | 29.23 ns/iter | no measurable benefit over plain |
| `Object.freeze` lookup | 28.02 ns/iter | no measurable benefit over plain |
| `Map<string, number>.get` | 14.87 ns/iter | **1.92× faster — third re-confirmation** |
| Cuckoo hash (2 tables, TS-implemented djb2/FNV) | 80.26 ns/iter | **REJECT — 2.8× slower than object** |
| realistic 64-route walker, 4 segments deep, codegen if-chain | 184.94 ns/iter | reference for Phase 6 walker shape |

**Findings**:

- **Cuckoo hash candidate (§10 line 1230 P3) is empirically rejected** under TypeScript implementation: manual djb2/FNV hash functions in JS are 2.8× slower than the JSC native hashing inside `Object` property lookup. Building a faster perfect hash in JS would require offloading hashing to `Bun.hash` (already rejected at 113 ns in §5.2 #6) or to native code (out-of-scope per §0 implementation language scope).
- **Sealing or freezing the object provides no lookup-speed benefit** at the 100k scale (28.0–29.2 ns range; within measurement noise). The §13 Phase 7 "build-only structures dropped" invariant survives independently of `Object.freeze`; `freeze` should be retained only for caller-mutation safety on returned params (where applicable).
- **Realistic walker shape (codegen if-chain on 4-segment 64-route trie) costs 184.94 ns per match** — substantially more than the §1 microbench small if-chain numbers, because per-segment `startsWith` + bounds checks dominate. This is the realistic baseline against which Phase 6 codegen size budget must be evaluated.

### 5.5. Tier-3 status (out-of-scope confirmation)

Per §0 implementation language scope (TypeScript only on Bun JSC, no WASM, no native bindings):

- **WASM hot path**: out-of-scope. Removed from candidate list.
- **AOT codegen via `Bun.build`**: already in use for the production bundle (`bun build index.ts internal.ts --outdir dist --target bun`). No additional AOT work changes the in-process router behavior; bundling is a packaging concern, not a routing-engine concern.
- **Linux `perf` / `valgrind` for byte-accurate RSS attribution**: diagnostic tooling only, never linked into the router. Use is permitted for measurement at any time but is not a §13 implementation phase.
- **`Bun.serve()` 100k native init internal phase split** (line 519: ">180s timeout"): requires either a Bun-internal instrumentation patch or a >600s harness run. Outside the §13 router-engine scope; treated as a Bun runtime measurement artifact.

These items are deliberately not part of any §13 Phase to keep the router engine scope intact.

---

## 6. 100k Route Target

100k route support is the primary design target.

Required 100k shapes:

- 100k static routes
- 100k param routes
- 100k mixed static/param/wildcard routes
- 100k high-fanout routes
- 100k versioned/API-like routes
- 100k wildcard-heavy stress profile. If route semantics make a full 100k set invalid, the harness must report the largest valid count, invalidity reason, and substitute threshold.

Previously missing from the local 100k harness, now added as single-run scenarios:

- `versionedApiScenario()`: multi-method API shape such as `/api/v{0..49}/tenants/:tenant/users/:user/posts/{id}/comments/:comment`.
- `wildcardHeavyScenario()`: wildcard stress shape such as `/files/group-{0..999}/bucket-{id}/*path`.
- Enterprise/extreme approval is still blocked until these scenarios run through the fresh-process 3-run gate with median/p75/p99 and profile data.

Guarantee meaning:

- `add()+build()` must complete within the target band and no measured phase may show unbounded superlinear behavior.
- Match latency must meet target-band p75/p99 for static hit, param hit, wildcard hit, 404 miss, and wrong method.
- Retained memory must scale linearly enough to meet per-route target-band budgets.
- Cache memory must remain bounded by configured `cacheSize`.
- Optional expansion must remain capped and must not turn one registered route into unbounded runtime state.
- Performance claims must be made at 100k, not inferred from 1k.

Target-setting rule:

- Do not claim final ns/MiB targets before full 100k end-to-end measurements.
- First measure current router, Bun native routes, `URLPattern`, and compatible userland routers at 100k.
- Then set three target bands:
  - `Guard`: release-blocking minimum.
  - `Aggressive`: expected target for the optimized implementation.
  - `Stretch`: Bun/JSC extreme target.
- A target band is valid only if it is backed by 100k measurements and profile data.

Target band derivation formula:

- `Guard` must be no worse than the current router on correctness and no worse than the current router by more than an explicitly approved regression budget on p75/p99 latency, build time, and retained memory.
- `Aggressive` must beat the current router on at least one primary bottleneck without regressing any core route shape beyond the approved budget.
- `Stretch` must approach or beat the fastest compatible external static baseline for static-only routes while preserving param/wildcard/security semantics that static-only baselines do not cover.
- A memory target must be expressed as both absolute delta and per-route cost: `rss delta / route`, `heapUsed delta / route`, `arrayBuffers delta / route`.
- A build target must include total build time and phase split. A total improvement is not accepted if it hides a new pathological phase.
- A match target must include cache-hot, cold first hit, cache churn, wrong method, and miss. A single hot-loop number is not a target.

Initial 100k planning bands:

These are provisional planning budgets, not final release gates. They are strict enough to reject clearly bad results, but final release approval requires refreshed full-matrix data and profile evidence. If a metric is not measured by a fresh-process gate, status is `not approved`.

| Metric at 100k routes | Guard | Aggressive | Stretch |
| --- | ---: | ---: | ---: |
| static add+build p99 | <= 500 ms | <= 250 ms | <= 100 ms |
| param add+build p99 | <= 1,500 ms | <= 750 ms | <= 300 ms |
| mixed add+build p99 | <= 3,000 ms | <= 1,000 ms | <= 400 ms |
| high-fanout add+build p99 | <= 500 ms | <= 250 ms | <= 100 ms |
| versioned-api add+build p99 | <= 1,500 ms | <= 750 ms | <= 300 ms |
| wildcard-heavy add+build p99 | <= 1,500 ms | <= 750 ms | <= 300 ms |
| first-match p99 | <= 10 us | <= 3 us | <= 1 us |
| warmed static hit p99 | <= 100 ns | <= 50 ns | <= 15 ns |
| warmed dynamic hit p99 | <= 150 ns | <= 75 ns | <= 25 ns |
| 404/wrong-method p99 | <= 150 ns | <= 75 ns | <= 25 ns |
| cache churn p99 | <= 500 ns | <= 200 ns | <= 75 ns |
| cacheSize default/effective cap | <= 1,000 per method unless configured | same | same |
| max expanded routes per build | <= 200,000 | <= 150,000 if no compatibility need | <= 125,000 only under Bun/JSC extreme profile with no compatibility need |
| max regex siblings per segment | <= 32 | <= 16 if no compatibility need | <= 8 if no compatibility need |
| RSS delta per route | <= 4,096 B | <= 2,048 B | <= 1,024 B |
| heapUsed delta per route | <= 2,048 B | <= 1,024 B | <= 512 B |
| arrayBuffers delta per route | <= 512 B | <= 256 B | <= 128 B |
| codegen observed compile p99 per method | <= 10 ms | <= 5 ms | <= 2 ms |
| emitted source per generated walker | <= 128 KiB | <= 64 KiB | <= 32 KiB |
| dominant 100k mixed build phase share | <= 60% | <= 40% | <= 25% |

Measurement status:

- `versioned-api` and `wildcard-heavy` now have explicit planning bands because they are required 100k shapes. Existing 3-run measurements show RSS and first-match failures, so they are not approved.
- `codegen observed compile p99 per method` is not approved until a fresh-process gate records compile telemetry for every generated method.
- `dominant 100k mixed build phase share` is evidence-confirmed in diagnostics but not release-approved until the optimized implementation passes the same metric.

Absolute memory equivalents at 100k routes:

| Metric | Guard | Aggressive | Stretch |
| --- | ---: | ---: | ---: |
| RSS delta | <= 390.63 MiB | <= 195.31 MiB | <= 97.66 MiB |
| heapUsed delta | <= 195.31 MiB | <= 97.66 MiB | <= 48.83 MiB |
| arrayBuffers delta | <= 48.83 MiB | <= 24.41 MiB | <= 12.21 MiB |

Partial-gate statistics rule:

- Current 3-run tables are `median / p75 / max-of-3`, where `p99` is effectively max-of-3.
- Final release p99 requires a larger sample count or request-level benchmark distribution, not only three process runs.
- 3-run results are sufficient to identify obvious failures, not to prove tail latency excellence.

Provisional approval budgets until measured bands are produced:

- correctness/security: zero known regression.
- build: no new superlinear behavior in 10k -> 100k scaling.
- memory: no unbounded cache growth; retained memory must stay within the per-route target band.
- match: no candidate may be accepted from microbench alone; end-to-end p75/p99 must not regress on static, param, wildcard, miss, or wrong-method shapes.

100k design implications:

- Static full-path lookup must stay O(1)-like and cannot degrade with route count.
- Dynamic route traversal must depend on path segment count, not total route count.
- High fanout must not fall back to linear scan unless proven faster for that fanout distribution.
- Generated code size must be bounded. Codegen that is fast at 1k but causes compile/tier-up/code-cache problems at 100k is rejected.
- Memory compaction must focus on duplicated terminals, factories, optional expansion aliases, and dense metadata, not on replacing fast string object lookup with slower packed scans.
- Build validation must batch errors but avoid retaining failed partial state.

---

## 7. Standards / Security Baseline

### 7.1. HTTP Method

Custom method는 지원해야 한다.

표준 기준:

- RFC 9110 defines HTTP `method = token`.
- method token is case-sensitive.
- standardized methods are conventionally uppercase US-ASCII, but custom methods are allowed.

최종 정책:

- Built-in defaults: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, `HEAD`.
- Built-in methods count toward the 32-method limit.
- Custom methods: allowed.
- Method identity: case-sensitive. `GET` and `get` are different methods.
- Method validation: US-ASCII RFC 9110 token grammar only. Regex form: `^[A-Za-z0-9!#$%&'*+\-.^_\x60|~]+$`.
- Allowed token characters: alnum plus `!`, `#`, `$`, `%`, `&`, `'`, `*`, `+`, `-`, `.`, `^`, `_`, `` ` ``, `|`, `~`.
- Method limit: default profile supports up to 32 distinct registered method tokens for the bitmask fast path. This is an implementation/performance cap, not an HTTP standard limit.
- More than 32 distinct methods must fail during `build()` with an explicit `method-limit` issue unless a future extended-method fallback is implemented and separately benchmarked.
- P3 extended-method candidate: support `>32` methods through a measured fallback such as two `Uint32` masks, `BigInt` bitmask, or sparse method table. It is not part of the default enterprise claim until build/match/wrong-method benchmarks prove no material regression.
- Method length limit: secure/default `maxMethodLength = 64` ASCII bytes.
- Internal representation: string input -> numeric method code -> bitmask/table.
- Default behavior must not uppercase/lowercase/normalize method names.
- Compatibility normalization, if ever added, must be explicit opt-in and must not be part of the standards-compliant profile.
- Runtime unknown method returns no-match or allowed-method miss; it must not throw.
- No implicit HEAD fallback and no implicit OPTIONS response are generated by the router. This is a routing-layer policy, not a claim that HTTP services can ignore HEAD/OPTIONS semantics. Applications or the server integration layer must explicitly implement HEAD-as-GET-without-body or generated OPTIONS if they want those HTTP service behaviors.

Security requirement:

- Reject empty method.
- Reject non-token characters.
- Reject whitespace/control characters.
- Reject Unicode method characters.
- Reject methods longer than 64 ASCII bytes in secure/default mode.
- Reject methods beyond 32 distinct registered names in the default bitmask profile.
- Treat lowercase standard-looking methods such as `get` as distinct custom tokens, not as aliases for `GET`.
- Do not register lowercase aliases for standard methods automatically.

Operational requirement:

- Real HTTP servers/proxies may reject lowercase or unknown methods before the router sees the request.
- The router must preserve the method string it receives instead of guessing upstream normalization.
- Application authors must register standard methods in uppercase when they want standard HTTP semantics.
- Enterprise scope statement: enterprise/security claims apply to applications with `<= 32` distinct method tokens. If an application genuinely needs more, the router needs a measured extended-method representation before the claim applies.

Current code status:

- Custom method registration is already supported by `MethodRegistry`.
- Current code lacks strict RFC token validation and currently allows invalid examples such as empty method names. This must be fixed before claiming enterprise-grade standards compliance.
- Current tests that expect 1000-character methods to succeed must be revised or isolated under an unsafe/compat profile.
- Current case-sensitive behavior is correct for standards compliance and must be preserved.

### 7.2. URL / Path Character Policy

등록 path는 URL 전체가 아니라 origin-form path pattern으로 취급한다.

표준 기준:

- RFC 3986 path segment is `*pchar`.
- `pchar = unreserved / pct-encoded / sub-delims / ":" / "@"`.
- Query and fragment are not part of registered route path.
- RFC 3986 generic syntax (§3) separates path, query, and fragment; §3.3 defines path syntax, §3.4 defines query after `?`, and §3.5 defines fragment after `#`. For router policy, a raw `?` or `#` terminates path-pattern data and is rejected during registration.
- RFC 3986 §3.5 defines fragment syntax and confirms it is not part of the path component.
- RFC 3986 §6.2.2.1 makes percent-encoding hex digits case-insensitive for normalization purposes.
- RFC 3629 §3 defines UTF-8 validity constraints; RFC 3629 §10 calls out overlong sequences as a security risk. Overlong encodings are invalid UTF-8 and must be rejected by secure/default validation.
- WHATWG URL uses percent-encoding sets for URL parsing/serialization, but the router must not silently rewrite registered route patterns.

Registration policy:

- Registered route must start with `/`.
- Registered route must not contain query `?` or fragment `#`.
- Registered route must not contain ASCII control characters.
- Secure/default registered route must be raw ASCII RFC 3986 path grammar. Raw non-ASCII, space, backslash, DEL, and C0 controls fail.
- Non-ASCII literals must be represented as percent-encoded UTF-8.
- Registered route must validate percent escapes: every `%` must be followed by two hex digits.
- Secure/default registration validates percent-decoded bytes for UTF-8 correctness, encoded slash, encoded control, and dot-segment detection. Static route identity still stores the original non-canonical path string after policy validation.
- Static path segments may contain RFC 3986 `pchar` minus router-grammar tokens that would be ambiguous in route patterns.
- Route-pattern syntax must be parsed separately from raw RFC `pchar`. Characters such as `:`, `*`, `(`, `)`, `?`, `+` are restricted only where they create router grammar ambiguity.
- Regex parentheses are valid route grammar only after a named param, e.g. `:id(\\d+)`. A regex-looking segment without a preceding `:name` is rejected as `path-invalid-pchar` in secure/default.
- If `:`, `*`, `(`, `)`, or `+` must be literal, use percent-encoded form. Secure/default does not decode-normalize registration paths except for dot-segment detection.
- Secure/default registration rejects interior empty segments such as `/a//b`. Root `/` is allowed.
- Trailing slash handling is controlled by `trailingSlash: "strict" | "ignore"`; default is `"strict"`. In strict mode `/a` and `/a/` are distinct.
- Interior empty segments such as `/a//b` and repeated trailing slashes such as `/a//` fail in both strict and ignore modes.
- Secure/default registration rejects literal dot segments `.` and `..`.
- Secure/default registration rejects percent-normalized dot segments: `%2e`, `%2E`, `.%2e`, `%2e.`, `%2e%2e`.
- Optional decorators such as `:id?` are route grammar, not query syntax. Literal/query `?` in the registered path is rejected.
- Registration parse order: first tokenize router grammar inside each path segment, so `:id?`, `:id+`, `:id(\\d+)`, and `:id+?` are recognized as decorators. After grammar tokenization, any remaining raw `?` byte outside a recognized decorator is rejected as query/ambiguity syntax.
- Required boundary fixtures: `/:id?` accepted, `/users/:id?/posts` accepted if optional expansion is valid, `/a?b` rejected, `/literal%3F` accepted as a literal question mark segment, and `/:id%3F` treated as literal encoded data only if it does not form router grammar.

Runtime policy:

- Runtime `match()` accepts an origin-form request target or path string.
- Runtime normalization order in secure/default:
  1. scan for raw `#`; if present anywhere in the input, return no-match and do not cache
  2. split query at the first raw `?`
  3. validate percent escapes and unsafe decoded bytes using a single percent-decoding pass for validation
  4. apply trailing slash policy to the same normalized key shape used at registration
  5. apply path case policy only in compat mode
  6. use the resulting path as the cache/static/dynamic lookup key
- Runtime secure/default treats raw `#` anywhere in input as no-match. This is stricter than URI fragment stripping and aligns with the registration policy that query/fragment are not route-path data.
- Percent decoding failures must be split by reason: malformed `%`, invalid UTF-8, encoded slash, encoded dot, encoded control character.
- Encoded control bytes emit `path-encoded-control`. Raw C0/DEL bytes emit `path-control-char`.
- Raw non-ASCII bytes emit `path-non-ascii`. ASCII characters outside RFC 3986 `pchar` minus router grammar tokens emit `path-invalid-pchar`.
- Secure/default scans percent escapes before lookup. Every `%` must be followed by two hex digits.
- Secure/default no-matches malformed `%`, invalid UTF-8, decoded C0/DEL control, decoded `/`, and decoded dot segments.
- Static matching does not percent-decode canonicalize. `/users/A` and `/users/%41` are distinct static paths.
- Secure/default performs exactly one validation decode pass. It must not double-decode `%252F` into `/`; `%252F` remains encoded percent data after one pass and is not treated as an encoded slash unless a future canonicalization profile explicitly opts in.
- Invalid UTF-8 includes overlong encodings such as `%C0%AF`; those no-match in runtime and fail in registration.
- Param/wildcard capture values are UTF-8 percent-decoded in secure/default only after the route matches safely.
- Encoded slash `%2F` is always no-match in secure/default, including inside param/wildcard captures.
- Encoded fragment `%23` is data, not a raw fragment delimiter. It is allowed only where percent-decoded `#` is safe for the selected segment/capture policy; raw `#` is always rejected/no-match.
- Compat profile may preserve current raw pass-through malformed param behavior only when `profile: "compat"` is explicitly selected.
- Malformed/unsafe runtime paths are not inserted into hit or miss cache in secure/default.
- Registration/runtime trailing-slash key rule: registration and runtime both apply the same `trailingSlash` policy before lookup-key construction. In `ignore` mode, one trailing slash is removed from non-root paths for both registered patterns and runtime paths; repeated trailing slashes still fail as empty segments.

Dot-segment rule:

- Secure/default rejects/no-matches a segment if its percent-decoded form is exactly `.` or `..`.
- `%2e`, `%2E`, `.%2e`, `.%2E`, `%2e.`, `%2E.`, `%2e%2e`, `%2E%2e`, `%2e%2E`, and `%2E%2E` are dot segments.
- `.well-known`, `...`, `a..`, and `%2e%2e%2e` are not dot segments.

Security requirement:

- No silent acceptance of malformed `%`.
- No control characters.
- No path pattern ambiguity.
- Regex safety must not overclaim. Native JS RegExp has no timeout guarantee.
- Secure/default permits only a safe regex subset for param regex. It rejects backreference, lookaround, nested quantifier, ambiguous alternation under repetition, named capture, flags, and `.*` inside a repeated group.
- Param regex is evaluated only against one segment with implicit `^(?:pattern)$`; it must never match `/`.
- Compat may allow native RegExp best-effort guard, but compat regex mode cannot be used for enterprise/security claims.
- Hard limits stay mandatory: `maxPathLength = 8192`, `maxSegmentLength = 1024`, `maxSegmentCount = 256`, `maxParams = 64`, `maxOptionalExpansions = 1024`, `maxExpandedRoutes = 200_000`, `maxRegexSiblingsPerSegment = 32`, `maxMethodLength = 64`, and bounded `cacheSize = 1000` by default.
- `Infinity` and `Number.MAX_SAFE_INTEGER` are validation errors for every numeric limit listed above: `maxPathLength`, `maxSegmentLength`, `maxSegmentCount`, `maxParams`, `maxOptionalExpansions`, `maxExpandedRoutes`, `maxRegexSiblingsPerSegment`, `maxMethodLength`, and `cacheSize`.
- Unbounded limits are allowed only with `unsafeAllowUnboundedLimits: true`, and that option invalidates enterprise/security claims.

Secure regex subset implementation rule:

- Allowed atoms: literal safe characters, escaped literals, character classes without nested classes, `\d`, `\w`, `\s`, `.`, and non-capturing groups `(?:...)`.
- Allowed quantifiers: `?`, `*`, `+`, `{m}`, `{m,n}` only on atoms or non-repeated simple groups.
- Rejected constructs: backreference, lookaround, named capture, capturing group, inline flags, nested quantifier, quantifier on alternation group, `.*` under any repeated group, and any pattern that can match `/`.
- Validation algorithm must be deterministic and parser-based or conservative scanner-based. Unknown construct means `regex-unsafe`.
- Fixtures must include allowed `\d+`, `[a-z0-9-]+`, `(?:foo|bar)` only if not repeated, and rejected `(a+)+`, `(a|aa)+`, `(?=a)`, `(?<x>a)`, `(a)\1`, `(?:.*)+`.

Regex route disjointness policy:

- Secure/default never tries general regular-language disjointness. General regex disjointness is too complex for a deterministic build validator in this router.
- `provably disjoint` means one of the conservative parser-known cases below; otherwise same-shape regex/plain or regex/regex ambiguity is rejected as `route-conflict`.
- Allowed disjoint proof cases: non-overlapping literal-only alternatives and non-overlapping single-character classes at the same fixed position with equal fixed length.
- Fixed numeric range disjointness is unsupported until a dedicated range parser spec exists. Before that parser exists, numeric-looking regex ranges must not be treated as proven disjoint.
- Plain param `:id` overlaps every safe regex param at the same segment position because plain param accepts any non-slash segment. Therefore constrained regex vs plain param same shape is rejected by default.
- Two identical regex ASTs at the same segment position are not aliases. They overlap and therefore emit `route-conflict` unless they are part of an already identical terminal alias case resolved later.
- If the validator cannot prove disjointness cheaply from the safe-regex AST, it must reject. It must not construct large automata or rely on runtime sampling.

Wildcard grammar:

- `*name` is a trailing wildcard segment only. It captures the remaining suffix after the prefix node where it attaches.
- `*name` uses the same identifier grammar as param names.
- A wildcard segment is not allowed in the middle of a path and is passed to Phase 4 as `wildcardTail`, not as a normal `parts` segment.

Profile policy:

- Default profile is `secure`.
- `secure`: strict method token, strict ASCII RFC path, strict percent scan, dot reject, finite limits, safe regex subset.
- `compat`: may allow raw pass-through malformed params and native RegExp best-effort guard. Fragment literal handling remains disabled unless an explicit future option defines it. Method token validation and 32-method limit still apply.
- `unsafe`: only explicit unsafe opt-outs such as unbounded limits. Unsafe profile cannot claim enterprise/security compliance.

Current code status:

- Leading `/`, empty segment, segment count, segment length, param count, duplicate param, regex safety are already checked.
- Runtime match strips query.
- Current registration path parser does not fully enforce RFC 3986 `pchar`, percent-escape validity, query/fragment rejection, control-character rejection, or dot-segment policy. These must be added before claiming full standards/security compliance.
- Current registration does not enforce full-path `maxPathLength`; runtime and registration limits must be separated and tested.
- Runtime malformed percent handling is strict in secure/default. Current raw pass-through on `decodeURIComponent` failure is compatibility-friendly but not strict-security behavior and belongs only in compat.
- RFC `pchar` compliance and router pattern grammar are separate concerns. `:`, `*`, `(`, `)`, `?`, `+` restrictions are router ambiguity policy, not raw RFC `pchar` requirements.
- Error reporting must carry actionable kind/reason and route index/path/method where applicable. `route-parse` and `segment-limit` alone are too coarse for enterprise validation.

Validation error schema:

```ts
type RouterValidationError = {
  kind: 'router-validation';
  issues: RouterIssue[];
};

type RouterIssue = {
  kind: RouterIssueKind;
  reason: string;
  routeIndex?: number;
  path?: string;
  method?: string;
  segmentIndex?: number;
  offset?: number;
};
```

Required issue kinds:

- `method-empty`
- `method-invalid-token`
- `method-too-long`
- `method-limit`
- `path-missing-leading-slash`
- `path-query`
- `path-fragment`
- `path-control-char`
- `path-non-ascii`
- `path-invalid-pchar`
- `path-malformed-percent`
- `path-invalid-utf8`
- `path-encoded-slash`
- `path-encoded-control`
- `path-dot-segment`
- `path-empty-segment`
- `path-too-long`
- `segment-too-long`
- `segment-count-limit`
- `param-count-limit`
- `param-duplicate`
- `regex-unsafe`
- `optional-expansion-limit`
- `expansion-total-limit`
- `regex-sibling-limit`
- `route-duplicate`
- `route-conflict`
- `route-unreachable`
- `option-invalid`

Public options target schema:

```ts
type RouterOptions = {
  profile?: 'secure' | 'compat' | 'unsafe';
  trailingSlash?: 'strict' | 'ignore';
  pathCaseSensitive?: boolean;
  maxMethodLength?: number;
  maxPathLength?: number;
  maxSegmentLength?: number;
  maxSegmentCount?: number;
  maxParams?: number;
  maxOptionalExpansions?: number;
  maxExpandedRoutes?: number;
  maxRegexSiblingsPerSegment?: number;
  cacheSize?: number;
  unsafeAllowUnboundedLimits?: boolean;
  optionalParamBehavior?: 'omit' | 'set-undefined';
};
```

Public API target:

```ts
type RouterPublicApi<T> = {
  add(method: string, path: string, value: T): void;
  build(): RouterPublicApi<T>;
  match(method: string, path: string): MatchOutput<T> | null;
  allowedMethods(path: string): readonly string[];
};
```

Compatibility mapping:

- Existing `ignoreTrailingSlash: true` maps to `trailingSlash: 'ignore'`.
- Existing `ignoreTrailingSlash: false` maps to `trailingSlash: 'strict'`.
- Existing `caseSensitive: false` maps to `pathCaseSensitive: false` and is compat-only unless separately proven secure.
- Default secure profile uses `trailingSlash: 'strict'`; preserving old behavior requires explicit compat/migration setting.
- Public error class remains compatible with existing `RouterError` where possible. New batch validation errors use `kind: 'router-validation'` and carry `issues: RouterIssue[]`; internal issue schema uses the detailed `RouterIssueKind` list above.
- Legacy external spelling from older code is handled only by a migration adapter; target spec and tests use `router-validation`.
- Default numeric limits are: `maxMethodLength = 64`, `maxPathLength = 8192`, `maxSegmentLength = 1024`, `maxSegmentCount = 256`, `maxParams = 64`, `maxOptionalExpansions = 1024`, `maxExpandedRoutes = 200_000`, `maxRegexSiblingsPerSegment = 32`, and `cacheSize = 1000`.
- Default `maxExpandedRoutes = 200_000`. This allows ordinary 100k route sets plus bounded optional expansion headroom, while rejecting pathological 100k * 1024 expansion attempts before trie insertion.
- Default `maxRegexSiblingsPerSegment = 32`. This caps conservative regex-disjointness comparisons at one segment position.
- Default `cacheSize = 1000`. Runtime cache containers are lazy, per method, and bounded by this value.
- Default `optionalParamBehavior = 'omit'` for the target secure API. Existing compatibility behavior that returns `undefined` keys must be requested explicitly with `optionalParamBehavior: 'set-undefined'` or a compat migration profile.
- Numeric limit violations, unsupported secure/compat option combinations such as `profile: 'secure'` with `pathCaseSensitive: false`, and unsafe unbounded settings without `unsafeAllowUnboundedLimits: true` emit `option-invalid`.

Wildcard method registration:

- `add('*', path, value)` means all currently registered built-in/default methods plus custom methods registered before seal.
- Custom methods registered before `seal()` participate in `*` expansion. Methods introduced after `seal()` require a new router/build and do not retroactively apply to an already sealed wildcard route.
- `*` expansion is resolved during `seal()` into concrete method codes and participates in the same 32-method limit.
- If `add('*', path, value)` expands to a `(method, path)` that was explicitly registered, default batch validation treats it as the same duplicate terminal policy as ordinary registration: `route-duplicate` unless it is an optional-expansion alias explicitly marked by `isOptionalExpansion`.

---

## 8. Design Principles

### 8.1. JSC Object Fast Path First

정적 child lookup과 method dispatch는 null-prototype object를 기본으로 둔다.

이유:

- 실제 재현에서 object lookup이 `Map`, `switch`, array scan, open-address hash보다 빨랐다.
- JSC는 안정적인 object shape/property lookup을 강하게 최적화한다. 단, shape transition/dictionary-mode/freeze 영향은 end-to-end profile로 확인해야 한다.
- 라우터의 child fanout은 대부분 sparse string key lookup이므로 TypedArray linear scan과 맞지 않는다.

적용:

- method code map: `Object.create(null)`
- input method string -> numeric method code conversion
- static route map: `Object.create(null)`
- segment static children: `Object.create(null)`
- build 이후 shape가 흔들리지 않도록 mutation phase와 sealed runtime phase를 분리한다.

비트연산을 쓰지 않는 지점:

- incoming method string dispatch 자체는 bit operation 대상이 아니다.
- 문자열을 직접 bit로 바꿀 수 없으므로 `methodCodes[method]`가 먼저 필요하다.
- 이 단계는 `switch`/`Map`보다 null-proto object lookup이 빠르다.

### 8.2. Codegen Specialization Where It Actually Wins

codegen은 유지한다. 단, 모든 것을 codegen으로 만들지 않고 source budget과 ambiguity guard를 둔다.

채택:

- wildcard prefix specialized walker
- unambiguous segment walker
- param factory generation
- small generated decision trees only when code size and first-match latency are proven

근거:

- 일부 실행에서 small specialized equality가 generic object lookup보다 빨랐지만, 다른 실행에서는 동률 또는 역전됐다. 따라서 static equality codegen은 기본 채택이 아니라 route-count/code-size threshold가 있는 조건부 후보이다.
- 기존 라우터도 codegen walker에서 param/wildcard 성능이 이미 강하다.

주의:

- 거대한 generated function은 instruction cache와 JIT compile cost를 악화시킬 수 있다.
- route 수가 많으면 object lookup 기반 table dispatch가 더 안전하다.
- Source budget만으로는 부족하다. 큰 tree 전체 source를 만든 뒤 포기하면 이미 build 비용을 지불한 상태가 된다.
- 100k에서는 node count, fanout, estimated source bytes, compile-time telemetry로 codegen 진입 전에 bail-out 해야 한다.

Initial codegen limits:

| Limit | Guard |
| --- | ---: |
| max generated source per walker | 128 KiB |
| preferred generated source per walker | 64 KiB |
| max generated source stretch target | 32 KiB |
| max codegen candidate nodes per method (initial) | 4,096 |
| **revised codegen budget per §5.3 D / Phase 6** — p75 Guard 10us | **≤ 32** nodes |
| **revised codegen budget — p99 Guard 10us (codegen-only)** | **≤ 16** nodes; routes above this fall back to iterative walker + build-time first-call warmup |
| max codegen candidate fanout | 64 |
| max compile time per generated method | 10 ms |

Fallback:

- If any limit is exceeded, use object/table dispatch and iterative walker.
- Bail-out must happen before generating the full source string.
- Codegen telemetry must record method, node count, fanout max, estimated source bytes, actual source bytes, compile ms, and fallback reason.

### 8.3. Allocation-Minimal Match Path

API가 `{ value, params, meta }`를 반환하므로 성공 결과 객체와 params 객체 생성은 완전히 제거할 수 없다. 정확한 목표는 “miss/traversal 중 transient allocation 금지, success path에서 result/params를 최소 생성”이다.

match traversal hot path에서는 다음을 금지한다.

- `split`
- `substring` 기반 param 객체 선생성
- `TextEncoder.encode`
- `Bun.hash`
- `Map` key concat
- `throw/catch`
- transient object allocation

Current gap:

- Current dynamic walker still creates segment `substring()` values during traversal. This violates the ideal allocation-minimal target and must be measured/fixed or explicitly accepted as a compatibility/performance trade-off.

채택:

- segment boundary는 기본적으로 JSC string primitive(`indexOf`)와 현재 walker를 유지한다.
- manual slash scan/codegen scanner는 end-to-end walker benchmark에서 이길 때만 채택한다.
- params는 `Int32Array` offset buffer에 기록한다.
- params object는 반환 직전 최소 1회만 생성하거나, API 호환 가능한 lazy materialization으로 지연한다.
- Dynamic cache params semantics: per §5.2 #4 / §5.3 F lock-in, **clone-on-cache-hit (spread) is the chosen mechanism** so caller mutation cannot poison later cache hits. `Object.freeze` is rejected on the hot path (§5.2 #4 measured 6.1× slower at 2-key, 1.55× slower at 20-key). Future optimized direction is lazy read-only params, gated by API compatibility and p75/p99 proof.
- cache는 method별 map으로 나누어 key concat을 제거한다.
- case-insensitive mode는 manual uppercase pre-scan을 넣지 말고 `toLowerCase()` 기반을 기본으로 둔다.

근거:

- substring param allocation `38.47 ns/op`
- offset-only param accounting `2.66 ns/op`
- cache key concat `11.37 ns/op`
- per-method cache path lookup `4.19 ns/op`
- slash scan은 microbench 변동이 있어 end-to-end 결정 필요
- `toLowerCase()` unchanged ASCII `2.70 ns/op`
- manual lowercase pre-scan `17.54 ns/op`

### 8.4. TypedArray Is a Memory Tool, Not the Default Lookup Tool

TypedArray는 다음 영역에만 사용한다.

- param offset buffer
- terminal/handler metadata table only after end-to-end proof
- compact handler indirection table
- large immutable metadata table
- method mask table
- bit flags for node/terminal metadata
- optional future packed snapshot export

기각:

- static child lookup의 전면 SoA linear scan
- `DataView` 기반 node access
- hot path hashing용 `Bun.hash`

근거:

- fanout64 object lookup `3.27 ns/op`
- fanout64 array scan `54.82 ns/op`
- open-address hash lookup `18.59 ns/op`
- DataView `3.59 ns/op`, Uint32Array `3.02 ns/op`

### 8.5. Int Buffer / Bit Operation Policy

int buffer와 bit 연산은 필요하다. 단, 라우터의 주 lookup 엔진이 아니라 allocation과 metadata overhead를 줄이는 보조 엔진이다.

채택:

- `Int32Array` param offset buffer
- terminal tag / method availability only when it reduces an actual table lookup in current per-method architecture
- method mask
- allowed-methods mask
- route method availability mask
- node flags
- compact handler indirection
- optional expansion alias metadata

조건부:

- bitmap/rank는 ASCII char-class prefilter나 method availability check에만 사용한다.
- perfect hash/bitmap child table은 real route distribution에서 object lookup을 이긴다는 재현 없이는 채택하지 않는다.

기각:

- string child lookup의 naive int-buffer scan
- packed hash key lookup
- open-address hash lookup
- `Bun.hash` 기반 hot path

근거와 제한:

- bitmap+popcount rank `4.95 ns/op`
- method bitmask availability `2.18 ns/op`
- method bool array availability `2.69 ns/op`
- method Set<number> availability `3.43 ns/op`
- method Set<string> availability `9.66 ns/op`
- terminal direct handler index `2.07 ns/op`
- terminal array method lookup `2.41 ns/op`
- terminal tagged fast path `2.39 ns/op`
- terminal tagged poly path `2.18 ns/op`
- terminal direct/array/tag microbench 차이는 작다. 현재 per-method tree에서는 terminal tag 이득이 제한적일 수 있으므로 P1 확정 항목이 아니라 P3 measured experiment로 둔다.
- fanout64 object lookup `3.27 ns/op`
- fanout64 array scan `54.82 ns/op`
- packed key lookup `25.50 ns/op`
- open-address hash lookup `18.59 ns/op`
- `Bun.hash` string `71.58 ns/op`

### 8.6. Validation Must Be Batch + Issue Array

라우트 등록은 pending list에 쌓고, `build()`에서 한번에 검증한다.

채택:

- `add()`는 user intent만 기록한다.
- `build()`에서 duplicate/conflict/unreachable/regex/wildcard conflict를 전수 검증한다.
- 실패 시 모든 문제 라우트를 issue array로 모아 하나의 `RouterError`로 보고한다.
- build 실패는 라우터 sealed 전 실패이며, partially built runtime snapshot을 노출하지 않는다.

근거:

- throw/catch validation `55.94 ns/op`
- issue-array validation `3.33 ns/op`

Route precedence and conflict policy:

| Pattern relation | Default policy |
| --- | --- |
| same method + same normalized pattern | reject `route-duplicate` |
| static vs param at same segment | static wins at match time |
| static vs regex param at same segment | static wins at match time |
| constrained regex param vs plain param same shape | reject `route-conflict`; plain param overlaps every valid non-slash regex segment |
| constrained regex param vs constrained regex param same shape | reject `route-conflict` unless the safe-regex AST proves disjointness by the conservative rules in section 7.2 |
| constrained regex param same AST at same segment | merge as same regex child; duplicate terminal is still checked at terminal insertion |
| param name differs but shape same, e.g. `/:a` and `/:b` | reject `route-duplicate` for same method |
| param name same and shape same | merge as same `paramChild` edge; duplicate terminal is still checked at terminal insertion |
| wildcard vs any longer route made unreachable by wildcard | reject `route-unreachable` |
| wildcard vs static terminal at same prefix | reject `route-unreachable` in both registration orders |
| wildcard vs wildcard at same prefix | reject `route-unreachable`; the later wildcard is fully covered by the prior wildcard's suffix space |
| regex siblings beyond `maxRegexSiblingsPerSegment` | reject `regex-sibling-limit` |
| per-route optional expansions beyond `maxOptionalExpansions` | reject `optional-expansion-limit` before expanded-route insertion |
| total expanded routes beyond `maxExpandedRoutes` | reject `expansion-total-limit` before trie insertion |
| optional expansion produces duplicate shape | alias terminal only if handler/method/options identical; otherwise reject conflict |
| wrong method same path | `match()` returns no-match; `allowedMethods(path)` may expose method metadata from the static/dynamic terminal table |
| `HEAD` vs `GET` | no implicit fallback; only registered method matches |
| `OPTIONS` | no implicit generated response; only registered method matches |

---

## 9. Runtime Architecture Candidate

### 9.1. Build Phase

1. pending routes 수집
2. path parse / normalize
3. optional route expansion
4. duplicate/conflict/unreachable validation
5. static route table 생성
6. dynamic segment tree 생성
7. terminal table / param factory 생성
8. codegen 가능한 walker만 specialization
9. immutable runtime snapshot publish

핵심 불변식:

- build 실패 시 runtime snapshot 없음
- build 성공 후 route mutation 금지
- `build()`/internal `seal()` is single-threaded per router instance. Concurrent build/seal calls on the same instance synchronously fail with `RouterError('build-in-progress')` guarded by a per-instance non-reentrant flag.
- After successful `build()`, any later `add()` throws `RouterError('router-sealed')`.
- On `build()` failure, `totalExpandedRoutes`, method-code allocations made during that attempt, staged trie nodes, alias journals, and partial snapshot objects are discarded before throwing.
- runtime table은 monomorphic shape 유지
- validation error는 가능한 한 batch로 보고

### 9.2. Match Phase

1. method code를 null-proto object에서 조회
2. method is never normalized
3. secure/default path policy:
   1. raw `#` no-match with no cache
   2. query strip at first raw `?`
   3. percent/UTF-8/dot/encoded-slash validation
   4. trailing slash policy
   5. compat-only case policy
   6. lookup-key construction
4. static table direct lookup first by default
5. per-method miss/hit cache lookup when it is proven beneficial
6. dynamic tree lookup
7. terminal handler index resolve
8. param offset으로 params materialize
9. hit/miss cache 기록 only after the path policy accepts the input

The path policy in step 3 is the same six-step normalization defined in section 7.2: raw `#` reject, raw `?` query strip, percent validation, trailing slash policy, compat-only case policy, and lookup-key construction.

Path case policy:

- Secure/default is path case-sensitive.
- `pathCaseSensitive: false` is compat-only unless separately proven standards-safe.
- Method case is never normalized in any profile.

Cache order policy:

- Default runtime order is static-first, then cache, then dynamic tree.
- Static hit cache is disabled by default because the static table is already a direct lookup.
- Dynamic hit cache and miss cache may remain enabled per method.
- `cacheSize` bounds each per-method cache. The current implementation uses clock-sweep eviction for dynamic hit cache and FIFO eviction for miss cache, with no TTL. The target design keeps bounded eviction explicit and must not allow unbounded high-cardinality path retention.
- Cache-first may become default only if dynamic-heavy p75/p99 improves by at least 10% while static p75/p99 regresses by no more than 5% and cache churn does not exceed Guard target.
- Any cache key must avoid method+path string concatenation; use per-method cache tables.
- After successful `seal()`, `match()` is safe for concurrent invocations because the runtime snapshot is immutable and cache containers are bounded runtime side structures. Concurrent mutation/build on the same router remains unsupported.

Regex sibling runtime policy:

- Secure/default build validation allows same-position regex siblings only when their safe-regex ASTs are proven disjoint, so multiple sibling matches should be unreachable.
- If an unsafe/compat mode ever permits ambiguous regex siblings, runtime order is registration order and the mode cannot claim enterprise/security determinism.

### 9.3. Terminal Representation

terminal representation is a measured optimization candidate, not a blanket requirement.

형태:

- `tag >= 0`: fast terminal, lower bits are handler index
- `tag < 0`: poly terminal, lower bits are terminal table reference

method 처리:

- API input: string method
- hot path entry: `methodCodes[method]`로 numeric method code 변환
- tree/cache/table index: numeric method code 사용
- availability/allowed-methods/poly terminal: bitmask 사용

목표:

- 현재 per-method tree에서는 단일 method terminal tag 이득이 작을 수 있다.
- multi-method/global-terminal architecture로 전환할 때만 fast/poly tag 이득이 커진다.
- handler storage와 terminal storage를 분리해 duplicate optional expansion 비용 감소

---

## 10. Adaptive Child Strategy

재현 결과 기준 기본값은 object lookup이다.

| Fanout/Key 형태 | 전략 |
| --- | --- |
| 일반 string segment | null-proto object |
| 아주 작은 fixed static set and hot route | generated equality chain only after code-size/first-hit proof |
| wildcard prefix only | generated prefix walker |
| param-only chain | generated or iterative offset walker |
| huge static full path table | **Provisional pending Phase 5b**: per-method null-proto object (small-key fast path) vs `Map<string,number>` (1.92× faster at 100k unsharded per §5.3 line 725); decision deferred to end-to-end measurement. Sharding into 32 method buckets is justified by routing semantics, NOT by raw lookup speed (§5.3 line 735: sharded 42 ns vs unsharded 28 ns). |
| compact metadata only | TypedArray |
| method availability | bit mask or compact integer tag |
| ASCII char-class prefilter | bitmap only after route-distribution proof |

기각된 전략:

- fanout 기준 naive array scan
- static child open-address hash
- packed key lookup
- `Bun.hash` hot path
- TextEncoder byte route matching
- DataView node table

조건부 후보:

- perfect hash 후보 중 두 변종은 §5.2 #6 / §5.4 G에서 empirically REJECTED: (a) `Bun.hash` + open-address `Int32Array` 113.69 ns/lookup (4.1× slower than null-proto object); (b) Cuckoo hash with TS-implemented djb2/FNV 80.26 ns/lookup (2.8× slower). 추가 perfect hash 변종은 §0 implementation language scope (TypeScript only, no native bindings) 안에서 위 두 결과보다 빨라야 candidate 자격이 유지된다.
- bitmap/rank는 ASCII char-class prefilter에는 가능성이 있지만, string child lookup 대체 용도로는 현재 근거 부족이다.
- radix/compressed trie는 기본 설계로 채택하지 않는다. Static full path는 object lookup이 이미 강하고, dynamic route는 segment trie이다. P3 memory experiment로만 둔다.
- DFA/NFA는 기각한다. Regex tester와 segment grammar가 남아 있고, 현재 코드/벤치에서 object+segment trie를 이긴 근거가 없다.

---

## 11. Memory Strategy

현재 사실:

- object node 500k: heap 증가가 크다.
- Int32Array 500k*8 allocation probe: heap 증가는 없고 rss/arrayBuffers 쪽 증가를 별도로 봐야 한다. Raw payload is 15.26 MiB; measured RSS includes allocator/page effects.
- 100k static build/runtime state may retain duplicated static structures unless explicitly dropped or compacted after snapshot publication.
- 100k param memory is not driven by duplicated params factory functions in the measured shape: there are 100,000 factory slots but only 1 unique factory function. The remaining candidates are segment node object graph, staticChildren objects, terminal arrays/slots, handlers, generated source, and cache state.

따라서 메모리 최적화 방향은 “전면 TypedArray 라우터”가 아니라 다음이다.

1. runtime node object 수를 줄인다.
2. duplicated terminal/handler/factory slots를 intern한다. Unique factory functions are already interned for the measured 100k param shape.
3. optional expansion은 가능한 terminal aliasing으로 처리한다.
4. param offsets, terminal tags, method masks 같은 dense metadata만 TypedArray로 이동한다.
5. static full-path table은 object lookup을 유지한다.
6. build-only indexes and validation journals are discarded after successful snapshot publication.
7. dynamic segment tree memory is reduced only where profiles show object graph bloat: compressed static chains, suffix/template interning, terminal aliasing, or compact metadata tables.

Build/runtime lifetime:

- Prefix-index counters such as `subtreeTerminalCount` and `subtreeWildcardCount` are build-only validation data and must not be retained by the published runtime snapshot.
- `methodCodes` is built per router snapshot. It is not module-global, and custom method codes do not leak across router instances or rebuild attempts.

이 방향은 현재 근거상 가장 먼저 검증해야 할 메모리 최적화 경로다. object lookup의 JSC 최적화를 버리지 않고, 메모리 bloat가 큰 부속 데이터를 compact table로 옮기는 방식이기 때문이다. “최고 효율” 여부는 100k retained memory와 p75/p99 regression을 함께 통과해야 확정한다.

---

## 12. Implementation Priorities

Implementation rule:

- Do not optimize before the failing or bottleneck behavior is reproduced.
- Every accepted change needs a RED checkpoint, GREEN implementation, and post-change bench/profile comparison when performance or memory is affected.
- If a benchmark script is found to measure the wrong thing, fix the benchmark first and mark previous numbers obsolete.
- If two optimizations conflict, preserve correctness/security first, then p75/p99 latency, then memory, then mean ns/op.
- A microbench can select candidates, but only an end-to-end 100k gate can approve them.

### P0: Correctness

- `build()`에서 batch validation을 유지한다.
- 100k target band and bench methodology must be finalized before any final performance claim.
- `optionalParamBehavior`가 snapshot generation에 정확히 전달되어야 한다.
- stale regression tests must be identified by file/symptom and updated to the current snapshot structure.
- RFC 9110 method token validation을 추가한다.
- RFC 3986 path character / percent-escape / control-character / query-fragment validation을 추가한다.
- Runtime malformed percent strict policy를 정하고 테스트한다.
- Dot segment and encoded dot segment policy를 정하고 테스트한다.
- Secure/default profile에서는 unbounded `Infinity` limits를 금지하거나 explicit unsafe opt-out으로 격리한다.
- 100k mixed build bottleneck을 재현 테스트로 고정하고 원인을 제거한다.
- 100k mixed build must be phase-instrumented before optimization: parse, optional expansion, static insert, dynamic insert, wildcard conflict check, snapshot build, codegen.
- Wildcard/static conflict validation moves from O(static * wildcard-prefix) scan to indexed prefix/trie validation if phase instrumentation confirms it as the 100k mixed bottleneck.

### P1: Hot Path

- method object lookup 유지
- static object lookup 유지
- dynamic codegen walker 유지
- offset param 유지
- param factory 중복 호출 제거
- params cache mutation semantics 확정: frozen, clone-on-hit, or lazy read-only.
- dynamic traversal `substring()` allocation 제거 또는 end-to-end 근거 기반 수용
- static hit cache order 재측정: cache-first vs static-first
- static table layout 재측정: method-first vs path-first method array
- per-method cache는 high-cardinality workload에서 이득/손해를 profile로 판단
- codegen preflight 추가: node-count, fanout, source estimate, compile time telemetry.

### P2: Memory

- 100k param retained heap을 줄인다.
- 100k param heap source를 object count로 분해한다: segment nodes, static child maps, terminals, factories, generated code, cache.
- terminal handler aliasing
- params factory interning is accepted only after re-measuring shapes where unique factories are not already 1. The measured `100k param` shape already has 1 unique factory function, so its target is factory slots/terminal metadata, not factory function identity.
- optional expansion terminal 중복 제거
- dense metadata TypedArray화
- build-only static structures drop/compact
- rollback/validation journal의 closure allocation을 typed journal or two-pass prevalidation로 대체할지 검증
- dynamic static-chain compression, suffix/template interning은 measured memory experiment로만 채택

### P3: Conditional Experiments

- perfect hash only for proven huge static sets
- lazy params object materialization
- generated static equality only below code-size threshold
- terminal tag fast/poly only if end-to-end shows benefit; not a default requirement
- compact path-first static table plus method mask/handler slots vs method-first table
- manual slash scan vs `indexOf` across path length/slash distributions
- radix/compressed trie for dynamic static-chain memory only
- route distribution based specialization

### Required RED Reproducers Before Router Refactor

| Reproducer | Must prove | Acceptable outcome |
| --- | --- | --- |
| optional behavior | `optionalParamBehavior: 'omit'` is ignored by current seal path | failing test before fix |
| params factory double-call | one dynamic hit invokes factory twice or allocates twice | failing counter/allocation test before fix; GREEN requires factory invocation count == 1 per successful dynamic match |
| invalid method token | empty/space/control/delimiter methods are accepted today | failing validation test before fix |
| registration path policy | query/fragment/control/malformed percent/dot path accepted today | failing validation test before fix |
| runtime strict percent | malformed/unsafe encoded runtime path behavior is currently compat/raw-pass-through | policy test documents current behavior before change |
| 100k mixed build | phase split identifies dominant build phase | timing output with phase percentages; GREEN requires dominant phase share <= 60% Guard after optimization |
| 100k param memory | heap profile identifies top retained object groups | object-count/retained-size report |
| cache order | static-first vs cache-first measured on static-hot, static-cold, churn, miss | p75/p99 comparison |
| static layout | method-first vs compact path-first measured with multi-method and wrong-method semantics | latency + memory comparison |
| codegen preflight | large tree codegen cost is measured before/after preflight | source bytes + compile ms |

---

## 13. Implementation Blueprint

This section is the build plan. It defines where each change goes, the algorithm to use, and the RED/GREEN proof required before moving on.

### Phase 0: Bench And Test Infrastructure

Goal:

- Make current failures and performance bottlenecks reproducible without ad-hoc shell snippets.

Files:

- `packages/router/bench/100k-verification.ts`
- `packages/router/bench/100k-gate-runner.ts`
- new `packages/router/test/enterprise-validation.test.ts`
- new `packages/router/test/cache-semantics.test.ts`

Implementation:

- Keep `100k-gate-runner.ts` as the fresh-process aggregation runner.
- Add JSON output mode to the runner before final optimization work.
- Add phase timer hooks around registration stages before changing wildcard conflict logic.
- Add RED tests for method token, path policy, optional omit, params cache mutation, HEAD/OPTIONS, and route precedence.

Exit criteria:

- RED tests fail on current code for known defects.
- `100k mixed` phase output identifies where time is spent.
- Baseline gate output can be saved and compared after implementation.

### Phase 1: Batch Validation And Security Profile

Goal:

- Implement secure/default validation without changing match hot path first.

Files:

- `packages/router/src/types.ts`
- `packages/router/src/router.ts`
- `packages/router/src/pipeline/registration.ts`
- `packages/router/src/builder/path-parser.ts`
- new `packages/router/src/builder/method-policy.ts`
- new `packages/router/src/builder/path-policy.ts`
- new `packages/router/src/builder/validation-issue.ts`

Data model:

```ts
type RouterProfile = 'secure' | 'compat' | 'unsafe';

type RouterIssue = {
  kind: RouterIssueKind;
  reason: string;
  routeIndex?: number;
  path?: string;
  method?: string;
  segmentIndex?: number;
  offset?: number;
};
```

Algorithm:

- `add()` still records intent only.
- `seal()` validates pending routes in one pass and collects `RouterIssue[]`.
- Method validation runs before method code allocation.
- Path raw-character validation runs before route grammar parsing.
- Dot-segment validation runs on percent-decoded segment only for dot detection.
- Regex policy validates param regex before `RegExp` construction.
- If issues exist, throw one `RouterValidationError` containing all issues.

Default values:

- `profile = 'secure'`
- `maxMethodLength = 64`
- `maxPathLength = 8192`
- `maxSegmentLength = 1024`
- `maxSegmentCount = 256`
- `maxParams = 64`
- `maxOptionalExpansions = 1024`
- `maxExpandedRoutes = 200_000`
- `maxRegexSiblingsPerSegment = 32`
- `cacheSize = 1000`
- `optionalParamBehavior = 'omit'`

RED tests:

- invalid methods accepted today.
- query/fragment/control/dot/malformed percent paths accepted today.
- `Infinity` limits accepted in secure/default today where applicable.
- unsafe regex constructs accepted today where applicable.

GREEN criteria:

- All invalid cases produce deterministic issue kinds.
- Multiple invalid routes produce one batched error.
- Valid custom methods such as `PROPFIND`, `PATCH+X`, `foo`, `get` still work.
- Existing valid route grammar remains compatible under `compat` where needed.

Performance risk:

- Validation is build-time only. No match hot-path regression is allowed.

### Phase 2: Runtime Secure Path Scanner

Goal:

- Enforce secure/default runtime percent, dot, fragment, control, and encoded slash policy before cache/static/dynamic lookup.

Files:

- new `packages/router/src/matcher/runtime-path-policy.ts`
- `packages/router/src/codegen/emitter.ts`
- `packages/router/src/pipeline/build.ts`
- tests in `packages/router/test/runtime-path-policy.test.ts`

Algorithm:

- Run the scanner before cache lookup. Secure/default scanner order is the same six-step normalization defined in section 7.2: raw `#` reject with no cache, raw `?` query strip, percent/UTF-8/dot/encoded-slash validation, trailing slash policy, compat-only case policy (n/a in secure), and lookup-key return.
- In secure/default, malformed or unsafe path returns no-match and is not recorded in hit/miss caches.
- The scanner returns `{ ok: true, path }` or `{ ok: false, reason }`.
- Param/wildcard percent decoding uses the same validated byte spans, avoiding a second unsafe decode path where practical.

RED tests:

- malformed `%`, invalid UTF-8, `%2F`, `%00`, `%2e`, fragment `#` currently do not follow secure/default policy.

GREEN criteria:

- All unsafe runtime inputs no-match in secure/default.
- Compat preserves documented behavior only when explicitly selected.
- Static, param, wildcard warmed p99 remain within Guard.

Performance risk:

- Scanner is on match hot path. It must be single-pass over the path and avoid allocation on valid ASCII paths.

### Phase 3: Optional Param Behavior And Params Cache Semantics

Goal:

- Fix `optionalParamBehavior: 'omit'` and remove factory double-call without cache poisoning.

Files:

- `packages/router/src/router.ts`
- `packages/router/src/pipeline/registration.ts`
- `packages/router/src/codegen/emitter.ts`
- `packages/router/src/builder/optional-param-defaults.ts`

Algorithm:

- Pass `routerOptions.optionalParamBehavior` into `registration.seal({ optionalParamBehavior })`.
- Keep param factory keyed by behavior and present param set.
- Replace double factory call with one materialization plus cache-safe storage.
- **Locked implementation choice (per §5.2 #4 / §5.3 F)**: `clone-on-cache-hit (spread)`. The cached params object is stored once and every cache-hit returns `{...cached}`. `Object.freeze({...})` per call is rejected (40.76 ns vs 12.77 ns at 2-key; 137.43 ns vs 26.70 ns at 20-key — 1.55–3.73× slower across param counts). `clone-on-cache-store` alone is also rejected for safety. Lazy read-only params remain a Phase 3b candidate.
- Do not store the same mutable params object that is returned to the caller.

RED tests:

- `omit` currently returns `id: undefined`.
- params mutation followed by same-path lookup must keep original cached value across 1st, 2nd, and 3rd hit.

GREEN criteria:

- `omit` produces absent key.
- `set-undefined` produces key with `undefined`.
- caller mutation cannot change later cache hits.
- dynamic hit p99 does not regress beyond Guard budget.

Performance risk:

- Freezing may be expensive on hot path.
- Clone-on-hit may add allocation.
- If both regress, implement lazy read-only params as Phase 3b.

### Phase 4: Wildcard Conflict Index

Goal:

- Remove the reproduced O(static * wildcard-prefix) build blow-up.

Files:

- `packages/router/src/pipeline/registration.ts`
- new `packages/router/src/pipeline/wildcard-prefix-index.ts`
- tests in `packages/router/test/route-conflict.test.ts`
- bench in `packages/router/bench/100k-verification.ts`

Data structure:

```ts
type WildcardPrefixIndex = Map<number, PrefixTrieNode>;

type PrefixTrieNode = {
  literalChildren: Record<string, PrefixTrieNode>;
  paramChild: PrefixTrieNode | null;
  paramName: string | null;
  regexParamChildren: PrefixTrieNode[];
  regexAst: SafeRegexAst | null;
  wildcardName: string | null;
  terminalMeta: RouteMeta | null;
  subtreeTerminalCount: number;
  subtreeWildcardCount: number;
};
```

Algorithm:

- Maintain one tokenized trie per method code.
- Segment keys come from the same parsed/expanded/normalized route parts used for registration after secure/default policy validation.
- The trie stores literal, param, regex-param, wildcard, and terminal edges.
- When registering any route, check whether an ancestor wildcard already makes it unreachable.
- When registering a wildcard route, check whether existing descendant terminals already exist below its prefix, independent of registration order.
- Param prefix wildcard examples such as `/:tenant/files/*path` are represented by param edges, not stringified literal prefixes.
- Optional-expanded routes are checked after expansion so aliases/conflicts are visible.
- If any walked trie node has `wildcardName`, the route is unreachable/conflicting.
- `paramChild` is a single shape edge by policy. A second same-position plain param with a different name is not a new edge; it emits `route-duplicate` for the same method.
- `route-duplicate` covers same method plus structurally identical pattern shape, even when param names differ; it is not limited to byte-identical path strings.
- `subtreeTerminalCount` is incremented on every visited ancestor, including the terminal node itself, at commit. Wildcard insertion reads this counter at any ancestor, including the prefix node, in O(1) without subtree enumeration.
- Complexity for static/plain-param/wildcard prefix checks becomes O(segment count) per expanded route. Regex-param insertion adds sibling comparison cost O(regex siblings at that segment * conservative AST comparison). `maxRegexSiblingsPerSegment = 32` prevents unbounded sibling comparison and emits `regex-sibling-limit` when exceeded. Optional expansion multiplies work by expanded route count and must be capped globally.
- Pseudocode convention: `parts` excludes the trailing wildcard capture segment. `wildcardTail` is passed separately as `null | { name: string }`.
- Batch validation convention: when `issue(...)` is emitted for a route, stop mutating the prefix index for that route but keep processing later routes so all independent issues can be collected.
- Expansion counter convention: `totalExpandedRoutes` is a per-`build()`/`seal()` batch counter initialized to 0 before pending routes are validated. It is not module-level or router-lifetime state.
- Expansion wrapper convention: `routeSpec` is a normalized pre-expansion route descriptor produced by Phase 1 path parsing. `optionalExpansions(routeSpec)` yields concrete expanded routes. Every yielded `ExpandedRoute.meta` must set `isOptionalExpansion = true` if and only if that concrete route was produced by optional-segment dropping; the all-present route and ordinary repeated `add()` calls keep `isOptionalExpansion = false`. `expandAndAdd` is invoked once per pending route during seal.
- Expansion cap convention: `totalExpandedRoutes` increments before per-expanded-route validation. Routes that fail later validation still consume capacity because the cap protects build-time work, not only successful registrations.
- Batch continuation convention: when `expandAndAdd` emits `expansion-total-limit`, batch validation records one consolidated `expansion-total-limit` issue for the batch and then skips further expanded-route insertion/counting for that overflowing batch segment to avoid issue spam. Independent non-expansion validation can still continue where safe.
- Batch consolidation convention: `batchTotalLimitEmitted: boolean` is a per-`build()`/`seal()` flag initialized to `false`. The first `++totalExpandedRoutes > maxExpandedRoutes` condition emits one `expansion-total-limit` issue and sets the flag. Subsequent `expandAndAdd` invocations within the same batch return immediately without emitting additional `expansion-total-limit` issues. The flag and `totalExpandedRoutes` are both reset to initial values on `build()` failure cleanup.
- Lazy node allocation convention: the reference pseudocode below allocates `plannedNode` eagerly inside `planEdge` for traversal clarity. Implementations may defer `createNode()`/`createRegexNode()` to `commitEdge` as a build-time optimization so that abandoned plans on validation failure incur zero allocator pressure. To reconcile the descent dependency at validation time, lazy implementations must either (a) reuse a single per-build transient placeholder node that carries empty `literalChildren`/`paramChild`/`regexParamChildren` and is never committed, or (b) thread `(parent, key, kind)` references through validation and resolve children via the parent rather than via the planned descendant. Either form is permitted; the observable semantics are identical and the §11 build-time efficiency invariant under high 100k mixed insertion volume must be preserved.
- Issue metadata convention: `routeSpec.meta` carries the original pre-expansion route index/path/method. `routeMeta` carries the concrete post-expansion path plus the same original route index. Validation issues must expose both when useful: `path` is the original registered pattern, and `expandedPath` is optional diagnostic metadata for the concrete expanded route.
- Wildcard count convention: when a wildcard route commits, `plan.visited` contains the root, every ancestor, and the prefix node where the wildcard attaches. Every visited node receives `subtreeWildcardCount++`, including the prefix attachment node itself; no separate wildcard anchor node is created.
- Preserve existing wildcard name conflict checks.
- Regex-param conflict handling uses the conservative disjointness policy from section 7.2. The prefix index must treat non-proven regex overlap as conflict; it must not attempt general regex automata construction.
- Regex sibling limit has priority over regex overlap checks. If adding a regex sibling would exceed `maxRegexSiblingsPerSegment`, emit `regex-sibling-limit` before running AST disjointness, even if the same candidate would also overlap.
- `terminalMeta` stores route index/path/method/handler/options identity for duplicate, alias, and conflict diagnostics. Build-only counters and validation trie state are discarded after snapshot publication as described in section 11.
- `handlerId` is assigned by a build-scoped identity registry: `WeakMap<object | function, id>` for non-null object/function values and a tagged primitive map for string/number/boolean/bigint/symbol/null/undefined route values. The same reference or same primitive value receives the same id within one build.
- `optionsKey` is `hash(deepStableSerialize(routeOptions))`, so semantically equal route options produce the same key. `deepStableSerialize` uses sorted object keys, canonical primitive tags, `RegExp` as `{source,flags}`, `BigInt` as a decimal string with a bigint tag, and rejects function, symbol, and circular option values as `option-invalid`.
- `isOptionalExpansion` is true only for concrete routes produced by optional-param expansion, not for ordinary repeated `add()` calls. Alias success is allowed only in that optional-expansion context.
- Wildcard at root rule: when `parts = []` and `wildcardTail !== null`, the prefix attachment node is the per-method root node.

Pseudocode:

```ts
type RouteMeta = {
  routeIndex: number;
  path: string;
  expandedPath?: string;
  method: string;
  handlerId: number;
  optionsKey: string;
  isOptionalExpansion: boolean;
};
type NormalizedSafeRegexAst = object;
type SafeRegexAst = NormalizedSafeRegexAst;
type RoutePart =
  | { type: 'static'; value: string }
  | { type: 'param'; name: string }
  | { type: 'regex'; name: string; regexAst: SafeRegexAst };
type ExpandedRoute = { methodCode: number; parts: RoutePart[]; wildcardTail: null | { name: string }; meta: RouteMeta };
type RouteSpec = { meta: RouteMeta; parts: RoutePart[] };
type IssuePlan = { issue: RouterIssueKind };
type AliasPlan = { aliasOf: RouteMeta };
type CommitPlan = { methodCode: number; edges: PlannedEdge[]; visited: PrefixTrieNode[]; wildcardTail: null | { name: string }; routeMeta: RouteMeta };
type PrefixPlan = IssuePlan | AliasPlan | CommitPlan;
type PlannedEdge =
  | { kind: 'static'; parent: PrefixTrieNode; key: string; node?: PrefixTrieNode; plannedNode?: PrefixTrieNode }
  | { kind: 'param'; parent: PrefixTrieNode; name: string; node?: PrefixTrieNode; plannedNode?: PrefixTrieNode }
  | { kind: 'regex'; parent: PrefixTrieNode; regexAst: SafeRegexAst; node?: PrefixTrieNode; plannedNode?: PrefixTrieNode };

function createNode(): PrefixTrieNode;
function createRegexNode(regexAst: SafeRegexAst): PrefixTrieNode;
function rootFor(methodCode: number): PrefixTrieNode;
function safeRegexDisjoint(a: SafeRegexAst, b: SafeRegexAst): boolean;
function sameRegexAst(a: SafeRegexAst, b: SafeRegexAst): boolean;
function optionalExpansions(routeSpec): Iterable<ExpandedRoute>;
function sameTerminalIdentity(a: RouteMeta, b: RouteMeta): boolean;
function recordAlias(existing: RouteMeta, alias: RouteMeta): void;
function issue(kind: RouterIssueKind, meta: RouteMeta): void;

// Helper contracts:
// - createNode returns an empty node with regexAst=null, terminalMeta=null, and zero counters.
// - createRegexNode(regexAst) is createNode() plus node.regexAst=regexAst.
// - rootFor(methodCode) returns the build-only prefix-index root for that concrete method.
// - safeRegexDisjoint returns true only for the conservative section 7.2 proof cases.
//   false means either proven overlap or unknown; both reject as route-conflict.
// - sameRegexAst is structural equality over the normalized safe-regex AST.
//   Canonicalization folds `{1,}` to `+`, `{0,}` to `*`, and `{0,1}` to `?`.
//   It does not fold semantic aliases such as `\d` and `[0-9]`; those remain
//   distinct ASTs unless a future parser explicitly adds that equivalence.
// - optionalExpansions yields concrete routes in deterministic order: all-present first,
//   then increasing drop-subset bit order matching current expandOptional behavior.
// - sameTerminalIdentity is exactly:
//   a.method === b.method && a.handlerId === b.handlerId && a.optionsKey === b.optionsKey.
// - recordAlias appends to a build-only aliasJournal[] with
//   { existingTerminalMeta, aliasRouteMeta }. After validation succeeds,
//   the static-table/segment-trie snapshot builder consumes aliasJournal[]
//   and writes the alias terminal to the same handler/options metadata. It
//   never mutates the prefix-index counters. At match time the alias resolves
//   through the same handler index as the existing terminal.

function expandAndAdd(routeSpec: RouteSpec): void {
  if (batchTotalLimitEmitted) return;
  let perRouteExpandedCount = 0;
  for (const expanded of optionalExpansions(routeSpec)) {
    if (++perRouteExpandedCount > maxOptionalExpansions) {
      return issue('optional-expansion-limit', routeSpec.meta);
    }
    if (++totalExpandedRoutes > maxExpandedRoutes) {
      if (!batchTotalLimitEmitted) {
        batchTotalLimitEmitted = true;
        return issue('expansion-total-limit', routeSpec.meta);
      }
      return;
    }
    addExpandedRoute(expanded.methodCode, expanded.parts, expanded.wildcardTail, expanded.meta);
  }
}

function addExpandedRoute(methodCode: number, parts: RoutePart[], wildcardTail: null | { name: string }, routeMeta: RouteMeta): void {
  const plan = validateExpandedRoute(methodCode, parts, wildcardTail, routeMeta);
  if ('issue' in plan) return issue(plan.issue, routeMeta);
  if ('aliasOf' in plan) return recordAlias(plan.aliasOf, routeMeta);
  commitExpandedRoute(plan);
}

function validateExpandedRoute(methodCode: number, parts: RoutePart[], wildcardTail: null | { name: string }, routeMeta: RouteMeta): PrefixPlan {
  let node = rootFor(methodCode);
  const visited = [node];
  const edges = [];

  for (const part of parts) {
    if (node.wildcardName !== null) return { issue: 'route-unreachable' };
    const edge = planEdge(node, part);
    if ('issue' in edge) return { issue: edge.issue };
    edges.push(edge);
    node = edge.node ?? edge.plannedNode;
    visited.push(node);
  }

  if (wildcardTail !== null) {
    if (node.subtreeTerminalCount > 0 || node.subtreeWildcardCount > 0) {
      return { issue: 'route-unreachable' };
    }
  } else {
    if (node.terminalMeta !== null) {
      if (!routeMeta.isOptionalExpansion) return { issue: 'route-duplicate' };
      return sameTerminalIdentity(node.terminalMeta, routeMeta)
        ? { aliasOf: node.terminalMeta }
        : { issue: 'route-conflict' };
    }
    // This terminal check is distinct from the loop check above: the loop
    // catches ancestor wildcards; this catches a wildcard attached exactly
    // at the candidate terminal prefix.
    if (node.wildcardName !== null) return { issue: 'route-unreachable' };
  }

  return { methodCode, edges, visited, wildcardTail, routeMeta };
}

function commitExpandedRoute(plan: CommitPlan): void {
  for (const edge of plan.edges) commitEdge(edge);
  const terminalNode = plan.visited[plan.visited.length - 1];
  if (plan.wildcardTail !== null) terminalNode.wildcardName = plan.wildcardTail.name;
  else terminalNode.terminalMeta = plan.routeMeta;

  for (const seen of plan.visited) {
    if (plan.wildcardTail !== null) seen.subtreeWildcardCount++;
    else seen.subtreeTerminalCount++;
  }
}

function planEdge(node: PrefixTrieNode, part: RoutePart): PlannedEdge | { issue: RouterIssueKind } {
  // Reference pseudocode allocates plannedNode eagerly so the validation walk
  // can descend through it. Implementations may defer createNode/createRegexNode
  // to commitEdge as an optimization (see lazy-allocation convention above);
  // the observable semantics are identical.
  if (part.type === 'static') {
    const child = node.literalChildren[part.value];
    return child !== undefined
      ? { kind: 'static', parent: node, key: part.value, node: child }
      : { kind: 'static', parent: node, key: part.value, plannedNode: createNode() };
  }
  if (part.type === 'param') {
    if (node.regexParamChildren.length > 0) return { issue: 'route-conflict' };
    if (node.paramChild !== null && node.paramName !== part.name) return { issue: 'route-duplicate' };
    return node.paramChild !== null
      ? { kind: 'param', parent: node, name: part.name, node: node.paramChild }
      : { kind: 'param', parent: node, name: part.name, plannedNode: createNode() };
  }
  if (node.paramChild !== null) return { issue: 'route-conflict' };
  // The cap check intentionally precedes disjointness comparison; when both
  // overlap and cap overflow are possible, `regex-sibling-limit` wins.
  if (node.regexParamChildren.length >= maxRegexSiblingsPerSegment) return { issue: 'regex-sibling-limit' };
  for (const existing of node.regexParamChildren) {
    if (sameRegexAst(existing.regexAst, part.regexAst)) {
      return { kind: 'regex', parent: node, regexAst: part.regexAst, node: existing };
    }
  }
  for (const existing of node.regexParamChildren) {
    if (!safeRegexDisjoint(existing.regexAst, part.regexAst)) return { issue: 'route-conflict' };
  }
  return { kind: 'regex', parent: node, regexAst: part.regexAst, plannedNode: createRegexNode(part.regexAst) };
}

function commitEdge(edge: PlannedEdge): void {
  if (edge.node !== undefined) return;
  if (edge.kind === 'static') edge.parent.literalChildren[edge.key] = edge.plannedNode;
  else if (edge.kind === 'param') {
    edge.parent.paramName = edge.name;
    edge.parent.paramChild = edge.plannedNode;
  } else {
    edge.parent.regexParamChildren.push(edge.plannedNode);
  }
}
```

RED benchmark:

- `wildcard-conflict-feasibility` currently reaches `26280.32 ms` at 50k routes.
- A route that conflicts after creating staged edges must leave no committed prefix-index state for later routes in the same batch.
- Registering 33 disjoint regex params at the same segment position must emit `regex-sibling-limit` when `maxRegexSiblingsPerSegment = 32`.
- `/a` then `/a/*p` and `/a/*p` then `/a` must emit the same collision-class issue kind: `route-unreachable`.
- A route set whose total optional expansions exceed `maxExpandedRoutes` must emit `expansion-total-limit` before any static/dynamic trie insertion for the overflowing expanded route.
- A single route whose optional expansions exceed `maxOptionalExpansions` must emit `optional-expansion-limit`.
- `/*path` registered for a method root must attach wildcard metadata to the root prefix node and detect root-level descendants in both registration orders.
- Ordinary duplicate `add('GET', '/foo', handler)` must emit `route-duplicate`; only optional-expanded duplicate shapes with identical terminal identity may alias.
- `/x/:r(\\d+)/a` followed by `/x/:r(\\d+)/b` must reuse the same regex child and must not emit `route-conflict`.

GREEN criteria:

- Same or stricter conflict detection than current implementation, with deterministic `route-conflict`, `route-unreachable`, or `regex-sibling-limit` issue kind.
- The same collision class emits the same issue kind regardless of registration order. Static terminal vs wildcard terminal at the same prefix emits `route-unreachable` in both orders.
- A route that emits an issue during prefix-index validation must not mutate the prefix index in a way that can affect later routes in the same batch.
- Registering more than `maxRegexSiblingsPerSegment` disjoint regex params at the same segment position emits `regex-sibling-limit`.
- 50k disjoint wildcard/static build drops by at least 10x. Derivation: current 50k stress is `26280.32 ms`; the 100k mixed Guard is `3000 ms`, so a same-order build fix needs at least `26280.32 / 3000 = 8.76x` improvement before 100k overhead. This is a best-case proxy because the 50k disjoint stress and 100k mixed workload are not identical. The criterion is rounded to 10x to leave headroom for validation and snapshot cost.
- `100k mixed` add+build p99 passes Guard target; Aggressive requires measured proof after the index is implemented.
- The 50k stress 10x criterion and the 100k mixed Guard are independent gates. Current same-harness 100k mixed is about 21 seconds, so the 100k mixed Guard requires roughly 7x improvement regardless of the 50k stress result.
- Global build capacity caps total expanded routes. `maxOptionalExpansions` is per-route; `maxExpandedRoutes` prevents 100k registered routes from expanding into 102.4 million trie insertions.
- Default `maxExpandedRoutes = 200_000`; exceeding it emits `expansion-total-limit` before dynamic/static trie insertion.
- No retained runtime memory from build-only prefix index after snapshot publication.

Performance risk:

- Build-only trie must be discarded after successful seal.
- Prefix normalization must exactly match path parser output.

### Phase 4b: Segment-Tree Insertion Optimization (wildcard-heavy)

Goal:

- Reduce `insertIntoSegmentTree` cost identified by §5.3 C as 18.5% top hot function for `100k wildcard-heavy`.

Files:

- `packages/router/src/matcher/segment-tree.ts`
- `packages/router/src/pipeline/registration.ts`
- bench: `packages/router/bench/100k-verification.ts` `100k wildcard-heavy` scenario

Algorithm:

- Profile sub-path inside `insertIntoSegmentTree` per segment kind (literal, param, regex, wildcard).
- Fast-path inserts for the common case (literal segment to existing literal child).
- Cache `staticChildren` map allocation; reuse `null-proto` object instances when possible during build.
- Optional: lazy initialization of `regexParamChildren` empty array until first regex sibling is added.

RED benchmark:

- `100k wildcard-heavy` build p99 currently 490.35 ms (§5.1 Fresh-process 30-run gate).
- CPU profile shows `insertIntoSegmentTree` dominant.

GREEN criteria:

- `100k wildcard-heavy` build p99 ≤ 250 ms (Aggressive band) without regressing other shapes.
- `insertIntoSegmentTree` self-CPU share drops below 10% in re-profiled `100k wildcard-heavy`.
- No correctness regression on §14.2 wildcard fixtures.

### Phase 4c: compileStaticRoute Optimization (high-fanout)

Goal:

- Reduce `compileStaticRoute` cost identified by §5.3 C as 14.0% top hot function for `100k high-fanout`.

Files:

- `packages/router/src/pipeline/registration.ts`
- bench: `packages/router/bench/100k-verification.ts` `100k high-fanout` scenario

Algorithm:

- Profile `compileStaticRoute` per static route insertion path; identify object-allocation, `staticMap[method]` lookup, and `terminalHandlers.push` hot points.
- Pre-size `terminalHandlers` and `staticRegistered[method]` arrays based on pending route count.
- Method-bucket Map vs object representation (cross-references Phase 5b).

RED benchmark:

- `100k high-fanout` build p99 currently 285.74 ms.
- CPU profile shows `compileStaticRoute` 14.0% + `gc` 13.2%.

GREEN criteria:

- `100k high-fanout` build p99 ≤ 250 ms (Aggressive band).
- GC share drops to ≤8% (matches mixed/param baseline).
- No correctness regression on `100k high-fanout` 30-run gate.

### Phase 5: Static-First Match Order

Goal:

- Make static table direct lookup the default before cache checks.

Files:

- `packages/router/src/codegen/emitter.ts`
- `packages/router/src/pipeline/build.ts`
- `packages/router/test/cache-semantics.test.ts`
- `packages/router/bench/100k-verification.ts`

Algorithm:

- Match order: method code -> normalization -> static table -> dynamic hit/miss cache -> dynamic walker.
- Disable static hit cache by default.
- Keep dynamic hit cache and miss cache per method.
- Avoid method+path concatenated cache keys.
- Static wrong-method lookup uses allowed-method metadata generated at build time.
- Static miss is not inserted into dynamic miss cache unless dynamic walker also misses.
- Dynamic miss cache records only normalized safe runtime paths.
- Path-first static layout remains a candidate, but default implementation keeps method-first until memory/method semantics prove otherwise.

RED benchmark:

- Candidate microbench shows static-first faster than cache-first for static-heavy. This is candidate-selection evidence only. Default adoption requires fresh-process 3-run end-to-end p75/p99 proof across static-hot, static-cold, dynamic-heavy, cache-churn, miss, and wrong-method shapes.

GREEN criteria:

- static p75/p99 improves or stays within 5%.
- dynamic-heavy p75/p99 does not regress beyond Guard budget.
- high-cardinality churn does not grow retained cache memory.

Performance risk:

- Workloads dominated by dynamic repeated hits may prefer cache-first.
- If dynamic-heavy regresses by >5%, add adaptive mode gated by route distribution.

### Phase 5b: Static Table Representation (per-method object vs Map)

Goal:

- Resolve §5.2 #6 / §5.3 B / §5.4 finding: `Map<string, number>` is 1.32–2.13× faster than null-proto object at 100k full-path scale across 5 key distributions and adversarial collision-prone patterns. Phase 5b decides whether the static table representation should switch from `Object.create(null)` to `Map<string, number>` per method, retain object, or use a hybrid (object for small methods, Map above a threshold).

Files:

- `packages/router/src/pipeline/registration.ts` (`staticMap` and `staticRegistered` representation)
- `packages/router/src/pipeline/match.ts` (lookup hot path)
- bench: new `packages/router/bench/static-table-rerun.ts` (already exists), extended for end-to-end `100k static` measurement

Algorithm:

- Implement two static-table builders: `ObjectStaticTable` (current) and `MapStaticTable` (new).
- For `100k static` and `100k mixed`, run fresh-process 30-run gate with both representations.
- Measure: build time, RSS, hit/miss/wrong-method p75/p99 for each shape under both.
- Decision matrix:
  - If `MapStaticTable` is ≥10% faster on `100k static` warmed hit p75 with no RSS regression beyond +5%, switch default to Map.
  - If gap is < 10% or RSS regresses ≥5%, retain object.
  - If hybrid (Map for ≥10k routes/method, object below) wins both, document threshold.

RED benchmark:

- §5.3 line 725 confirms 1.99× lookup advantage for Map at 100k unsharded.
- §5.4 line 814 third re-confirmation 1.92×.
- §5.3 E shows 1.32–2.13× across diverse key distributions.

GREEN criteria:

- 30-run fresh-process p99 verdict for both representations on `100k static`, `100k param`, `100k mixed`.
- Build-time `Map.set` cost measured and accounted for (§5.2 line 700 omitted this — must be added).
- Decision recorded in §4 decision-state with `Confirmed` (Map), `Confirmed` (object), or `Hybrid threshold = N`.

Performance risk:

- `Map` build cost (`Map.set` per route) may regress build time. §5.2 only measured object build (73 ns/key) and `Bun.hash` build (113 ns/key); `Map.set` cost is unmeasured.
- `Map` MISS path (8.63 ns) is slightly slower than object MISS (7.17 ns) per §5.3 B; if 100k workload is miss-heavy (e.g., cache churn), Map may lose.

### Phase 6: Codegen Preflight And Telemetry

Goal:

- Avoid generating huge source only to bail out after cost has already been paid.

Files:

- `packages/router/src/codegen/segment-compile.ts`
- `packages/router/src/codegen/walker-strategy.ts`
- new `packages/router/src/codegen/codegen-budget.ts`

Algorithm:

- Add `estimateSegmentTreeCodegen(root)` returning node count, max fanout, estimated source bytes, tester count.
- Check budget before source construction.
- If over budget OR node count > 16 (p99-Guard cap per §5.3 D), return fallback reason and use iterative walker.
- **Build-time first-call warmup** (locked per §5.3 D): immediately after `new Function` returns, invoke the compiled walker with one synthetic input that exercises the deepest emitted branch. This triggers JSC JIT tier-up during build phase so user-facing first-match latency drops from "first-call" to "second-call" range (≤205 ns for 16-node, ≤433 ns for 64-node per §5.3 D second-call median).
- **Hybrid first-match path**: routes ≤16 nodes use codegen + warmup; routes >16 nodes fall back to iterative walker. Iterative walker has stable per-segment cost (~26 ns according to §5.4 line 822 184.94 ns / 4 segments / 2 dispatches) without JIT tier-up cliffs.
- Record optional telemetry in debug/profile mode.
- Compile time cannot be known before compilation. The `10 ms` limit is an observed telemetry gate: if exceeded, subsequent builds for the same shape disable codegen through budget heuristics or lower thresholds.
- Track JSC first-call/tier-up and generated function count in the gate output.
- Preflight accept/reject uses source estimate, node count, fanout, tester count, and prior telemetry for the same tree shape. Observed compile time is a post-compile gate, not a value that can be predicted exactly before compilation.

Limits:

- source max 128 KiB
- preferred source 64 KiB
- stretch source 32 KiB
- nodes max **16** (p99 Guard 10us via codegen-only) / **32** (p75 Guard 10us with build-time warmup) / 4096 (legacy initial budget; not gate-passing). Routes whose tree exceeds the codegen budget are served by iterative walker plus build-time first-call warmup that triggers JIT tier-up before the router is exposed to user traffic. Per §5.3 D distribution: 16 nodes p99 6,447 ns; 64 nodes p99 12,633 ns (Guard fail).
- fanout max 64
- observed compile max 10 ms per method; source/node/fanout limits are the pre-compile hard gate

RED benchmark:

- large tree codegen attempts source generation before bailing today.

GREEN criteria:

- No source string is built when estimate exceeds budget.
- first-match p99 improves or stays within Guard.
- compile telemetry appears in bench output.

Performance risk:

- Estimator must not become expensive. It must be O(nodes) and build-time only.

### Phase 7: 100k Param Memory Breakdown And Compaction

Goal:

- Reduce the confirmed high RSS in `100k param`.

Files:

- `packages/router/src/matcher/segment-tree.ts`
- `packages/router/src/pipeline/registration.ts`
- `packages/router/src/pipeline/build.ts`
- `packages/router/src/codegen/params-factory.ts` if present or equivalent factory site

Required profile before changes:

- heap profile for `100k param`
- retained object counts for segment nodes, static child maps, terminal arrays, factory slots, unique factory functions, generated source, cache, and any retained closure environments
- owner chain for retained build-only structures: `Registration.snapshot`, static build maps, validation indexes, generated function/source references
- check whether generated source strings are retained after `new Function`

Candidate order:

- drop/null build-only indexes immediately after snapshot publication
- factory interning
- terminal aliasing
- build-only structure discard
- static-chain compression for dynamic segment tree
- compact terminal metadata table

Decision rule:

- Implement only the first candidate whose heap profile contribution is large enough to matter.
- Do not replace object child lookup with packed scans unless end-to-end p99 proves it.

GREEN criteria:

- RSS per route moves under Guard target or improves by at least 25% without p99 regression.
- heapUsed per route improves or stays within target.
- dynamic hit/miss p99 remains within Guard.
- Cache eviction policy remains bounded after memory compaction: keep current clock-sweep hit cache and FIFO miss cache unless a replacement policy beats them on high-cardinality churn p75/p99 and retained memory.
- Any memory compaction that changes cache representation must restate the eviction algorithm in code and tests; prose-only eviction policy is not sufficient for Phase 7 approval.

### Phase 8: External Baseline And Bun.serve Phase Split

Goal:

- Make superiority/comparison claims reproducible.

Files:

- `packages/router/bench/100k-external-baselines.ts`
- `packages/router/bench/100k-bun-serve-baseline.ts`

Algorithm:

- Add param/mixed/wildcard scenarios to external adapters where semantics support them.
- Verify exact value, params, wildcard capture, falsy value, wrong method.
- Split Bun.serve into route object prep, serve init, first request, warmed request.

GREEN criteria:

- Each baseline has version, adapter semantics, failure class, timeout, memory cap.
- Static-only baselines remain marked static-only.
- Bun.serve timeout is classified by phase, not by whole-harness timeout.

### Phase 9: Final Gate And Release Decision

Order:

1. Run correctness/security suite.
2. Run `100k-gate-runner.ts` for all required shapes.
3. Run `100k mixed` phase profile.
4. Run heap profile for `100k param`.
5. Run external baselines.
6. Compare before/after against this document's target bands.

Release can claim enterprise/extreme only if:

- all P0 correctness/security tests pass
- no required 100k shape is missing
- mixed build passes Guard
- versioned-api build, RSS, first-match, warmed hit, miss, and wrong-method metrics pass Guard
- wildcard-heavy build, RSS, first-match, warmed hit, miss, and wrong-method metrics pass Guard
- param memory passes Guard or documented exception is accepted
- first-match p99 passes Guard
- warmed p99 passes Guard for static, param, wildcard, miss, wrong method
- external baseline caveats are documented

---

## 14. Verification Gate

이 문서를 “최고 계획”으로 확정하려면 아래 gate를 통과해야 한다.

### 14.1. Environment Capture

- `bun --version`
- CPU model, OS/kernel, architecture
- commit hash and dependency lock state
- benchmark warmup policy
- whether CPU/thermal governor is stable

### 14.2. Correctness Gate

필수 실패/성공 테스트:

- custom valid method succeeds.
- empty/space/control/delimiter method fails.
- valid custom tokens such as `PROPFIND`, `PATCH+X`, `foo`, and `get` succeed as distinct methods.
- invalid tokens such as `GET POST`, `GET\t`, `GET/`, `GET:`, and `M\0` fail.
- method length boundary at 64 ASCII bytes and over-limit cases are tested.
- over-limit method emits `method-too-long`.
- method is case-sensitive.
- `GET` route does not match `get`.
- `get` may be registered only as a distinct valid custom token, not as an alias for `GET`.
- 32-method limit is enforced.
- invalid numeric limits and invalid secure/compat option combinations emit `option-invalid`.
- `maxRegexSiblingsPerSegment` is enforced; 33+ disjoint regex params at the same segment position emit `regex-sibling-limit` under the default limit.
- `maxExpandedRoutes` is enforced; total expanded routes above the configured cap emit `expansion-total-limit` before trie insertion.
- `HEAD` does not implicitly match `GET`.
- `OPTIONS` is not implicitly generated.
- registration query/fragment fails.
- control char path fails.
- raw non-ASCII path emits `path-non-ascii`.
- ASCII character outside the allowed path grammar emits `path-invalid-pchar`.
- Regex syntax without a preceding `:name`, such as `/x/(\\d+)`, emits `path-invalid-pchar`.
- full path longer than `maxPathLength` emits `path-too-long`.
- segment longer than `maxSegmentLength` emits `segment-too-long`.
- segment count above `maxSegmentCount` emits `segment-count-limit`.
- param count above `maxParams` emits `param-count-limit`.
- interior empty segment emits `path-empty-segment`.
- malformed `%` registration fails.
- runtime malformed encoded params no-match in secure/default.
- runtime fragment input no-matches in secure/default.
- encoded slash `%2F`, encoded control `%00`, invalid UTF-8, malformed `%`, encoded dot, and mixed dot forms no-match in secure/default.
- encoded control `%00` emits `path-encoded-control` in registration and no-matches in runtime secure/default.
- encoded slash `%2F` inside param or wildcard capture no-matches before capture materialization.
- literal `.` / `..`, encoded `%2e` / `%2e%2e`, and mixed forms `.%2e` / `%2e.` fail/no-match in secure/default.
- over-limit registered path/segment fails in secure/default mode.
- per-route optional explosion cap emits `optional-expansion-limit`.
- total optional expansion cap holds through `maxExpandedRoutes`.
- `/:a` then `/:b` under the same method emits `route-duplicate`.
- Same regex AST at the same segment, e.g. `/x/:r(\\d+)/a` and `/x/:r(\\d+)/b`, reuses one regex child and does not emit `route-conflict`.
- Repeating the exact same ordinary registration, e.g. `add('GET', '/foo', h)` twice, emits `route-duplicate` even if handler/options identity matches.
- `add('*', '/foo', h)` plus `add('GET', '/foo', h)` emits `route-duplicate` unless the duplicate concrete route came from optional expansion.
- Optional expansion alias terminal succeeds only when method, handler identity, and route options identity are identical; otherwise it emits `route-conflict`.
- `add('*', path, value)` expands only methods known before `seal()`; if `HEAD` is among those methods it gets its own concrete route, and `GET` still never implies `HEAD`.
- wildcard/static same-prefix collision emits `route-unreachable` regardless of registration order.
- wildcard/wildcard same-prefix collision emits `route-unreachable` for the later fully covered wildcard.
- regex safety uses the secure/default safe subset; compat native RegExp best-effort is excluded from enterprise/security claims.
- `route-duplicate` is covered by same method + same pattern and same normalized terminal fixtures that are not optional-expansion aliases.
- `route-conflict` is covered by plain param vs regex param same-shape fixtures and overlapping regex sibling fixtures.
- `param-duplicate` is covered by duplicate param name within one route pattern.
- `regex-unsafe` is covered by nested quantifier, backreference, lookaround, named capture, and unsafe wildcard regex fixtures.
- validation errors expose actionable kind/reason plus route index/path/method.
- caller mutation of returned params cannot poison cached params on repeated same-path lookup.

### 14.3. Performance Gate

Run at least 3 times and compare median/p75/p99:

- route count: 10, 100, 1k, 10k, 100k
- shape: static, param, regex param, wildcard, optional, mixed API-like
- fanout: 1, 4, 16, 64, 256
- path length: short, medium, long, deep slash, slash miss
- hit type: static hit, dynamic hit, wildcard hit, regex fail, 404, wrong method
- method: built-in, custom, 32-method limit, wrong method
- cache: hot repeated hit, cold first hit, miss, high-cardinality churn above `cacheSize`, static-heavy, dynamic-only cache, static-cache bypass
- normalization: case-sensitive, case-insensitive, trailing slash, query strip, percent decode
- runtime mode: cold first match, warmed loop, `Bun.serve` request path
- 100k target band: Guard / Aggressive / Stretch, derived from measurements
- build phase: parse, optional expansion, static insert, dynamic insert, wildcard conflict check, snapshot build, codegen
- codegen phase: node count, source bytes, compile ms, first-call ns, warmed ns
- static layout: method-first vs compact path-first including memory, allowed-method, wrong-method, and multi-method routes

100k gate command policy:

- `bun run bench` is not the 100k approval gate unless package scripts are updated to point at this matrix.
- The gate requires a fresh-process 3-run wrapper or JSON aggregation that records median/p75/p99.
- Required scenarios: static, param, mixed, high-fanout, versioned API-like, wildcard-heavy.
- If any required scenario is missing from the script, approval status is `not approved`.
- If a wildcard-heavy 100k scenario cannot be built without intentionally exceeding conflict semantics, the harness must report the maximum valid route count, reason, and substitute pass/fail threshold.

Initial planning-band table:

The initial planning bands in section 6 are provisional rejection budgets until replaced by a newer full-matrix baseline document. Empty metrics are `not approved`; final release approval requires refreshed full-matrix/profile data.

### 14.4. External Baseline Gate

Compare against:

- current working router
- previous released/baseline router
- Bun native `Bun.serve({ routes })`
- `URLPattern`
- `find-my-way`
- `memoirist`
- `rou3`
- `hono`
- `koa-tree-router`

Every baseline must be attempted at 100k routes. If it cannot build, cannot run, or exceeds practical memory/time limits, record that as a baseline result.

Baseline correctness requirements:

- hit returns exact registered value, including falsy values where supported
- param and wildcard captures match expected values
- wrong method behavior is comparable or explicitly documented
- lazy-build routers include first-match compile cost in a separate column or in build time
- static-only baseline results must not be generalized to dynamic/mixed/wildcard behavior

### 14.5. Profile Gate

Must collect:

- mitata throughput and latency summaries
- `bun --cpu-prof`
- `bun --cpu-prof-interval`
- `bun --heap-prof`
- RSS / heapUsed / arrayBuffers
- build-time and after-first-match memory separately
- generated code size
- codegen compile time
- first-match latency
- object-count breakdown for 100k param memory
- retained build-only structures after snapshot publication
- Bun/JSC object shape and dictionary-mode risk evidence where observable
- huge object property lookup stability for 100k static buckets
- `Object.freeze` vs clone cost for params cache policy
- generated `new Function` count, source bytes, compile time, first-call latency, and code-cache pressure proxy
- code-cache pressure proxy is defined as generated function count, total emitted source bytes, compile wall time, first-call latency, process RSS delta after compile, and repeated compile/deopt symptoms observable through Bun/JSC profiling. There is no stable public Bun API that exposes JSC code cache occupancy directly, so this proxy is evidence for rejection/acceptance, not a byte-accurate code-cache measurement.

Pass condition:

- no correctness regression
- no unbounded memory behavior under high-cardinality paths
- static/dynamic/wildcard core routes remain at or above current throughput envelope
- memory optimizations show positive retained-memory reduction without unacceptable p75/p99 regression
- any candidate optimization must beat baseline end-to-end, not only microbench
- 100k route profile must pass before any “enterprise/extreme” claim is made

Failure handling:

- If correctness fails, performance results from that run are invalid.
- If a candidate improves mean ns/op but regresses p75/p99 materially, the candidate is rejected unless the workload explicitly accepts that trade-off.
- If a candidate lowers heap but raises RSS or arrayBuffers enough to hurt process density, it is not accepted as a memory win.
- If build time improves only by skipping validation or weakening diagnostics, it is rejected.
- If a cache optimization improves repeated same-path hot loops but worsens high-cardinality churn, it is not accepted as the default.
- If an external baseline cannot provide equivalent semantics, it is a reference point, not a superiority proof.

Enterprise/extreme claim checklist:

- Correctness gate passed.
- Security/default profile implemented and tested.
- Compat/unsafe opt-outs are explicit.
- 100k current/baseline/optimized comparisons exist for required shapes.
- 100k phase-level build profile exists.
- 100k memory profile includes `rss`, `heapUsed`, `arrayBuffers`, and object breakdown.
- Cache-hot, cold, churn, miss, wrong-method, and first-match latency are separated.
- External baselines include semantic caveats.
- All accepted optimizations have end-to-end evidence.
- All rejected optimizations have measured or architectural rejection reasons.

Before/after baseline rule:

- Historical pre-P0 measurements remain useful only to explain why work started.
- Final optimization before/after comparison must use the baseline after P0 correctness/security fixes and before performance optimizations.
- Allowed regression budget after P0 baseline: correctness 0 known regressions, warmed p99 <= 5% regression per core shape, first-match p99 <= 10% regression unless explicitly optimized later, build p99 <= 5% regression except where validation intentionally adds security work, RSS/heap/arrayBuffers <= 5% regression unless exchanged for documented security/correctness improvement.

---

## 15. Final Decision

Bun-only 극한 라우터를 만들기 위한 현재 최강 가설은 다음 한 문장으로 요약된다.

**JSC가 잘 최적화하는 null-proto object lookup과 제한적 build-time codegen을 중심에 두고, GC와 heap pressure가 생기는 params/metadata/method availability만 Int32Array와 bit mask로 제거하는 hybrid router.**

현재 근거상 최고 우선순위는 correctness/security defects를 먼저 제거하고, 그 다음 100k mixed build bottleneck, 100k param memory, `param factory double-call`, cache order, static table layout, codegen threshold, memory metadata compaction을 100k gate 기반으로 측정하는 것이다.

반대로 SoA/TypedArray 전면 치환, Bun.hash 기반 hot path, TextEncoder byte routing, DataView node table, open-address hash child lookup, DFA/NFA 전환은 현재 근거상 최고 설계가 아니다.
