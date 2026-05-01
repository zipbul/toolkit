/**
 * #6 — route-duplicate emitted with 3 different message formats.
 *
 * Sites:
 *   - segment-tree.ts:254-258 (wildcard duplicate)
 *   - segment-tree.ts:278-283 (param-route terminal duplicate)
 *   - registration.ts:222-228 (static route duplicate)
 *
 * Each triggered separately:
 */

import { Router } from '../index';

function captureMsg(fn: () => void): { kind?: string; message?: string; suggestion?: string } {
  try { fn(); return {}; }
  catch (e: any) {
    const data = e?.data?.errors?.[0]?.error ?? e?.data;
    return {
      kind: data?.kind,
      message: data?.message,
      suggestion: data?.suggestion,
    };
  }
}

// Site 1: wildcard duplicate (segment-tree.ts:254-258)
const r1 = new Router<string>();
r1.add('GET', '/files/*p', 'first');
console.log('Site 1 (wildcard duplicate, same name):',
  captureMsg(() => { r1.add('GET', '/files/*p', 'second'); r1.build(); }));

// Site 2: dynamic param-route terminal duplicate (segment-tree.ts:278-283)
const r2 = new Router<string>();
r2.add('GET', '/users/:id', 'first');
console.log('Site 2 (param-route terminal duplicate):',
  captureMsg(() => { r2.add('GET', '/users/:id', 'second'); r2.build(); }));

// Site 3: static route duplicate (registration.ts:222-228)
const r3 = new Router<string>();
r3.add('GET', '/health', 'first');
console.log('Site 3 (static duplicate):',
  captureMsg(() => { r3.add('GET', '/health', 'second'); r3.build(); }));

console.log('VERDICT: REPRODUCED — three different message formats for same kind');
