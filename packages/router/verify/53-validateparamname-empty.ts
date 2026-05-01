/**
 * #53 — empty param name `:` rejected; anonymous wildcard `*` accepted.
 */

import { PathParser } from '../src/builder/path-parser';

const parser = new PathParser({
  caseSensitive: true, ignoreTrailingSlash: true, maxSegmentLength: 1024,
});

const cases: Array<[string, 'reject' | 'accept']> = [
  ['/:',     'reject'],   // empty name
  ['/users/:', 'reject'], // empty name
  ['/*',     'accept'],   // anonymous wildcard
  ['/files/*', 'accept'], // anonymous wildcard
];

let allOK = true;
for (const [path, expected] of cases) {
  const r = parser.parse(path);
  const got = 'data' in r ? 'reject' : 'accept';
  const ok = got === expected;
  console.log(path, '→ expected', expected, ', got', got, ok ? '✓' : '✗');
  if (!ok) allOK = false;
}
console.log('VERDICT:', allOK ? 'REFUTED — validation correct' : 'REPRODUCED');
