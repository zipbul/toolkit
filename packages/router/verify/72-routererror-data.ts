/**
 * #72 — RouterError.data discriminated union narrowing works correctly.
 */

import { Router } from '../index';
import { RouterError } from '../src/error';

const r = new Router<string>();
r.add('GET', '/x', 'first');

let err: RouterError | undefined;
try {
  r.add('GET', '/x', 'second');
  r.build();
}
catch (e) { err = e as RouterError; }

const issue = err?.data.kind === 'route-validation' ? err.data.errors[0]?.error : err?.data;
if (issue?.kind === 'route-duplicate') {
  // Narrowed → suggestion is required string
  console.log('kind:', issue.kind);
  console.log('message:', issue.message);
  console.log('suggestion:', issue.suggestion);
  console.log('path:', issue.path);
  console.log('VERDICT: REFUTED — discriminated union narrowing works as designed');
} else {
  console.log('VERDICT: PARTIAL — kind not narrowed');
}
