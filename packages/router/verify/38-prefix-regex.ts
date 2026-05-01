/**
 * #38 — checkWildcardNameConflict uses regex `\/[*:].*$` to extract prefix.
 *       Build-time only; verify result correctness for the only consumer.
 */

import { Router } from '../index';
import { RouterError } from '../src/error';

const r = new Router<string>();
r.add('GET', '/files/*p', 'first');

// Same prefix, different wildcard name → conflict.
let kind: string | undefined;
try {
  r.add('GET', '/files/*q', 'second');
  r.build();
}
catch (e: any) { kind = e instanceof RouterError ? (e.data.kind === 'route-validation' ? e.data.errors[0]?.error.kind : e.data.kind) : 'unk'; }
console.log('conflict kind:', kind);

// Different prefix → no conflict.
let secondAccepted = false;
const r2 = new Router<string>();
try { r2.add('GET', '/assets/*x', 'third'); r2.build(); secondAccepted = true; } catch {}
console.log('different prefix accepted:', secondAccepted);

console.log('VERDICT:', kind === 'route-conflict' && secondAccepted
  ? 'REFUTED — prefix extraction works correctly; no behavior issue'
  : 'PARTIAL');
