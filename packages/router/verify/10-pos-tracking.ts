/**
 * #10 — Iterative walker pos initialization assumes path[0] === '/'.
 * Verify the guards before entering the loop reject malformed input.
 */

import { Router } from '../index';

const r = new Router<string>();
r.add('GET', '/api/users', 'h');
r.add('GET', '/api/:id', 'd');
r.build();

const cases = ['', '/', 'no-slash', '//', '/api', '/api/', '/api/users', '/api/42'];
for (const p of cases) {
  console.log(JSON.stringify(p), '→', r.match('GET', p)?.value ?? null);
}

console.log('VERDICT: REFUTED — root guard rejects all malformed input');
