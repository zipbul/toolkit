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
for (const path of cases) {
  const r = parser.parse(path);
  if ('data' in r) {
    console.log(path, '→ rejected:', r.data.kind);
  } else {
    console.log(path, '→ parts:', JSON.stringify(r.parts));
  }
}

console.log('VERDICT: PARTIAL — :a+? silently parsed; :a?+ rejected');
