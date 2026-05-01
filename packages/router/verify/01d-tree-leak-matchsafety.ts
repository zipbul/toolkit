/**
 * #1, scenario 4 — orphan nodes do not affect matching.
 * Confirms the leak is memory-only, not correctness.
 */

import { Router } from '../index';

const r = new Router<string>();

// Leak some orphans first.
try { r.add('GET', '/leak1/x/:p([z-a])', 'h'); } catch {}
try { r.add('GET', '/leak2/y/:p([z-a])', 'h'); } catch {}

// Register legitimate routes.
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

const allCorrect =
  r.match('GET', '/users/42')?.value === 'user'
  && r.match('GET', '/health')?.value === 'health'
  && r.match('GET', '/leak1') === null
  && r.match('GET', '/leak1/x') === null
  && r.match('GET', '/leak1/x/abc') === null;
console.log(allCorrect ? 'VERDICT: REPRODUCED — orphans are inert (no match impact)'
                       : 'VERDICT: PARTIAL — orphans affect matching!');
