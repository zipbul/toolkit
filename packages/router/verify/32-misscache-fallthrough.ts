/**
 * #32 — Static lookup runs before cache lookup; static hit returns directly.
 */

import { Router } from '../index';
const r = new Router<string>();
r.add('GET', '/health', 'static');
r.add('GET', '/u/:id', 'dyn');
r.build();

// Static path: should hit static lookup, not cache.
const m1 = r.match('GET', '/health');
console.log('/health source:', m1?.meta.source);  // expect "static"

// Same path twice: source should remain "static"
const m2 = r.match('GET', '/health');
console.log('/health source (2nd):', m2?.meta.source);

// Dynamic path: first miss → dynamic, second → cache
console.log('/u/42:    ', r.match('GET', '/u/42')?.meta.source);
console.log('/u/42 (2):', r.match('GET', '/u/42')?.meta.source);

// Negative path: first → null, second → null (miss-cached but observable as null)
console.log('/nope:    ', r.match('GET', '/nope'));
console.log('/nope (2):', r.match('GET', '/nope'));

const correct = m1?.meta.source === 'static' && m2?.meta.source === 'static'
  && r.match('GET', '/u/42')?.meta.source === 'cache';
console.log('VERDICT:', correct ? 'REFUTED — static lookup precedes cache; behavior correct' : 'PARTIAL');
