import { run, bench, boxplot, summary, do_not_optimize } from 'mitata';
import querystring from 'node:querystring';

import qs from 'qs';

import { QueryParser } from '../src/query-parser';

// ── Helpers ──

function generateFlat(count: number): string {
  return Array.from({ length: count }, (_, i) => `a${i}=v${i}`).join('&');
}

function generateDuplicates(count: number): string {
  return Array.from({ length: count }, (_, i) => `a=${i}`).join('&');
}

// ── Input data (pre-built) ──

const FLAT_1 = 'a=1';
const FLAT_5 = 'a=1&b=2&c=3&d=4&e=5';
const FLAT_10 = generateFlat(10);
const FLAT_50 = generateFlat(50);
const FLAT_100 = generateFlat(100);

const NESTED_1 = 'a[b]=1';
const NESTED_2 = 'a[b][c]=1';
const NESTED_3 = 'a[b][c][d]=1';
const NESTED_5 = 'a[b][c][d][e][f]=1';

const ARRAY_PUSH_10 = Array.from({ length: 10 }, (_, i) => `a[]=${i}`).join('&');
const ARRAY_INDEX_10 = Array.from({ length: 10 }, (_, i) => `a[${i}]=${i}`).join('&');
const ARRAY_MIXED = 'a[0][name]=x&a[0][value]=y&a[1][name]=z';

const HPP_20 = generateDuplicates(20);

const NO_ENCODING = 'name=hello&city=seoul';
const ENCODED_VALUES = 'name=hello%20world&city=%EC%84%9C%EC%9A%B8';
const ENCODED_KEYS = '%EC%9D%B4%EB%A6%84=hello%20world&%EB%8F%84%EC%8B%9C=%EC%84%9C%EC%9A%B8';

const SEARCH_FORM = 'q=typescript&page=1&limit=20&sort=relevance&lang=ko';
const FILTER_API = 'filter[status]=active&filter[role]=admin&page=1&per_page=50';
const ECOMMERCE =
  'category=shoes&brand[]=nike&brand[]=adidas&price_min=50&price_max=200&size[]=9&size[]=10&sort=price_asc';

const ENCODED_5 = 'key%201=val%201&key%202=val%202&key%203=val%203&key%204=val%204&key%205=val%205';

// ── Parser instances (pre-built) ──

const defaultParser = QueryParser.create();
const nestingParser = QueryParser.create({ nesting: true });
const strictParser = QueryParser.create({ strict: true });
const strictNestingParser = QueryParser.create({ nesting: true, strict: true });
const dupFirstParser = QueryParser.create({ duplicates: 'first' });
const dupLastParser = QueryParser.create({ duplicates: 'last' });
const dupArrayParser = QueryParser.create({ duplicates: 'array' });

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  BENCHMARKS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ── 1. Factory cost ──

boxplot(() => {
  bench('QueryParser.create() — default', () => {
    do_not_optimize(QueryParser.create());
  }).gc('inner');

  bench('QueryParser.create() — full custom', () => {
    do_not_optimize(
      QueryParser.create({
        depth: 10,
        maxParams: 500,
        nesting: true,
        arrayLimit: 50,
        duplicates: 'array',
        strict: true,
      }),
    );
  }).gc('inner');
});

// ── 2. Flat key=value — parameter count scaling ──

summary(() => {
  bench('flat 1 param', () => {
    do_not_optimize(defaultParser.parse(FLAT_1));
  });

  bench('flat 5 params', () => {
    do_not_optimize(defaultParser.parse(FLAT_5));
  });

  bench('flat 10 params', () => {
    do_not_optimize(defaultParser.parse(FLAT_10));
  });

  bench('flat 50 params', () => {
    do_not_optimize(defaultParser.parse(FLAT_50));
  });

  bench('flat 100 params', () => {
    do_not_optimize(defaultParser.parse(FLAT_100));
  });
});

// ── 3. Nested object parsing — by depth ──

summary(() => {
  bench('nested depth 1 — a[b]=1', () => {
    do_not_optimize(nestingParser.parse(NESTED_1));
  });

  bench('nested depth 2 — a[b][c]=1', () => {
    do_not_optimize(nestingParser.parse(NESTED_2));
  });

  bench('nested depth 3 — a[b][c][d]=1', () => {
    do_not_optimize(nestingParser.parse(NESTED_3));
  });

  bench('nested depth 5 — a[b][c][d][e][f]=1', () => {
    do_not_optimize(nestingParser.parse(NESTED_5));
  });
});

// ── 4. Array parsing ──

