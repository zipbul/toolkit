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
try {
  r.add('*', '/files/static', 'star');
  r.build();
} catch (e: any) { kind = e.data?.errors?.[0]?.error?.kind ?? e.data?.kind; }
console.log('kind:', kind);

const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const;
const values: Record<string, string | null> = {};
for (const m of methods) {
  values[m] = r.match(m, '/files/static')?.value ?? null;
  console.log(`${m.padEnd(8)} /files/static:`, values[m]);
}

const rolledBack = values.GET === null
  && values.POST === null
  && values.PUT === null
  && values.PATCH === null
  && values.DELETE === null
  && values.OPTIONS === null
  && values.HEAD === null;
console.log('VERDICT:', rolledBack
  ? 'REFUTED — failed * expansion build publishes no partial compiled methods'
  : 'REPRODUCED — * registers GET/POST then fails at PUT, partial state');
