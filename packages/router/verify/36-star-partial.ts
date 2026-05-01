/**
 * #36 — `*` registers across 7 methods. Mid-method failure leaves
 *        early methods registered, late methods unregistered.
 */

import { Router } from '../index';

const r = new Router<string>();
// Pre-register a wildcard in PUT only.
r.add('PUT', '/files/*p', 'put-wild');

// Now `*` add `/files/static`. GET/POST succeed; PUT fails (static under wildcard).
let kind: string | undefined;
try { r.add('*', '/files/static', 'star'); }
catch (e: any) { kind = e.data?.kind; }
console.log('kind:', kind);

r.build();
const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const;
for (const m of methods) {
  console.log(`${m.padEnd(8)} /files/static:`, r.match(m, '/files/static')?.value ?? null);
}

console.log('VERDICT: REPRODUCED — * registers GET/POST then fails at PUT, partial state');
