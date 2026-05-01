/**
 * #49 — Decorator combinations like `:a?+`, `:a+?`, `:a?*` parsed silently.
 */

import { PathParser } from '../src/builder/path-parser';

const parser = new PathParser({
  caseSensitive: true,
  ignoreTrailingSlash: true,
  maxSegmentLength: 1024,
});

const cases = ['/:a?+', '/:a?*', '/:a+?', '/:a*?'];
let rejected = 0;
for (const path of cases) {
  const r = parser.parse(path);
  if ('data' in r) {
    rejected++;
    console.log(path, '→ rejected:', r.data.kind);
  } else {
    console.log(path, '→ parts:', JSON.stringify(r.parts));
  }
}

console.log('VERDICT:', rejected === cases.length
  ? 'REFUTED — mixed optional/wildcard decorators are rejected consistently'
  : 'PARTIAL — some mixed decorator combinations still parse silently');
