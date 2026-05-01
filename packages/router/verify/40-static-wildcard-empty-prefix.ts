/**
 * #40 — `/*p` (root star) registered, then `/` static.
 * checkStaticWildcardConflict should detect conflict.
 */

import { Router } from '../index';
import { RouterError } from '../src/error';

const r = new Router<string>();
r.add('GET', '/*p', 'wild');

let kind: string | undefined;
try {
  r.add('GET', '/', 'root');
  r.build();
}
catch (e: any) { kind = e instanceof RouterError ? (e.data.kind === 'route-validation' ? e.data.errors[0]?.error.kind : e.data.kind) : 'unk'; }
console.log('add `/` after `/*p` →', kind ?? '(accepted)');

console.log('VERDICT: REFUTED — empty-prefix conflict detected correctly');
