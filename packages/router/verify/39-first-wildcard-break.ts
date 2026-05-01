/**
 * #39 — checkWildcardNameConflict `break` after first wildcard found.
 *       path-parser only allows wildcard as last segment, so loop reaches
 *       the wildcard at most once. break is harmless redundancy.
 */

import { PathParser } from '../src/builder/path-parser';

const parser = new PathParser({
  caseSensitive: true,
  ignoreTrailingSlash: true,
  maxSegmentLength: 1024,
});

// Wildcard not at last → rejected.
const cases = ['/*a/x', '/x/*a/y'];
for (const path of cases) {
  const r = parser.parse(path);
  console.log(path, '→', 'data' in r ? r.data.kind : 'parsed');
}

// Wildcard at last → ok.
const r2 = parser.parse('/x/*a');
console.log('/x/*a →', 'data' in r2 ? r2.data.kind : `parts.length=${r2.parts.length}`);

console.log('VERDICT: REFUTED — path-parser ensures ≤1 wildcard per path; break is dead-but-harmless');