summary(() => {
  bench('array push ×10 — a[]=0&...', () => {
    do_not_optimize(nestingParser.parse(ARRAY_PUSH_10));
  });

  bench('array indexed ×10 — a[0]=0&...', () => {
    do_not_optimize(nestingParser.parse(ARRAY_INDEX_10));
  });

  bench('array+object mixed', () => {
    do_not_optimize(nestingParser.parse(ARRAY_MIXED));
  });
});

// ── 5. Duplicates mode comparison ──

summary(() => {
  bench('hpp first — 20 duplicates', () => {
    do_not_optimize(dupFirstParser.parse(HPP_20));
  });

  bench('hpp last — 20 duplicates', () => {
    do_not_optimize(dupLastParser.parse(HPP_20));
  });

  bench('hpp array — 20 duplicates', () => {
    do_not_optimize(dupArrayParser.parse(HPP_20));
  });
});

// ── 6. Percent encoding overhead ──

summary(() => {
  bench('no encoding', () => {
    do_not_optimize(defaultParser.parse(NO_ENCODING));
  });

  bench('encoded values', () => {
    do_not_optimize(defaultParser.parse(ENCODED_VALUES));
  });

  bench('encoded keys + values', () => {
    do_not_optimize(defaultParser.parse(ENCODED_KEYS));
  });
});

// ── 7. Strict mode overhead ──

summary(() => {
  bench('flat 10 (non-strict)', () => {
    do_not_optimize(defaultParser.parse(FLAT_10));
  });

  bench('flat 10 (strict)', () => {
    do_not_optimize(strictParser.parse(FLAT_10));
  });

  bench('nested depth 3 (non-strict)', () => {
    do_not_optimize(nestingParser.parse(NESTED_3));
  });

  bench('nested depth 3 (strict)', () => {
    do_not_optimize(strictArrayParser.parse(NESTED_3));
  });
});

// ── 8. Realistic payloads ──

summary(() => {
  bench('search form (flat)', () => {
    do_not_optimize(defaultParser.parse(SEARCH_FORM));
  });

  bench('filter API (nested)', () => {
    do_not_optimize(nestingParser.parse(FILTER_API));
  });

  bench('e-commerce (arrays)', () => {
    do_not_optimize(nestingParser.parse(ECOMMERCE));
  });
});

// ── 9. vs competitors — flat ──

summary(() => {
  bench('flat 10 — @zipbul/query-parser', () => {
    do_not_optimize(defaultParser.parse(FLAT_10));
  });

  bench('flat 10 — qs', () => {
    do_not_optimize(qs.parse(FLAT_10));
  });

  bench('flat 10 — node:querystring', () => {
    do_not_optimize(querystring.parse(FLAT_10));
  });

  bench('flat 10 — URLSearchParams', () => {
    do_not_optimize(Object.fromEntries(new URLSearchParams(FLAT_10)));
  });
});

summary(() => {
  bench('flat 50 — @zipbul/query-parser', () => {
    do_not_optimize(defaultParser.parse(FLAT_50));
  });

  bench('flat 50 — qs', () => {
    do_not_optimize(qs.parse(FLAT_50));
  });

  bench('flat 50 — node:querystring', () => {
    do_not_optimize(querystring.parse(FLAT_50));
  });

  bench('flat 50 — URLSearchParams', () => {
    do_not_optimize(Object.fromEntries(new URLSearchParams(FLAT_50)));
  });
});

summary(() => {
  bench('encoded 5 — @zipbul/query-parser', () => {
    do_not_optimize(defaultParser.parse(ENCODED_5));
  });

  bench('encoded 5 — qs', () => {
    do_not_optimize(qs.parse(ENCODED_5));
  });

  bench('encoded 5 — node:querystring', () => {
    do_not_optimize(querystring.parse(ENCODED_5));
  });

  bench('encoded 5 — URLSearchParams', () => {
    do_not_optimize(Object.fromEntries(new URLSearchParams(ENCODED_5)));
  });
});

// ── 10. vs qs — nested/array ──

summary(() => {
  bench('nested depth 3 — @zipbul/query-parser', () => {
    do_not_optimize(nestingParser.parse(NESTED_3));
  });

  bench('nested depth 3 — qs', () => {
    do_not_optimize(qs.parse(NESTED_3, { depth: 5 }));
  });
});

summary(() => {
  bench('array ×10 — @zipbul/query-parser', () => {
    do_not_optimize(nestingParser.parse(ARRAY_INDEX_10));
  });

  bench('array ×10 — qs', () => {
    do_not_optimize(qs.parse(ARRAY_INDEX_10, { arrayLimit: 20 }));
  });
});

summary(() => {
  bench('e-commerce — @zipbul/query-parser', () => {
    do_not_optimize(nestingParser.parse(ECOMMERCE));
  });

  bench('e-commerce — qs', () => {
    do_not_optimize(qs.parse(ECOMMERCE));
  });
});

await run();
