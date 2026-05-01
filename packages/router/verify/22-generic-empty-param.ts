/**
 * #22 — Generic param continuation rejects empty param (slashVar > posVar).
 */

import { Router } from '../index';

const r = new Router<string>();
r.add('GET', '/u/:id/posts', 'h');
r.build();

console.log('/u/1/posts:    ', r.match('GET', '/u/1/posts')?.value);
console.log('/u//posts:     ', r.match('GET', '/u//posts'));      // empty :id → null
console.log('/u/1/posts/:   ', r.match('GET', '/u/1/posts/')?.value); // ignoreTrailingSlash default

console.log('VERDICT: REFUTED — generic continuation rejects empty param');
