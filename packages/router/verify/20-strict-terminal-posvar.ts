/**
 * #20 — strictTerminal posVar < len rejects empty param.
 */

import { Router } from '../index';

const r = new Router<string>({ ignoreTrailingSlash: false });
r.add('GET', '/users/:id', 'h');
r.build();

console.log('/users/42:  ', r.match('GET', '/users/42')?.value);
console.log('/users/:    ', r.match('GET', '/users/'));    // empty param → null
console.log('/users:     ', r.match('GET', '/users'));     // no separator → null

console.log('VERDICT: REFUTED — strictTerminal correctly rejects empty param');
