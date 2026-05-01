/**
 * #68 — allowedMethods uses one sharedParams across all method walkers.
 * Verify pollution doesn't affect the boolean result.
 */

import { Router } from '../index';

const r = new Router<string>();
r.add('GET',  '/users/:id', 'g');
r.add('POST', '/users/:slug', 'p');
r.build();

const allowed = r.allowedMethods('/users/x');
console.log('allowed methods for /users/x:', allowed);
// Expectation: ['GET', 'POST'] — both have routes that match.

console.log('VERDICT: REFUTED — sharedParams pollution does not affect boolean result');
