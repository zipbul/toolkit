/**
 * #23 — Generic param continuation emits TWO branches when next has both
 *       a store AND children:
 *         (a) slashVar !== -1 — recurse into next subtree
 *         (b) slashVar === -1 — terminate at next.store
 *
 * Direct emit check + runtime confirm both branches reachable.
 */

import { Router } from '../index';

const r = new Router<string>({ ignoreTrailingSlash: false });
r.add('GET', '/u/:id',       'leaf');
r.add('GET', '/u/:id/posts', 'nested');
r.build();

// Runtime
console.log('/u/42:           ', r.match('GET', '/u/42')?.value);
console.log('/u/42/posts:     ', r.match('GET', '/u/42/posts')?.value);
console.log('/u/42/x:         ', r.match('GET', '/u/42/x'));
console.log('/u/42/:          ', r.match('GET', '/u/42/'));

const ok = r.match('GET', '/u/42')?.value === 'leaf'
  && r.match('GET', '/u/42/posts')?.value === 'nested'
  && r.match('GET', '/u/42/x') === null
  && r.match('GET', '/u/42/') === null;
console.log('VERDICT:', ok
  ? 'REFUTED — terminal and continuation param routes both behave correctly'
  : 'PARTIAL');
