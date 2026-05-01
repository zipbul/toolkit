/**
 * #72 — RouterError.data discriminated union narrowing works correctly.
 */

import { Router } from '../index';
import { RouterError } from '../src/error';

const r = new Router<string>();
r.add('GET', '/x', 'first');

let err: RouterError | undefined;
try { r.add('GET', '/x', 'second'); }
catch (e) { err = e as RouterError; }

if (err && err.data.kind === 'route-duplicate') {
  // Narrowed → suggestion is required string
  console.log('kind:', err.data.kind);
  console.log('message:', err.data.message);
  console.log('suggestion:', err.data.suggestion);
  console.log('path:', err.data.path);
  console.log('VERDICT: REFUTED — discriminated union narrowing works as designed');
} else {
  console.log('VERDICT: PARTIAL — kind not narrowed');
}
