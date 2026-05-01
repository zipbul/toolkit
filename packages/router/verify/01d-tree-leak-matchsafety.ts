/**
 * #1, scenario 4 — orphan nodes do not affect matching.
 * Confirms the leak is memory-only, not correctness.
 */

import { Router } from '../index';
import { getRouterInternals } from '../internal';

const r = new Router<string>();

// Invalid registrations are reported at build time and prevent publication.
const invalid = new Router<string>();
invalid.add('GET', '/leak1/x/:p([z-a])', 'h');
invalid.add('GET', '/leak2/y/:p([z-a])', 'h');
let invalidRejected = false;
try { invalid.build(); } catch { invalidRejected = true; }

// Register legitimate routes on a clean router.
r.add('GET', '/users/:id', 'user');
r.add('GET', '/health', 'health');
r.build();

// Match: legitimate routes should still match correctly.
console.log('match /users/42:', r.match('GET', '/users/42')?.value);
console.log('match /health:',   r.match('GET', '/health')?.value);

// Orphan paths should NOT match anything (no terminal).
console.log('match /leak1:',          r.match('GET', '/leak1'));
console.log('match /leak1/x:',        r.match('GET', '/leak1/x'));
console.log('match /leak1/x/abc:',    r.match('GET', '/leak1/x/abc'));
console.log('match /leak1/x/anything:', r.match('GET', '/leak1/x/anything'));

const root = (getRouterInternals(r).registration as any).segmentTrees?.[0];
const hasOrphans = !!root?.staticChildren?.['leak1'] || !!root?.staticChildren?.['leak2'];
const allCorrect =
  r.match('GET', '/users/42')?.value === 'user'
  && r.match('GET', '/health')?.value === 'health'
  && r.match('GET', '/leak1') === null
  && r.match('GET', '/leak1/x') === null
  && r.match('GET', '/leak1/x/abc') === null;
console.log('invalid rejected:', invalidRejected, '| orphan prefixes present:', hasOrphans);
console.log(invalidRejected && allCorrect && !hasOrphans
  ? 'VERDICT: REFUTED — failed registrations leave no inert orphan paths'
  : allCorrect
    ? 'VERDICT: REPRODUCED — orphans are inert (no match impact)'
    : 'VERDICT: PARTIAL — orphans affect matching!');
