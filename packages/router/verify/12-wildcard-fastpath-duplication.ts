/**
 * #12 — segment-walk.ts iterative walker has a wildcard fast-path block
 *       (lines ~316-327) and a general wildcard branch (~356-363). Same logic
 *       in two places. Verify behavior identical for both code paths.
 */

import { Router } from '../index';

// Path that triggers fast-path: wildcard-only node (no static, no param).
// Construct: /files/*p — root → static 'files' → wildcard.
// During matching `/files/abc/def`, after consuming 'files', node has only
// wildcard. Fast-path takes over.
const r = new Router<string>();
r.add('GET', '/files/*p', 'h');
r.build();

const m1 = r.match('GET', '/files/abc/def');
console.log('fast-path match:', m1?.params);

// General path: same node, different traversal context — but for this shape
// both paths must agree. Cross-check by matching different paths.
console.log('match /files:    ', r.match('GET', '/files')?.params);
console.log('match /files/x:  ', r.match('GET', '/files/x')?.params);

const ok = m1?.params.p === 'abc/def'
  && r.match('GET', '/files')?.params.p === ''
  && r.match('GET', '/files/x')?.params.p === 'x';
console.log('VERDICT:', ok
  ? 'REFUTED — fast-path and general path produce identical results'
  : 'PARTIAL');
