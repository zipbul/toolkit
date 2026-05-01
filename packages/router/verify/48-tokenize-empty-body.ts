/**
 * #48 — tokenize handles empty path body (path = "/" only) correctly.
 */

import { PathParser } from '../src/builder/path-parser';

const parser = new PathParser({
  caseSensitive: true, ignoreTrailingSlash: true, maxSegmentLength: 1024,
});

const cases = [
  { path: '/',    expectParts: [{ type: 'static', value: '/' }] },
  { path: '/x',   expectParts: [{ type: 'static', value: '/x' }] },
];

let allOK = true;
for (const c of cases) {
  const r = parser.parse(c.path);
  if ('data' in r) { console.log(c.path, '→ rejected'); allOK = false; continue; }
  const ok = JSON.stringify(r.parts) === JSON.stringify(c.expectParts);
  console.log(c.path, '→', JSON.stringify(r.parts), ok ? '✓' : '✗');
  if (!ok) allOK = false;
}
console.log('VERDICT:', allOK ? 'REFUTED — empty body handled correctly' : 'PARTIAL');
