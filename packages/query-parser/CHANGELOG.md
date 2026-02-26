# @zipbul/query-parser

## 0.1.0

### Minor Changes

- 0a8d457: ### Refactor

  - Merge duplicate `assignLeaf` / `assignLeafStrict` into a single unified method
  - Merge duplicate `assignToRecord` / `assignToRecordStrict` into a single unified method
  - Replace `export *` with explicit named exports to tighten public API surface
  - Fix `arrayToObject` to iterate with `Object.keys` for correct sparse-array handling
  - Remove redundant `!qs` falsy check in `parseInternal` (empty string check is sufficient)

  ### Security

  - Add `__lookupGetter__` and `__lookupSetter__` to `POISONED_KEYS` blocklist

  ### Bug Fixes

  - Add `safeDecode` helper that catches malformed percent-encoding: returns raw string in non-strict mode, returns `Err` in strict mode (previously threw uncaught `URIError`)
  - Apply `safeDecode` to both keys and values during `processPair`

  ### Tests

  - Add tests for `__lookupGetter__` / `__lookupSetter__` blocking
  - Split malformed percent-encoding test into strict vs non-strict cases covering both keys and values

  ### Benchmark

  - Add comprehensive benchmark suite (`bench/query-parser.bench.ts`) using mitata with 10 groups: factory cost, flat scaling, nested depth, array parsing, HPP modes, encoding overhead, strict mode overhead, realistic payloads, and competitor comparison (qs, node:querystring, URLSearchParams)
