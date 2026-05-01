/**
 * #3 — Can `//` reach segment-tree's extractSegments via legit user input?
 *
 * Hypothesis: path-parser collapses `//` (mergeStaticParts in route-expand.ts:187)
 * before sending to segment-tree. If a path with `//` survives the parser,
 * extractSegments would silently skip the empty segment.
 *
 * Trigger candidates (legit user input):
 *   - "/api//users"  — middle double slash
 *   - "/api/v1//"    — trailing double slash
 *   - "//"           — root double slash
 *   - "/users//:id"  — double slash before param
 */

import { PathParser } from '../src/builder/path-parser';
import { Router } from '../index';

const parser = new PathParser({
  caseSensitive: true,
  ignoreTrailingSlash: true,
  maxSegmentLength: 1024,
});

const cases = ['/api//users', '/api/v1//', '//', '/users//:id', '/a///b'];
let parserRejected = 0;
let routerRejected = 0;

for (const path of cases) {
  const r = parser.parse(path);
  if ('data' in r) {
    parserRejected++;
    console.log(path, '→ rejected:', r.data.kind, '|', r.data.message?.slice(0, 60));
  } else {
    console.log(path, '→ parts:', JSON.stringify(r.parts));
  }
}

// Now register through Router and observe behavior.
console.log('--- via Router.build ---');
for (const path of cases) {
  const router = new Router<string>();
  let kind: string | undefined;
  try {
    router.add('GET', path, 'h');
    router.build();
  }
  catch (e: any) { kind = e?.data?.kind; }
  if (kind !== undefined) routerRejected++;
  console.log(path, '→ build() rejection:', kind ?? '(accepted)');
}

console.log('VERDICT:', parserRejected === cases.length && routerRejected === cases.length
  ? 'REFUTED — path-parser rejects repeated slashes before segment-tree insertion'
  : 'REPRODUCED — path-parser does not collapse // (impacts dynamic routes)');
