---
"@zipbul/router": minor
---

Rewrite router internals from segment-based binary trie to character-level radix trie.

- Character-level LCP-split radix nodes with per-method tree isolation
- Iterative radix walker with monomorphic property access (no closure tree)
- Inline path normalization (preNormalize + needsDeepNorm fast path)
- PathParser replaces Processor pipeline for add-time normalization
- MatchState pre-allocated with reuse across match() calls
- Public API: value-or-throw with RouterError class (internal: Result<T,E>)
- Cache: bitwise AND masking, hit/miss separation, freeze removal
- Static routes: O(1) Map lookup
- Tiered child dispatch and label comparison specialization at build time
